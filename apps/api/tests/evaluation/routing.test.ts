import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";
import { metricRequestSchema, type MetricRequest } from "@analytics/contracts";
import { runAgent } from "../../src/agent/loop.ts";
import { OpenRouter } from "../../src/llm/openrouter.ts";
import { BigQueryWarehouse } from "../../src/analytics/bigquery.ts";
import { memoryStore, sessionId, turnId } from "../fixtures/analysis.ts";

const key = z.string().min(1).parse(process.env["OPENROUTER_API_KEY"]);
const modelName = z.string().min(1).parse(process.env["OPENROUTER_MODEL"]);
const mode = z
  .enum(["baseline", "reviewed"])
  .default("reviewed")
  .parse(process.env["ANALYTICS_EVALUATION_MODE"]);
const reviewModel = process.env["OPENROUTER_REVIEW_MODEL"] ?? modelName;
const reviewer =
  mode === "baseline" ? null : { model: new OpenRouter(key, reviewModel), modelName: reviewModel };
const project = z.string().min(1).parse(process.env["GOOGLE_CLOUD_PROJECT"]);
const cases = [
  {
    name: "catalog",
    prompt: "What was recorded USD purchase-event revenue over the entire available history?",
    metric: "revenue",
    numerical: true,
  },
  {
    name: "topN",
    prompt: "Show the top 2 device categories by purchase-event count in January 2021.",
    metric: "purchases",
    numerical: true,
  },
  {
    name: "adhoc",
    prompt:
      "How many valid transaction IDs occur on purchase events from more than one user in the entire history? This cross-user conflict diagnostic is outside the metric catalog.",
    metric: null,
    numerical: true,
  },
  {
    name: "multi-part",
    prompt:
      "Compare recorded USD purchase-event revenue and purchase-event counts by device in November 2020 and January 2021. Give both sets of values and distinguish descriptive comparisons from causal explanations.",
    metric: null,
    numerical: true,
  },
  {
    name: "ambiguous",
    prompt:
      "Compare our retention rate. Ask me to choose the retention cohort and return criterion before calculating.",
    metric: null,
    numerical: false,
  },
  {
    name: "unavailable",
    prompt:
      "What was our recorded revenue in February 2021? Explain if those data are unavailable.",
    metric: null,
    numerical: false,
  },
  {
    name: "explanation",
    prompt:
      "Explain the catalog's engagement-rate definition and unknown flags. Do not calculate dataset values.",
    metric: null,
    numerical: false,
  },
  {
    name: "budget",
    prompt:
      "Calculate January purchase events by device. If warehouse budget is insufficient, explain the limitation without changing the period or metric.",
    metric: "purchases",
    numerical: false,
  },
] as const;
function isPurchaseCount(request: MetricRequest) {
  return (
    request.metric === "purchases" ||
    (request.metric === "event_counts" &&
      request.filters.some(
        (filter) =>
          filter.field === "event_name" && filter.op === "eq" && filter.value === "purchase",
      ))
  );
}
const records: Record<string, unknown>[] = [];
afterEach(async () => {
  await writeFile(
    new URL(`../../../../docs/live-harness-evaluations-${mode}.json`, import.meta.url),
    JSON.stringify(
      {
        evaluatedAt: new Date().toISOString(),
        model: modelName,
        reviewerModel: mode === "reviewed" ? reviewModel : null,
        mode,
        project,
        assessment:
          "Automatic routing, evidence and parameter checks; narratives retained for manual analytical review. Reference validation alone does not prove grounding.",
        cases: records,
      },
      null,
      2,
    ) + "\n",
  );
});
it.each(cases)("evaluates $name routing, usage and evidence", async (scenario) => {
  const { store, history, results } = memoryStore();
  const first = history.messages[0];
  if (first?.content.kind === "model" && first.content.message.role === "user") {
    first.content.message.content = scenario.prompt;
  }
  let savedUsage: unknown;
  const complete = store.complete;
  store.complete = async (...args) => {
    savedUsage = args[3];
    await complete(...args);
  };
  const finish = store.finish;
  store.finish = async (...args) => {
    savedUsage = args[3];
    await finish(...args);
  };
  const start = Date.now();
  const outcome = await runAgent(
    {
      store,
      model: new OpenRouter(key, modelName),
      reviewer,
      warehouse: new BigQueryWarehouse(project),
      queryBytes: scenario.name === "budget" ? 1n : 1073741824n,
      catalogQueryBytes: scenario.name === "budget" ? 1n : 2147483648n,
      turnBytes: scenario.name === "budget" ? 1n : 5368709120n,
    },
    sessionId,
    turnId,
    AbortSignal.timeout(120000),
    async () => {},
  );
  const calls = history.messages.flatMap(({ content }) =>
    content.kind === "model" && content.message.role === "assistant"
      ? content.message.toolCalls
      : [],
  );
  const repairs = history.messages.filter(
    ({ content }) =>
      content.kind === "model" &&
      content.message.role === "tool" &&
      content.message.content.includes('"error":'),
  );
  const final = history.messages.at(-1)?.content;
  const purchaseCountCall = calls.some((call) => {
    if (call.name !== "run_metric") {
      return false;
    }
    const parsed = metricRequestSchema.safeParse(JSON.parse(call.arguments));
    return parsed.success && isPurchaseCount(parsed.data);
  });
  const checks = {
    completed: outcome.status === "completed",
    expectedRouting:
      scenario.name === "ambiguous"
        ? final?.kind === "clarification"
        : scenario.name === "adhoc"
          ? calls.some((call) => call.name === "run_sql")
          : scenario.metric
            ? scenario.metric === "purchases"
              ? purchaseCountCall
              : calls.some(
                  (call) =>
                    call.name === "run_metric" &&
                    z.object({ metric: z.string() }).safeParse(JSON.parse(call.arguments)).data
                      ?.metric === scenario.metric,
                )
            : final?.kind === "analysis",
    adhocDefinition:
      scenario.name !== "adhoc" ||
      [...results.values()].every((result) =>
        ["(not set)", "<other>", "(data deleted)"].every((placeholder) =>
          result.sql.toLowerCase().includes(placeholder),
        ),
      ),
    evidence:
      !scenario.numerical || (final?.kind === "analysis" && final.analysis.resultRefs.length > 0),
    unnecessaryClarification: scenario.name !== "ambiguous" && final?.kind === "clarification",
    limitedScope:
      scenario.name !== "topN" ||
      [...results.values()].some(
        (result) => result.scope.kind === "top_n" && result.scope.topN?.requestedCount === 2,
      ),
    preservedDates:
      scenario.name !== "topN" ||
      [...results.values()].every(
        (result) =>
          result.catalog?.arguments.startDate === "2021-01-01" &&
          result.catalog.arguments.endDate === "2021-01-31",
      ),
    unavailable: scenario.name !== "unavailable" || results.size === 0,
    explanationWithoutEvidence:
      scenario.name !== "explanation" ||
      (results.size === 0 && final?.kind === "analysis" && final.analysis.resultRefs.length === 0),
    budget: scenario.name !== "budget" || (results.size === 0 && repairs.length > 0),
    canonicalValue:
      scenario.name !== "catalog" ||
      (final?.kind === "analysis" && /362[,.]?165/.test(final.analysis.narrative)),
  };
  const firstReview = history.messages.findIndex(({ content }) => content.kind === "review");
  const repairSqlSubmissions =
    firstReview < 0
      ? 0
      : history.messages
          .slice(firstReview + 1)
          .flatMap(({ content }) =>
            content.kind === "model" && content.message.role === "assistant"
              ? content.message.toolCalls.filter(
                  (call) => call.name === "run_metric" || call.name === "run_sql",
                )
              : [],
          ).length;
  records.push({
    ...scenario,
    outcome,
    checks,
    taskCoverage:
      scenario.name === "multi-part"
        ? ["revenue", "purchases"].every((metric) =>
            ["2020-11-01", "2021-01-01"].every((startDate) =>
              [...results.values()].some(
                (result) =>
                  result.complete &&
                  final?.kind === "analysis" &&
                  final.analysis.resultRefs.includes(result.ref) &&
                  result.catalog &&
                  (metric === "purchases"
                    ? isPurchaseCount(result.catalog.arguments)
                    : result.catalog.arguments.metric === metric) &&
                  result.catalog.arguments.startDate === startDate &&
                  result.catalog.arguments.endDate ===
                    (startDate === "2020-11-01" ? "2020-11-30" : "2021-01-31"),
              ),
            ),
          )
          ? "full"
          : "partial"
        : "not_assessed",
    correctness:
      checks.adhocDefinition &&
      checks.completed &&
      checks.expectedRouting &&
      checks.evidence &&
      !checks.unnecessaryClarification &&
      checks.limitedScope &&
      checks.preservedDates &&
      checks.unavailable &&
      checks.explanationWithoutEvidence &&
      checks.budget &&
      checks.canonicalValue,
    repairAttempts: repairs.length,
    repairSqlSubmissions,
    latencyMs: Date.now() - start,
    usage: savedUsage,
    calls,
    reviews: history.messages.flatMap(({ content }) =>
      content.kind === "review" ? [content.review] : [],
    ),
    final,
    results: [...results.values()],
  });
  expect(checks.adhocDefinition).toBe(true);
  expect(checks.completed).toBe(true);
  expect(checks.expectedRouting).toBe(true);
  expect(checks.evidence).toBe(true);
  expect(checks.unnecessaryClarification).toBe(false);
  expect(checks.limitedScope).toBe(true);
  expect(checks.preservedDates).toBe(true);
  expect(checks.unavailable).toBe(true);
  expect(checks.explanationWithoutEvidence).toBe(true);
  expect(checks.budget).toBe(true);
  expect(checks.canonicalValue).toBe(true);
  if (scenario.name === "topN") {
    const nextId = randomUUID();
    history.turns.push({
      id: nextId,
      clientTurnId: randomUUID(),
      status: "running",
      createdAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
    });
    history.messages.push({
      id: randomUUID(),
      turnId: nextId,
      content: {
        kind: "model",
        message: {
          role: "user",
          content:
            "Now show those purchase events by week, keeping January and device categories, without a top-N limit.",
        },
      },
    });
    const before = new Set(results.keys());
    const followupStart = Date.now();
    const followup = await runAgent(
      {
        store,
        model: new OpenRouter(key, modelName),
        reviewer,
        warehouse: new BigQueryWarehouse(project),
        queryBytes: 1073741824n,
        catalogQueryBytes: 2147483648n,
        turnBytes: 5368709120n,
      },
      sessionId,
      nextId,
      AbortSignal.timeout(120000),
      async () => {},
    );
    const fresh = [...results.values()].filter((result) => !before.has(result.ref));
    const followupCalls = history.messages
      .filter((message) => message.turnId === nextId)
      .flatMap(({ content }) =>
        content.kind === "model" && content.message.role === "assistant"
          ? content.message.toolCalls
          : [],
      );
    const followupRepairs = history.messages.filter(
      (message) =>
        message.turnId === nextId &&
        message.content.kind === "model" &&
        message.content.message.role === "tool" &&
        message.content.message.content.includes('"error":'),
    ).length;
    records.push({
      name: "filter-preserving-followup",
      outcome: followup,
      final: history.messages.at(-1)?.content,
      reviews: history.messages
        .filter((message) => message.turnId === nextId)
        .flatMap(({ content }) => (content.kind === "review" ? [content.review] : [])),
      results: fresh,
      usage: savedUsage,
      calls: followupCalls,
      latencyMs: Date.now() - followupStart,
      repairAttempts: followupRepairs,
      unnecessaryClarification: history.messages.at(-1)?.content.kind === "clarification",
      correctness:
        followup.status === "completed" &&
        fresh.length > 0 &&
        fresh.every(
          (result) =>
            result.catalog?.arguments.startDate === "2021-01-01" &&
            result.catalog.arguments.endDate === "2021-01-31" &&
            result.catalog.arguments.grain === "week" &&
            result.catalog.arguments.dimensions.includes("device") &&
            !result.catalog.arguments.topN,
        ),
    });
    expect(followup.status).toBe("completed");
    expect(fresh.length).toBeGreaterThan(0);
    expect(
      fresh.every(
        (result) =>
          result.catalog &&
          isPurchaseCount(result.catalog.arguments) &&
          result.catalog.arguments.startDate === "2021-01-01" &&
          result.catalog.arguments.endDate === "2021-01-31" &&
          result.catalog.arguments.grain === "week" &&
          result.catalog.arguments.dimensions.includes("device") &&
          !result.catalog.arguments.topN,
      ),
    ).toBe(true);
  }
});
