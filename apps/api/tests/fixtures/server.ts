import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import {
  analysisSchema,
  chartSpecSchema,
  type ChartSpec,
  queryResultSchema,
} from "@analytics/contracts";
import { createApp } from "../../src/app.ts";
import type { ModelClient } from "../../src/llm/openrouter.ts";
import { testStore } from "./database.ts";
import { call, fixtureModel, fixtureReviewer, fixtureWarehouse, sql } from "./analysis.ts";

const store = await testStore();
await store.recover();
const scripted = fixtureModel();
const revenueSql = sql.replace(
  "COUNT(*) AS purchases",
  "SUM(ecommerce.purchase_revenue_in_usd) AS amount_usd",
);
const warehouse = fixtureWarehouse();
const execute = warehouse.execute;
warehouse.execute = async (...args) => {
  const output = await execute(...args);
  return args[0] === revenueSql
    ? {
        ...output,
        data: {
          columns: [
            { name: "device", type: "string" },
            { name: "amount_usd", type: "number" },
          ],
          rows: [
            { device: "desktop", amount_usd: 1234.56 },
            { device: "mobile", amount_usd: 300 },
          ],
          complete: true,
          totalRows: "2",
        },
      }
    : output;
};
const model: ModelClient = {
  complete: async (system, messages, tools, signal, update) => {
    let prompt = "";
    for (const message of messages) {
      if (message.role === "user") {
        prompt = message.content;
      }
    }
    if (prompt === "Format revenue with early activity") {
      const last = messages.at(-1);
      if (last?.role !== "tool") {
        await update?.({ index: 0, name: "run_sql", arguments: "{" });
        await setTimeout(2000, undefined, { signal });
        return call("run_sql", {
          sql: revenueSql,
          purpose: "Recorded revenue by device",
          justification: "Fixture display metadata",
          display: { amount_usd: { label: "Recorded revenue", format: "usd" } },
        });
      }
      const raw: unknown = JSON.parse(last.content);
      const query = queryResultSchema.safeParse(raw);
      if (query.success) {
        return call("publish_chart", {
          type: "bar",
          title: "Revenue by device",
          resultRef: query.data.ref,
          x: "device",
          y: "amount_usd",
        });
      }
      const chart = z.object({ chartId: z.uuid(), resultRef: z.uuid() }).parse(raw);
      const response = call("present_analysis", {
        narrative: "Desktop recorded $1,234.56 in revenue.",
        caveats: [],
        resultRefs: [chart.resultRef],
        chartIds: [chart.chartId],
      });
      const presentation = response.message.toolCalls[0];
      if (!presentation) {
        throw new Error("Missing revenue presentation");
      }
      await update?.({ index: 0, name: presentation.name, arguments: presentation.arguments });
      return response;
    }
    if (prompt === "Clarify customer frequency") {
      await update?.({
        index: 0,
        name: "present_analysis",
        arguments: '{"narrative":"Discarded clarification draft"}',
      });
      await setTimeout(100, undefined, { signal });
      return call("request_clarification", {
        context: "Choose a frequency measure.",
        questions: ["Purchase events or purchasing sessions?"],
      });
    }
    const last = messages.at(-1);
    if (last?.role === "tool" && last.content.includes('"issues":')) {
      const previous = messages
        .filter(
          (message) =>
            message.role === "assistant" &&
            message.toolCalls.some((tool) => tool.name === "present_analysis"),
        )
        .at(-1);
      if (previous?.role === "assistant") {
        const presentation = previous.toolCalls.find((tool) => tool.name === "present_analysis");
        if (presentation) {
          const raw: unknown = JSON.parse(presentation.arguments);
          return call("present_analysis", {
            ...analysisSchema.parse(raw),
            narrative: "Desktop has 12 purchase events; mobile has 3.",
          });
        }
      }
    }
    let response = await scripted.complete(system, messages, tools, signal);
    const tool = response.message.toolCalls[0];
    if (!tool) {
      return response;
    }
    if (tool.name === "publish_chart") {
      const raw: unknown = JSON.parse(tool.arguments);
      const original = chartSpecSchema.parse(raw);
      const base = { title: original.title, resultRef: original.resultRef };
      let spec: ChartSpec;
      if (prompt.includes("stacked")) {
        spec = { ...base, type: "stacked_bar", x: "device", y: "purchases", series: "device" };
      } else if (prompt.includes("line")) {
        spec = { ...base, type: "line", x: "device", y: "purchases" };
      } else if (prompt.includes("table")) {
        spec = { ...base, type: "table", columns: ["device", "purchases"] };
      } else if (prompt.includes("KPI")) {
        spec = { ...base, type: "kpi", column: "purchases", row: 0 };
      } else {
        spec = { ...base, type: "bar", x: "device", y: "purchases" };
      }
      return call("publish_chart", spec);
    }
    if (tool.name !== "present_analysis") {
      return response;
    }
    if (
      prompt.includes("Repair") &&
      !messages.some(
        (message) =>
          message.role === "assistant" &&
          message.toolCalls.some((candidate) => candidate.arguments.includes("Rejected draft")),
      )
    ) {
      const raw: unknown = JSON.parse(tool.arguments);
      response = call("present_analysis", {
        ...analysisSchema.parse(raw),
        narrative: "Rejected draft — incorrect evidence.",
      });
    }
    if (prompt.includes("Markdown")) {
      const raw: unknown = JSON.parse(tool.arguments);
      response = call("present_analysis", {
        ...analysisSchema.parse(raw),
        narrative:
          "# Findings\n\n**Desktop** leads.\n\n- Mobile has *3* purchases.\n\n> Sample data\n\n[Source](https://example.com)\n\n| Device | Purchases |\n| --- | --- |\n| " +
          "desktop".repeat(30) +
          " | 12 |\n\n```sql\nSELECT " +
          "device, ".repeat(60) +
          "purchases\n```\n\n<script>alert(1)</script>\n\n![tracking](https://example.com/image)\n\n[unsafe](javascript:alert%281%29)",
        caveats: ["**Obfuscated** sample"],
      });
    }
    const presentation = response.message.toolCalls[0];
    if (!presentation) {
      throw new Error("Missing presentation fixture");
    }
    const chunkSize = prompt.includes("Markdown") ? 120 : 12;
    for (let length = chunkSize; length < presentation.arguments.length; length += chunkSize) {
      await update?.({
        index: 0,
        name: presentation.name,
        arguments: presentation.arguments.slice(0, length),
      });
      await setTimeout(75, undefined, { signal });
    }
    await update?.({ index: 0, name: presentation.name, arguments: presentation.arguments });
    if (prompt.includes("Fail")) {
      throw new Error("Scripted model failure");
    }
    return response;
  },
};
const reviewer = fixtureReviewer();
const approvingModel = reviewer.model;
reviewer.model = {
  complete: async (system, messages, tools, signal) => {
    const first = messages[0];
    if (first?.role !== "user") {
      throw new Error("Missing review input");
    }
    const raw: unknown = JSON.parse(first.content);
    const input = z
      .object({
        conversation: z.array(
          z.object({ role: z.string(), content: z.string().nullable().optional() }),
        ),
        candidate: analysisSchema,
      })
      .parse(raw);
    const prompt =
      input.conversation.filter((message) => message.role === "user").at(-1)?.content ?? "";
    if (prompt.includes("Hold")) {
      await setTimeout(60000, undefined, { signal });
    }
    if (prompt.includes("Review")) {
      await setTimeout(2000, undefined, { signal });
    }
    if (prompt.includes("Reject") || input.candidate.narrative.includes("Rejected draft")) {
      return call("review_analysis", {
        approved: false,
        issues: [
          { problem: "The count is unsupported", correction: "Use the saved purchase counts" },
        ],
      });
    }
    return approvingModel.complete(system, messages, tools, signal);
  },
};
const backend = createApp({
  store,
  origin: "http://127.0.0.1:5174",
  titles: {
    complete: async (prompts) => ({
      title: prompts[0]?.slice(0, 60) ?? "Analysis",
      usage: { inputTokens: 4, outputTokens: 4, cost: 0.001 },
    }),
  },
  model,
  reviewer,
  warehouse,
  queryBytes: 100n,
  turnBytes: 500n,
});
const server = backend.app.listen(3101, "127.0.0.1");
const finish = async () => {
  server.close();
  await backend.shutdown();
  await store.pool.end();
  server.closeAllConnections();
};
const stop = () => {
  const task = finish();
  task.then(
    () => {
      process.exitCode = 0;
    },
    () => {
      process.exitCode = 1;
    },
  );
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
