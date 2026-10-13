import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";
import type { Analysis, QueryResult } from "@analytics/contracts";
import { runAgent } from "../../src/agent/loop.ts";
import { OpenRouter } from "../../src/llm/openrouter.ts";
import type { TurnUsage } from "../../src/llm/usage.ts";
import {
  call,
  fixtureWarehouse,
  memoryStore,
  result,
  sessionId,
  turnId,
} from "../fixtures/analysis.ts";

const key = z.string().min(1).parse(process.env["OPENROUTER_API_KEY"]);
const modelName = z
  .string()
  .min(1)
  .parse(process.env["OPENROUTER_REVIEW_MODEL"] ?? process.env["OPENROUTER_MODEL"]);
const evidence: QueryResult = {
  ...result,
  justification: "Controlled evaluation fixture for a purchase-event breakdown.",
  scope: { kind: "full", topN: null },
  requiredCaveats: [
    "Obfuscated sample data for November 2020; purchase events are not reconstructed orders.",
  ],
};
const answer: Analysis = {
  narrative: "In November 2020, desktop recorded 12 purchase events and mobile recorded 3.",
  caveats: evidence.requiredCaveats,
  resultRefs: [evidence.ref],
  chartIds: [],
};
interface Scenario {
  name: string;
  prompt: string;
  candidate: Analysis;
  repaired: Analysis;
  incorrect: boolean;
  results?: QueryResult[];
  chartTitle?: string;
  chartType?: "bar" | "line";
  chartX?: string;
  priorPrompt?: string;
}
const scenarios: Scenario[] = [
  {
    name: "correct-counts",
    prompt: "Show November purchase events by device.",
    candidate: answer,
    repaired: answer,
    incorrect: false,
  },
  {
    name: "wrong-value",
    prompt: "Show November purchase events by device.",
    candidate: {
      ...answer,
      narrative: "Desktop recorded 120 purchase events and mobile recorded 3 in November.",
    },
    repaired: answer,
    incorrect: true,
  },
  {
    name: "wrong-grain",
    prompt: "Show November purchase events by device.",
    candidate: {
      ...answer,
      narrative: "Desktop had 12 distinct orders and mobile had 3 distinct orders in November.",
    },
    repaired: answer,
    incorrect: true,
  },
  {
    name: "wrong-denominator",
    prompt: "What share of November purchase events was recorded on desktop?",
    candidate: {
      ...answer,
      narrative: "Desktop contributed 20% of November purchase events (12 desktop and 3 mobile).",
    },
    repaired: {
      ...answer,
      narrative:
        "Desktop contributed 80% of the 15 recorded November purchase events (12 desktop and 3 mobile).",
    },
    incorrect: true,
  },
  {
    name: "top-n-overclaim",
    prompt: "Show the leading device by November purchase events; only the top 1 was retrieved.",
    candidate: {
      ...answer,
      narrative: "Desktop recorded all November purchase events, representing 100% of the total.",
    },
    repaired: {
      ...answer,
      narrative:
        "Desktop was the top device with 12 recorded November purchase events. This top-1 result does not establish its share of all purchase events.",
    },
    incorrect: true,
    results: [
      {
        ...evidence,
        sql: evidence.sql + " ORDER BY purchases DESC LIMIT 1",
        rows: [{ device: "desktop", purchases: 12 }],
        totalRows: "1",
        scope: {
          kind: "top_n",
          topN: {
            by: "purchases",
            requestedCount: 1,
            returnedCount: 1,
            groupCount: "2",
            omittedGroupCount: "1",
          },
        },
      },
    ],
  },
  {
    name: "causal-overclaim",
    prompt: "Compare recorded November purchase events by device.",
    candidate: {
      ...answer,
      narrative:
        "Using desktop rather than mobile caused customers to purchase four times as often.",
    },
    repaired: answer,
    incorrect: true,
  },
  {
    name: "lifetime-overclaim",
    prompt: "Compare recorded November purchase events by device.",
    candidate: {
      ...answer,
      narrative:
        "Over their entire lifetimes, desktop customers placed 12 purchases and mobile customers placed 3.",
    },
    repaired: answer,
    incorrect: true,
  },
  {
    name: "sql-filter-mismatch",
    prompt: "Show November purchase events by device.",
    candidate: answer,
    repaired: {
      ...answer,
      narrative:
        "The saved query counted all November events rather than purchase events, so it cannot establish the requested purchase-event counts.",
    },
    incorrect: true,
    results: [
      {
        ...evidence,
        sql: evidence.sql.replace(" AND event_name = 'purchase'", ""),
        purpose: "All events by device",
      },
    ],
  },
  {
    name: "misleading-chart",
    prompt: "Show November purchase events by device.",
    candidate: answer,
    repaired: answer,
    incorrect: true,
    chartTitle: "Distinct customer orders by device",
  },
  {
    name: "correct-explanation",
    prompt: "Explain the engagement-rate denominator without calculating any dataset values.",
    candidate: {
      ...answer,
      narrative:
        "Engagement rate divides engaged sessions by sessions with known valid engagement flags. Unknown flags are excluded from the denominator and reported separately. The rate is null when no flags are known.",
      resultRefs: [],
      caveats: [],
    },
    repaired: answer,
    incorrect: false,
  },
  {
    name: "correct-unavailable",
    prompt: "What was recorded revenue in February 2021?",
    candidate: {
      ...answer,
      narrative:
        "February 2021 revenue is unavailable: the sample history ends on January 31, 2021. Missing coverage does not mean zero revenue.",
      resultRefs: [],
      caveats: [],
    },
    repaired: answer,
    incorrect: false,
  },
  {
    name: "multi-part-calculation",
    prompt:
      "Compare November purchase-event counts and average recorded USD revenue per purchase event by device.",
    candidate: {
      ...answer,
      narrative:
        "Desktop recorded 12 purchase events and $120 revenue; mobile recorded 3 events and $60 revenue. Desktop's average revenue per event ($10) exceeded mobile's ($20).",
      resultRefs: [evidence.ref, "00000000-0000-4000-8000-000000000001"],
    },
    repaired: {
      ...answer,
      narrative:
        "Desktop recorded 12 purchase events and $120 revenue; mobile recorded 3 events and $60 revenue. Mobile's average revenue per purchase event was $20 versus desktop's $10.",
      resultRefs: [evidence.ref, "00000000-0000-4000-8000-000000000001"],
    },
    incorrect: true,
    results: [
      evidence,
      {
        ...evidence,
        ref: "00000000-0000-4000-8000-000000000001",
        sql: evidence.sql.replace(
          "COUNT(*) AS purchases",
          "SUM(ecommerce.purchase_revenue_in_usd) AS revenue",
        ),
        columns: [
          { name: "device", type: "string" },
          { name: "revenue", type: "number" },
        ],
        rows: [
          { device: "desktop", revenue: 120 },
          { device: "mobile", revenue: 60 },
        ],
        purpose: "Recorded USD purchase-event revenue by device",
        requiredCaveats: [],
      },
    ],
  },
  {
    name: "follow-up-filter",
    priorPrompt: "Restrict this analysis to mobile purchase events in November 2020.",
    prompt: "Keeping that device filter and month, what was the purchase-event count?",
    candidate: { ...answer, narrative: "The requested filtered purchase-event count was 15." },
    repaired: {
      ...answer,
      narrative: "For mobile in November 2020, the recorded purchase-event count was 3.",
    },
    incorrect: true,
  },
  {
    name: "follow-up-date",
    priorPrompt: "Show November purchase events by device.",
    prompt: "Now show January 2021 instead.",
    candidate: {
      ...answer,
      narrative: "January 2021 recorded 12 desktop purchase events and 3 mobile purchase events.",
    },
    repaired: {
      ...answer,
      narrative:
        "Only November evidence is available in this saved result; it does not establish the requested January 2021 purchase-event counts.",
    },
    incorrect: true,
  },
  {
    name: "ambiguous-line-series",
    prompt: "Show November purchase-event counts by week and device.",
    candidate: {
      ...answer,
      narrative:
        "For the week of November 2, desktop recorded 12 purchase events and mobile 3. For November 9, desktop recorded 10 and mobile 5.",
    },
    repaired: {
      ...answer,
      narrative:
        "For the week of November 2, desktop recorded 12 purchase events and mobile 3. For November 9, desktop recorded 10 and mobile 5. These are only the returned nonzero week/device groups; zero-purchase combinations are omitted. Weeks start Monday, so November 1 belongs to the week starting October 26, for which no purchase group was returned.",
    },
    incorrect: true,
    chartTitle: "Purchase events by week and device",
    chartType: "line",
    chartX: "week",
    results: [
      {
        ...evidence,
        sql: evidence.sql
          .replace(
            "SELECT device.category",
            "SELECT DATE_TRUNC(PARSE_DATE('%Y%m%d', event_date), WEEK(MONDAY)) AS week, device.category",
          )
          .replace("GROUP BY device", "GROUP BY week, device"),
        columns: [{ name: "week", type: "date" }, ...evidence.columns],
        rows: [
          { week: "2020-11-02", device: "desktop", purchases: 12 },
          { week: "2020-11-02", device: "mobile", purchases: 3 },
          { week: "2020-11-09", device: "desktop", purchases: 10 },
          { week: "2020-11-09", device: "mobile", purchases: 5 },
        ],
        totalRows: "4",
      },
    ],
  },
];
function analystCall(name: string, args: unknown) {
  return { ...call(name, args), usage: { inputTokens: 0, outputTokens: 0, cost: 0 } };
}
const records: Record<string, unknown>[] = [];
afterEach(async () => {
  await writeFile(
    new URL("../../../../docs/evaluations/live-review-evaluations.json", import.meta.url),
    JSON.stringify(
      {
        evaluatedAt: new Date().toISOString(),
        reviewerModel: modelName,
        assessment:
          "Live reviewer with controlled synthetic saved evidence and scripted candidates/repairs. Paired baseline isolates review effects; this does not establish end-to-end live warehouse accuracy. Candidate correctness labels are the fixture oracle. Narratives and verdicts are retained for manual assessment.",
        cases: records,
      },
      null,
      2,
    ) + "\n",
  );
});

