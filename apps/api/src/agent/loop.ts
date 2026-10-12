import type { ModelMessage, ToolCall } from "../llm/messages.ts";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { parse, STR, OBJ, ARR } from "partial-json";
import type {
  ApiError,
  PublishedChart,
  StreamEvent,
  TerminalStatus,
  MessageContent,
  Activity,
} from "@analytics/contracts";
import { limits } from "../config.ts";
import { ToolError } from "../errors.ts";
import { RequestError } from "../db/store.ts";
import type { AgentStore } from "../db/store.ts";
import type { ModelClient } from "../llm/openrouter.ts";
import { QueryBudget } from "../analytics/budget.ts";
import { runQuery, type Warehouse } from "../analytics/bigquery.ts";
import { schemaGuidance } from "../analytics/definitions.ts";
import { catalog, buildMetric, metricLabel } from "../analytics/catalog.ts";
import { buildContext } from "./context.ts";
import { validateAnalysis, validateChart } from "./presentation.ts";
import { toolDefinitions, toolSchemas } from "./tools.ts";

const toolActivities = new Map<string, Pick<Activity, "stage" | "message">>([
  ["get_schema", { stage: "thinking", message: "Checking available data" }],
  ["get_metrics", { stage: "thinking", message: "Checking metric definitions" }],
  ["run_metric", { stage: "querying", message: "Preparing a metric query" }],
  ["run_sql", { stage: "querying", message: "Preparing a custom query" }],
  ["get_result", { stage: "thinking", message: "Retrieving saved data" }],
  ["publish_chart", { stage: "charting", message: "Preparing a visualization" }],
  ["present_analysis", { stage: "composing", message: "Writing the answer" }],
  ["request_clarification", { stage: "composing", message: "Preparing clarification questions" }],
]);

