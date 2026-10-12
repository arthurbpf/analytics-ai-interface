import type { ModelMessage, ToolCall } from "../llm/messages.ts";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { parse, STR, OBJ, ARR } from "partial-json";
import type { ApiError, PublishedChart, StreamEvent, TerminalStatus } from "@analytics/contracts";
import { limits } from "../config.ts";
import { ToolError } from "../errors.ts";
import { RequestError } from "../db/store.ts";
import type { AgentStore } from "../db/store.ts";
import type { ModelClient } from "../llm/openrouter.ts";
import { QueryBudget } from "../analytics/budget.ts";
import { runQuery, type Warehouse } from "../analytics/bigquery.ts";
import { definitions, schemaGuidance } from "../analytics/definitions.ts";
import { buildContext } from "./context.ts";
import { validateAnalysis, validateChart } from "./presentation.ts";
import { toolDefinitions, toolSchemas } from "./tools.ts";

export interface AgentDependencies {
  store: AgentStore;
  model: ModelClient;
  warehouse: Warehouse;
  queryBytes: bigint;
  turnBytes: bigint;
}
export interface TurnOutcome {
  status: TerminalStatus;
  error: ApiError | null;
}
export async function runAgent(
  deps: AgentDependencies,
  sessionId: string,
  turnId: string,
  signal: AbortSignal,
  emit: (event: StreamEvent) => Promise<void>,
): Promise<TurnOutcome> {
  const { store, model, warehouse } = deps;
  const charts: PublishedChart[] = [];
  const budget = new QueryBudget(deps.queryBytes, deps.turnBytes, limits.sqlCalls);
  const usage: {
    modelCalls: number;
    inputTokens: number | null;
    outputTokens: number | null;
    cost: number | null;
  } = { modelCalls: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
  let awaitingModel = false;
  let committed = false;
  let invalidTools = 0;
  const progress = async (
    stage: "thinking" | "querying" | "charting" | "composing",
    message: string,
  ) => {
    await emit({ type: "progress", turnId, stage, message });
  };
  const append = async (message: ModelMessage) => {
    await store.append(sessionId, turnId, { kind: "model", message });
  };
  const execute = async (
    call: ToolCall,
    finalOnly: boolean,
  ): Promise<{ output: unknown; final: boolean }> => {
    let args: unknown;
    try {
      args = JSON.parse(call.arguments);
    } catch {
      throw new ToolError("Tool arguments must be valid JSON");
    }
    if (finalOnly && call.name !== "present_analysis") {
      throw new ToolError("Work budget reached; call present_analysis with existing findings");
    }
    switch (call.name) {
      case "get_schema":
        toolSchemas.get_schema.parse(args);
        return { output: schemaGuidance, final: false };
      case "get_metrics": {
        const { name } = toolSchemas.get_metrics.parse(args);
        if (!name) {
          return { output: definitions, final: false };
        }
        const metric = Object.entries(definitions).find(([key]) => key === name);
        if (!metric) {
          throw new ToolError(`Unknown metric. Available: ${Object.keys(definitions).join(", ")}`);
        }
        return { output: metric[1], final: false };
      }
      case "run_sql": {
        await progress("querying", "Checking and running a bounded query");
        const result = await runQuery(warehouse, budget, toolSchemas.run_sql.parse(args), signal);
        signal.throwIfAborted();
        await store.saveResult(sessionId, turnId, result);
        return {
          output: {
            ...result,
            ...(result.complete
              ? {}
              : {
                  hint: "Preview is incomplete. Narrow dates, columns, or aggregate into fewer groups. It cannot ground a chart or final answer.",
                }),
          },
          final: false,
        };
      }
      case "get_result": {
        const input = toolSchemas.get_result.parse(args);
        return { output: await store.result(sessionId, input.resultRef), final: false };
      }
      case "publish_chart": {
        if (charts.length >= limits.charts) {
          throw new ToolError("Visualization budget reached");
        }
        await progress("charting", "Preparing a visualization from saved data");
        const spec = toolSchemas.publish_chart.parse(args);
        const chart = validateChart(spec, await store.result(sessionId, spec.resultRef));
        signal.throwIfAborted();
        await store.append(sessionId, turnId, { kind: "chart", chart });
        charts.push(chart);
        await emit({ type: "chart_ready", turnId, chart });
        return { output: { chartId: chart.id, resultRef: spec.resultRef }, final: false };
      }
      case "present_analysis": {
        const analysis = await validateAnalysis(args, sessionId, store, charts);
        signal.throwIfAborted();
        // Close the protocol exchange before saving the authoritative display answer.
        await append({
          role: "tool",
          toolCallId: call.id,
          content: JSON.stringify({ accepted: true }),
        });
        await store.complete(sessionId, turnId, { kind: "analysis", analysis }, usage);
        committed = true;
        await emit({ type: "analysis_ready", turnId, analysis });
        return { output: { accepted: true }, final: true };
      }
      default:
        throw new ToolError("Unknown tool. Use one of the provided tool definitions.");
    }
  };
  try {
    for (let step = 0; step < limits.modelCalls; step++) {
      signal.throwIfAborted();
      const finalOnly = step === limits.modelCalls - 1;
      await progress(
        finalOnly ? "composing" : "thinking",
        finalOnly ? "Composing the final analysis" : "Planning the next analysis step",
      );
      const system = `You analyze the GA4 ecommerce sample through tools. Use get_metrics for authoritative meanings. Freely author SQL within executor limits. Publish relevant charts from complete saved results before your final narrative. Complete only with present_analysis; distinguish missing data from zero. Never treat previews as full evidence. Do not expose private reasoning. If the question is ambiguous, use present_analysis to ask a clarification. Available data: 2020-11-01 through 2021-01-31. Prior saved results: ${JSON.stringify(await store.recentResults(sessionId))}${finalOnly ? " You must now present existing findings; no new queries." : ""}`;
      const tools = finalOnly
        ? toolDefinitions.filter((tool) => tool.function.name === "present_analysis")
        : toolDefinitions;
      const context = buildContext(
        await store.agentHistory(sessionId),
        turnId,
        Buffer.byteLength(system) + Buffer.byteLength(JSON.stringify(tools)),
      );
      const drafts = new Map<number, { id: string; text: string }>();
      const discard = async (index: number) => {
        const draft = drafts.get(index);
        if (draft) {
          await emit({ type: "analysis_discarded", turnId, draftId: draft.id });
          drafts.delete(index);
        }
      };
      usage.modelCalls++;
      awaitingModel = true;
      const response = await model.complete(system, context, tools, signal, async (update) => {
        if (update.name !== "present_analysis") {
          return;
        }
        let partial: unknown;
        try {
          partial = parse(update.arguments, STR | OBJ | ARR);
        } catch {
          return;
        }
        const parsed = z.object({ narrative: z.string().max(16000) }).safeParse(partial);
        if (!parsed.success) {
          return;
        }
        const text = parsed.data.narrative;
        let draft = drafts.get(update.index);
        if (draft && !text.startsWith(draft.text)) {
          await discard(update.index);
          draft = undefined;
        }
        if (!draft) {
          draft = { id: randomUUID(), text: "" };
          drafts.set(update.index, draft);
          await emit({ type: "analysis_started", turnId, draftId: draft.id });
        }
        const delta = text.slice(draft.text.length);
        if (delta) {
          await emit({ type: "analysis_delta", turnId, draftId: draft.id, delta });
        }
        draft.text = text;
      });
      signal.throwIfAborted();
      awaitingModel = false;
      usage.inputTokens =
        usage.inputTokens === null || response.usage.inputTokens === null
          ? null
          : usage.inputTokens + response.usage.inputTokens;
      usage.outputTokens =
        usage.outputTokens === null || response.usage.outputTokens === null
          ? null
          : usage.outputTokens + response.usage.outputTokens;
      usage.cost =
        usage.cost === null || response.usage.cost === null
          ? null
          : usage.cost + response.usage.cost;
      if (response.message.toolCalls.length > 8) {
        throw new Error("Too many tool calls in one model response");
      }
      await append(response.message);
      if (!response.message.toolCalls.length) {
        await append({
          role: "user",
          content:
            "Please call present_analysis or use the provided tools; plain prose is not a completed analysis.",
        });
        continue;
      }
      for (const [index, call] of response.message.toolCalls.entries()) {
        signal.throwIfAborted();
        // Presentation must be last, otherwise later calls would remain unanswered.
        if (call.name === "present_analysis" && call !== response.message.toolCalls.at(-1)) {
          await discard(index);
          await append({
            role: "tool",
            toolCallId: call.id,
            content: JSON.stringify({
              error: "present_analysis must be the last tool call",
              hint: "Finish other work first.",
            }),
          });
          continue;
        }
        let executed: { output: unknown; final: boolean };
        try {
          executed = await execute(call, finalOnly);
        } catch (error) {
          if (committed || signal.aborted) {
            throw error;
          }
          // Database and transport failures are not model-correctable.
          if (
            !(error instanceof Error) ||
            (!(error instanceof z.ZodError) &&
              !(error instanceof ToolError) &&
              !(error instanceof RequestError && error.status === 404))
          ) {
            throw error;
          }
          await discard(index);
          invalidTools++;
          executed = {
            output: {
              error: error.message,
              hint: "Correct the tool arguments or narrow the query using schema/metric guidance.",
            },
            final: false,
          };
        }
        if (executed.final) {
          return { status: "completed", error: null };
        }
        await append({
          role: "tool",
          toolCallId: call.id,
          content: JSON.stringify(executed.output),
        });
        if (invalidTools >= 16) {
          throw new Error("Tool correction budget exhausted");
        }
      }
    }
    throw new Error("Model call budget exhausted without a valid final answer");
  } catch (error) {
    if (awaitingModel) {
      usage.inputTokens = null;
      usage.outputTokens = null;
      usage.cost = null;
    }
    if (committed) {
      return { status: "completed", error: null };
    }
    const status = signal.aborted ? "interrupted" : "failed";
    const safeError = {
      code: status === "interrupted" ? "interrupted" : "analysis_failed",
      message:
        status === "interrupted"
          ? "Analysis interrupted; saved artifacts are retained."
          : "Analysis could not complete. Saved artifacts are retained; try a narrower question.",
    };
    console.error(
      JSON.stringify({
        event: "turn_failed",
        turnId,
        reason: error instanceof Error ? error.message : "Unknown failure",
      }),
    );
    await store.finish(turnId, status, safeError, usage);
    return { status, error: safeError };
  }
}