it.each(scenarios)("compares baseline and live review for $name", async (scenario) => {
  for (const mode of ["baseline", "reviewed"] as const) {
    const { store, history, results } = memoryStore();
    const first = history.messages[0];
    if (first?.content.kind === "model" && first.content.message.role === "user") {
      first.content.message.content = scenario.prompt;
    }
    if (scenario.priorPrompt) {
      const priorId = randomUUID();
      history.turns.unshift({
        id: priorId,
        clientTurnId: randomUUID(),
        status: "completed",
        createdAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        error: null,
      });
      history.messages.unshift({
        id: randomUUID(),
        turnId: priorId,
        content: { kind: "model", message: { role: "user", content: scenario.priorPrompt } },
      });
    }
    for (const saved of scenario.results ?? [evidence]) {
      results.set(saved.ref, saved);
    }
    let usage: TurnUsage | null | undefined;
    const complete = store.complete;
    store.complete = async (...args) => {
      usage = args[3];
      await complete(...args);
    };
    const finish = store.finish;
    store.finish = async (...args) => {
      usage = args[3];
      await finish(...args);
    };
    let calls = 0;
    let chartId: string | undefined;
    const warehouse = fixtureWarehouse();
    let extraQueries = 0;
    const execute = warehouse.execute;
    warehouse.execute = async (...args) => {
      extraQueries++;
      return execute(...args);
    };
    const started = Date.now();
    const outcome = await runAgent(
      {
        store,
        model: {
          complete: async () => {
            if (scenario.chartTitle && calls++ === 0) {
              return analystCall("publish_chart", {
                type: scenario.chartType ?? "bar",
                title: scenario.chartTitle,
                resultRef: evidence.ref,
                x: scenario.chartX ?? "device",
                y: "purchases",
              });
            }
            const candidateChart = history.messages.find(
              (message) => message.content.kind === "chart_candidate",
            );
            if (candidateChart?.content.kind === "chart_candidate") {
              chartId = candidateChart.content.chart.id;
            }
            const repaired = history.messages.some(
              (message) =>
                message.content.kind === "review" &&
                message.content.review.verdict?.approved === false,
            );
            const analysis = repaired
              ? scenario.repaired
              : { ...scenario.candidate, chartIds: chartId ? [chartId] : [] };
            return analystCall("present_analysis", analysis);
          },
        },
        reviewer: mode === "baseline" ? null : { model: new OpenRouter(key, modelName), modelName },
        warehouse,
        queryBytes: 100n,
        turnBytes: 500n,
      },
      sessionId,
      turnId,
      AbortSignal.timeout(120000),
      async () => {},
    );
    const reviews = history.messages.flatMap((message) =>
      message.content.kind === "review" ? [message.content.review] : [],
    );
    const rejected = reviews[0]?.verdict?.approved === false;
    const final = history.messages.at(-1)?.content;
    records.push({
      name: scenario.name,
      mode,
      expectedInitialRejection: scenario.incorrect,
      outcome,
      latencyMs: Date.now() - started,
      usage,
      extraQueries,
      errorCaught: scenario.incorrect && rejected,
      falseRejection:
        (!scenario.incorrect && rejected) ||
        (scenario.incorrect && reviews.length > 1 && reviews.at(-1)?.verdict?.approved === false),
      repairAttempts: reviews.length > 1 ? 1 : 0,
      final,
      reviews,
      results: [...results.values()],
    });
    expect(outcome.status).toBe("completed");
    if (mode === "reviewed") {
      expect(rejected).toBe(scenario.incorrect);
      expect(final?.kind).toBe("analysis");
      if (scenario.incorrect && final?.kind === "analysis") {
        expect(final.analysis.narrative).toBe(scenario.repaired.narrative);
      }
    }
  }
});
