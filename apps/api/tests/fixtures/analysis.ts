import type { ModelMessage } from "../../src/llm/messages.ts";
import type { AgentHistory } from "../../src/db/history.ts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { QueryResult } from "@analytics/contracts";
import type { ModelClient, ModelResponse } from "../../src/llm/openrouter.ts";
import type { AgentStore } from "../../src/db/store.ts";
import { RequestError } from "../../src/db/store.ts";
import type { Warehouse } from "../../src/analytics/bigquery.ts";

export const sessionId = randomUUID();
export const turnId = randomUUID();
export const sql =
  "SELECT device.category AS device, COUNT(*) AS purchases FROM `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*` WHERE _TABLE_SUFFIX BETWEEN '20201101' AND '20201130' AND event_name = 'purchase' GROUP BY device";
export const result: QueryResult = {
  origin: "adhoc",
  catalog: null,
  parameters: {},
  justification: null,
  requiredCaveats: [],
  dataQuality: {},
  scope: { kind: "unspecified", topN: null },
  ref: randomUUID(),
  sql,
  purpose: "Purchases by device",
  jobId: "fixture-job",
  bytesProcessed: "10",
  bytesBilled: "10",
  columns: [
    { name: "device", type: "string" },
    { name: "purchases", type: "number" },
  ],
  rows: [
    { device: "desktop", purchases: 12 },
    { device: "mobile", purchases: 3 },
  ],
  complete: true,
  totalRows: "2",
};
export function call(name: string, args: unknown): ModelResponse {
  return {
    message: {
      role: "assistant",
      content: null,
      toolCalls: [{ id: randomUUID(), name, arguments: JSON.stringify(args) }],
    },
    usage: { inputTokens: 10, outputTokens: 10, cost: 0.001 },
  };
}
export function memoryStore(): {
  store: AgentStore;
  history: AgentHistory;
  results: Map<string, QueryResult>;
} {
  const history: AgentHistory = {
    session: {
      id: sessionId,
      title: "New chat",
      titleStatus: "idle",
      titleRevision: 0,
      runningTurn: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    turns: [
      {
        id: turnId,
        clientTurnId: randomUUID(),
        status: "running",
        createdAt: new Date().toISOString(),
        finishedAt: null,
        error: null,
      },
    ],
    messages: [
      {
        id: randomUUID(),
        turnId,
        content: { kind: "model", message: { role: "user", content: "Purchases by device" } },
      },
    ],
  };
  const results = new Map<string, QueryResult>();
  const store: AgentStore = {
    agentHistory: async () => history,
    append: async (_session, turn, content) => {
      history.messages.push({ id: randomUUID(), turnId: turn, content });
    },
    saveResult: async (_session, _turn, data) => {
      results.set(data.ref, data);
    },
    result: async (session, ref) => {
      const saved = results.get(ref);
      if (session !== sessionId || !saved) {
        throw new RequestError(404, "not_found", "Result not found");
      }
      return saved;
    },
    recentResults: async () =>
      [...results.values()].map((data) => ({
        ref: data.ref,
        purpose: data.purpose,
        columns: data.columns,
        complete: data.complete,
      })),
    finish: async (_turn, status, error) => {
      const turn = history.turns[0];
      if (turn) {
        turn.status = status;
        turn.error = error;
      }
    },
    complete: async (_session, turn, content) => {
      history.messages.push({ id: randomUUID(), turnId: turn, content });
      const current = history.turns[0];
      if (current) {
        current.status = "completed";
      }
    },
  };
  return { store, history, results };
}
export function fixtureWarehouse(): Warehouse {
  return {
    inspect: async () => ({
      estimatedBytes: 10n,
      statementType: "SELECT",
      tables: [
        {
          projectId: "bigquery-public-data",
          datasetId: "ga4_obfuscated_sample_ecommerce",
          tableId: "events_20201101",
        },
      ],
      routines: [],
    }),
    execute: async () => ({
      jobId: result.jobId,
      bytesProcessed: result.bytesProcessed,
      bytesBilled: result.bytesBilled,
      data: { columns: result.columns, rows: result.rows, complete: true, totalRows: "2" },
    }),
  };
}
export function fixtureModel(
  beforeFinal: (signal: AbortSignal) => Promise<void> = async () => {},
): ModelClient {
  return {
    complete: async (_system, messages, _tools, signal) => {
      const last = messages.at(-1);
      if (last?.role === "tool") {
        const raw: unknown = JSON.parse(last.content);
        const chart = z.object({ chartId: z.uuid(), resultRef: z.uuid() }).safeParse(raw);
        if (chart.success) {
          await beforeFinal(signal);
          return call("present_analysis", {
            narrative: "Desktop has 12 purchase events; mobile has 3.",
            caveats: ["Obfuscated sample; purchase events are not deduplicated transactions."],
            resultRefs: [chart.data.resultRef],
            chartIds: [chart.data.chartId],
          });
        }
        const query = z.object({ ref: z.uuid() }).safeParse(raw);
        if (query.success) {
          return call("publish_chart", {
            type: "bar",
            title: "Purchases by device",
            resultRef: query.data.ref,
            x: "device",
            y: "purchases",
          });
        }
      }
      return call("run_sql", {
        sql,
        purpose: "Purchases by device",
        justification: "Fixture custom SQL",
      });
    },
  };
}
export function toolOutputs(messages: ModelMessage[]) {
  return messages.filter((message) => message.role === "tool").map((message) => message.content);
}