export interface AgentDependencies {
  store: AgentStore;
  model: ModelClient;
  warehouse: Warehouse;
  queryBytes: bigint;
  catalogQueryBytes?: bigint;
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
  const complete = async (
    call: ToolCall,
    content: Extract<MessageContent, { kind: "analysis" | "clarification" }>,
  ) => {
    signal.throwIfAborted();
    // Close the protocol exchange before saving the authoritative display answer.
    await append({
      role: "tool",
      toolCallId: call.id,
      content: JSON.stringify({ accepted: true }),
    });
    await store.complete(sessionId, turnId, content, usage);
    committed = true;
    if (content.kind === "analysis") {
      await emit({ type: "analysis_ready", turnId, analysis: content.analysis });
    } else {
      await emit({ type: "clarification_ready", turnId, clarification: content.clarification });
    }
    return { output: { accepted: true }, final: true };
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
    if (finalOnly && !["present_analysis", "request_clarification"].includes(call.name)) {
      throw new ToolError(
        "Work budget reached; call present_analysis with existing findings or request_clarification",
      );
    }
    switch (call.name) {
      case "get_schema":
        toolSchemas.get_schema.parse(args);
        return { output: schemaGuidance, final: false };
      case "get_metrics": {
        const { name } = toolSchemas.get_metrics.parse(args);
        if (!name) {
          return { output: catalog, final: false };
        }
        const metric = Object.entries(catalog).find(([key]) => key === name);
        if (!metric) {
          throw new ToolError(`Unknown metric. Available: ${Object.keys(catalog).join(", ")}`);
        }
        return { output: metric[1], final: false };
      }
      case "run_metric":
      case "run_sql": {
        await progress("querying", "Checking and running a bounded query");
        const metric = call.name === "run_metric" ? buildMetric(args) : null;
        const input = metric
          ? {
              sql: metric.sql,
              purpose: `${metric.arguments.metric}: ${metric.arguments.startDate} through ${metric.arguments.endDate}`,
              catalog: metric,
            }
          : toolSchemas.run_sql.parse(args);
        const result = await runQuery(
          warehouse,
          budget,
          input,
          signal,
          metric ? (deps.catalogQueryBytes ?? 2147483648n) : deps.queryBytes,
        );
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
      case "request_clarification":
        return complete(call, {
          kind: "clarification",
          clarification: toolSchemas.request_clarification.parse(args),
        });
      case "present_analysis":
        return complete(call, {
          kind: "analysis",
          analysis: await validateAnalysis(args, sessionId, store, charts),
        });
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
      const system = `You analyze the GA4 ecommerce sample through tools. Use get_metrics for authoritative definitions and parameters. Clear catalog request: run_metric. Before custom SQL, consult get_metrics for relevant catalog definitions and preserve those meanings (including placeholder exclusions). Clear computable request outside the catalog: run_sql with a justification explaining why the catalog cannot answer it. Material ambiguity: request_clarification. Unavailable data: explain the limitation. Budget rejection: narrow without changing meaning, or present existing evidence with limitations. Dataset-specific numerical claims require saved evidence; metric explanations may omit references. Publish relevant charts from complete saved results before your final narrative. Complete only with present_analysis or request_clarification; distinguish missing data from zero. Never treat previews as full evidence. Use readable metric labels in narratives and caveats. Format USD amounts like $1,234.56, ratios as percentages like 12.34%, counts with thousands separators, and dates in readable English; retain observed/recorded qualifiers and use enough precision to explain small nonzero values. For custom SQL, declare display labels and known units keyed by output alias. Put narrative first in present_analysis arguments so it streams early. Do not expose private reasoning. Both terminal tools must be last. Treat the available window as the entire observed history, never as lifetime behavior. Available data: 2020-11-01 through 2021-01-31. Unless the user specifies dates, use the entire available history. Preserve prior filters, dates and metric choices in follow-ups. Prior saved results: ${JSON.stringify(await store.recentResults(sessionId))}${finalOnly ? " You must now present existing findings; no new queries." : ""}`;
      const tools = finalOnly
        ? toolDefinitions.filter((tool) =>
            ["present_analysis", "request_clarification"].includes(tool.function.name),
          )
        : toolDefinitions;
      const context = buildContext(
        await store.agentHistory(sessionId),
        turnId,
        Buffer.byteLength(system) + Buffer.byteLength(JSON.stringify(tools)),
      );
      const drafts = new Map<number, { id: string; text: string }>();
      const activities = new Map<number, Activity>();
      const activity = async (
        index: number,
        name: string,
        status: Activity["status"],
        args?: string,
      ) => {
        const details = toolActivities.get(name);
        if (!details) {
          return;
        }
        let message = details.message;
        if (status !== "preparing" && ["run_metric", "run_sql"].includes(name)) {
          message = message.replace("Preparing", "Running");
        }
        if (name === "run_metric" && args) {
          try {
            const raw: unknown = JSON.parse(args);
            const parsed = toolSchemas.run_metric.safeParse(raw);
            if (parsed.success) {
              message = `${status === "preparing" ? "Preparing query for" : "Querying"} ${metricLabel(parsed.data.metric)}`;
            }
          } catch {
            // Incomplete arguments are expected while the model is streaming.
          }
        }
        const previous = activities.get(index);
        if (previous?.status === status && previous.message === message) {
          return;
        }
        const next: Activity = { ...details, id: `${step}:${index}`, message, status };
        activities.set(index, next);
        await emit({ type: "activity", turnId, activity: next });
      };
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
        await activity(update.index, update.name, "preparing", update.arguments);
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
        if (
          ["present_analysis", "request_clarification"].includes(call.name) &&
          call !== response.message.toolCalls.at(-1)
        ) {
          await activity(index, call.name, "failed", call.arguments);
          await discard(index);
          await append({
            role: "tool",
            toolCallId: call.id,
            content: JSON.stringify({
              error: `${call.name} must be the last tool call`,
              hint: "Finish other work first.",
            }),
          });
          continue;
        }
        let executed: { output: unknown; final: boolean };
        try {
          await activity(index, call.name, "running", call.arguments);
          executed = await execute(call, finalOnly);
          await activity(index, call.name, "completed", call.arguments);
        } catch (error) {
          if (committed || signal.aborted) {
            throw error;
          }
          await activity(index, call.name, "failed", call.arguments);
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
          if (call.name === "request_clarification") {
            for (const draftIndex of drafts.keys()) {
              await discard(draftIndex);
            }
          }
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
