import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { Analysis, MetricRequest, StreamEvent } from "@analytics/contracts";
import { runAgent, type AgentDependencies } from "./loop.ts";
import { buildContext } from "./context.ts";
import { displayHistory } from "../db/history.ts";
import type { ModelClient } from "../llm/openrouter.ts";
import type { TurnUsage } from "../llm/usage.ts";
import {
  call,
  fixtureModel,
  fixtureReviewer,
  fixtureWarehouse,
  memoryStore,
  result,
  sessionId,
  sql,
  toolOutputs,
  turnId,
} from "../../tests/fixtures/analysis.ts";

const candidate: Analysis = {
  narrative: "Desktop has 12 purchase events; mobile has 3.",
  caveats: [],
  resultRefs: [result.ref],
  chartIds: [],
};
const rejection = {
  approved: false,
  issues: [{ problem: "Purchase count is misstated", correction: "Use the saved count of 12" }],
};

function setup() {
  const state = memoryStore();
  state.results.set(result.ref, result);
  const events: StreamEvent[] = [];
  const deps: AgentDependencies = {
    store: state.store,
    model: { complete: async () => call("present_analysis", candidate) },
    reviewer: fixtureReviewer(),
    warehouse: fixtureWarehouse(),
    queryBytes: 100n,
    turnBytes: 500n,
  };
  let usage: TurnUsage | null | undefined;
  const complete = state.store.complete;
  state.store.complete = async (...args) => {
    usage = args[3];
    await complete(...args);
  };
  const finish = state.store.finish;
  state.store.finish = async (...args) => {
    usage = args[3];
    await finish(...args);
  };
  const controller = new AbortController();
  const run = () =>
    runAgent(deps, sessionId, turnId, controller.signal, async (event) => {
      events.push(event);
    });
  return { ...state, deps, events, run, controller, usage: () => usage };
}

it("reviews complete evidence and follow-up context before publishing selected charts", async () => {
  const state = setup();
  state.deps.model = fixtureModel();
  const review = vi.fn<ModelClient["complete"]>(async (_system, messages, tools) => {
    expect(tools.map((tool) => tool.function.name)).toEqual(["review_analysis"]);
    expect(JSON.stringify(messages)).toContain("Purchases by device");
    expect(JSON.stringify(messages)).toContain("mobile");
    expect(JSON.stringify(messages)).toContain("chartSchema");
    expect(JSON.stringify(messages)).toContain(sql);
    expect(state.events.some((event) => event.type === "chart_ready")).toBe(false);
    expect(
      displayHistory(state.history).messages.every((message) => message.content.kind === "user"),
    ).toBe(true);
    return call("review_analysis", { approved: true, issues: [] });
  });
  state.deps.reviewer = { model: { complete: review }, modelName: "review-model" };
  expect((await state.run()).status).toBe("completed");
  expect(review).toHaveBeenCalledOnce();
  expect(state.events.filter((event) => event.type === "analysis_delta")).toHaveLength(0);
  expect(displayHistory(state.history).messages.map((message) => message.content.kind)).toEqual([
    "user",
    "chart",
    "analysis",
  ]);
  expect(state.usage()).toMatchObject({
    modelCalls: 4,
    inputTokens: 40,
    analyst: { modelCalls: 3, inputTokens: 30 },
    reviewer: { modelCalls: 1, inputTokens: 10 },
  });
  expect(JSON.stringify(buildContext(state.history, randomUUID(), 0))).not.toContain(
    "review-model",
  );
});

it("feeds review issues to the analyst and approves one repaired answer", async () => {
  const state = setup();
  let analystCalls = 0;
  let reviewCalls = 0;
  state.deps.model = {
    complete: async (_system, messages) => {
      if (++analystCalls === 2) {
        expect(toolOutputs(messages).at(-1)).toContain("Use the saved count of 12");
      }
      return call("present_analysis", {
        ...candidate,
        narrative: analystCalls === 1 ? "Wrong" : "Corrected",
      });
    },
  };
  state.deps.reviewer = {
    modelName: "review-model",
    model: {
      complete: async () =>
        call("review_analysis", ++reviewCalls === 1 ? rejection : { approved: true, issues: [] }),
    },
  };
  expect((await state.run()).status).toBe("completed");
  expect(analystCalls).toBe(2);
  expect(reviewCalls).toBe(2);
  expect(JSON.stringify(state.events)).not.toContain("Wrong");
  expect(state.events.find((event) => event.type === "analysis_ready")).toMatchObject({
    analysis: { narrative: "Corrected" },
  });
  expect(
    state.history.messages.filter((message) => message.content.kind === "review"),
  ).toHaveLength(2);
});

it("allows a repair query then restricts the last repair call to terminal tools", async () => {
  const state = setup();
  const execute = vi.fn(state.deps.warehouse.execute);
  state.deps.warehouse.execute = execute;
  let calls = 0;
  let reviews = 0;
  state.deps.model = {
    complete: async (_system, messages, tools) => {
      if (++calls === 1) {
        return call("present_analysis", candidate);
      }
      if (calls === 2) {
        return call("run_sql", {
          sql,
          purpose: "Repair",
          justification: "Check the disputed count",
        });
      }
      expect(tools.map((tool) => tool.function.name)).toEqual([
        "request_clarification",
        "present_analysis",
      ]);
      const last = messages.at(-1);
      if (last?.role !== "tool") {
        throw new Error("Missing query evidence");
      }
      const raw: unknown = JSON.parse(last.content);
      const { queryResultSchema } = await import("@analytics/contracts");
      return call("present_analysis", {
        ...candidate,
        resultRefs: [queryResultSchema.parse(raw).ref],
      });
    },
  };
  state.deps.reviewer = {
    modelName: "review-model",
    model: {
      complete: async () =>
        call("review_analysis", ++reviews === 1 ? rejection : { approved: true, issues: [] }),
    },
  };
  expect((await state.run()).status).toBe("completed");
  expect(execute).toHaveBeenCalledOnce();
  expect(state.usage()?.modelCalls).toBe(5);
});

it("does not reset the SQL budget for repairs", async () => {
  const state = setup();
  let calls = 0;
  const execute = vi.fn(state.deps.warehouse.execute);
  state.deps.warehouse.execute = execute;
  state.deps.reviewer = {
    modelName: "review-model",
    model: { complete: async () => call("review_analysis", rejection) },
  };
  state.deps.model = {
    complete: async (_system, messages) => {
      calls++;
      if (calls <= 5 || calls === 7) {
        return call("run_sql", { sql, purpose: "Check", justification: "Fixture custom query" });
      }
      if (calls === 8) {
        expect(toolOutputs(messages).at(-1)).toContain("SQL submission budget");
        return call("request_clarification", {
          context: "Further verification needs more evidence",
          questions: ["Can you narrow the question?"],
        });
      }
      return call("present_analysis", candidate);
    },
  };
  expect((await state.run()).status).toBe("completed");
  expect(execute).toHaveBeenCalledTimes(5);
});

it("withholds output after a second rejection", async () => {
  const state = setup();
  state.deps.reviewer = {
    modelName: "review-model",
    model: { complete: async () => call("review_analysis", rejection) },
  };
  expect(await state.run()).toMatchObject({
    status: "failed",
    error: { code: "analysis_rejected" },
  });
  expect(
    state.events.some((event) => event.type === "analysis_ready" || event.type === "chart_ready"),
  ).toBe(false);
  expect(displayHistory(state.history).messages).toHaveLength(1);
  expect(state.usage()?.modelCalls).toBe(4);
});

it("fails unsuccessful repair without opening another work cycle", async () => {
  const state = setup();
  let calls = 0;
  state.deps.model = {
    complete: async () =>
      ++calls === 1 ? call("present_analysis", candidate) : call("get_schema", {}),
  };
  state.deps.reviewer = {
    modelName: "review-model",
    model: { complete: async () => call("review_analysis", rejection) },
  };
  expect(await state.run()).toMatchObject({
    status: "failed",
    error: { code: "analysis_rejected" },
  });
  expect(calls).toBe(3);
});

it("permits clarification after rejection without another review or chart publication", async () => {
  const state = setup();
  let calls = 0;
  const review = vi.fn(async () => call("review_analysis", rejection));
  state.deps.model = {
    complete: async () =>
      ++calls === 1
        ? call("present_analysis", candidate)
        : call("request_clarification", {
            context: "Ambiguous denominator",
            questions: ["Sessions or users?"],
          }),
  };
  state.deps.reviewer = { modelName: "review-model", model: { complete: review } };
  expect((await state.run()).status).toBe("completed");
  expect(review).toHaveBeenCalledOnce();
  expect(state.events.some((event) => event.type === "clarification_ready")).toBe(true);
});

it.each([
  [
    "missing verdict",
    () => ({
      ...call("review_analysis", {}),
      message: { role: "assistant" as const, content: "Approved", toolCalls: [] },
    }),
  ],
  ["wrong tool", () => call("run_sql", {})],
  ["empty rejection", () => call("review_analysis", { approved: false, issues: [] })],
  ["approval with issues", () => call("review_analysis", { ...rejection, approved: true })],
  [
    "multiple verdicts",
    () => {
      const response = call("review_analysis", { approved: true, issues: [] });
      response.message.toolCalls.push(...call("review_analysis", rejection).message.toolCalls);
      return response;
    },
  ],
  [
    "invalid JSON",
    () => {
      const response = call("review_analysis", {});
      const first = response.message.toolCalls[0];
      if (first) {
        first.arguments = "{";
      }
      return response;
    },
  ],
])("fails closed on %s and retains known provider usage", async (_name, response) => {
  const state = setup();
  const review = vi.fn(async () => response());
  state.deps.reviewer = { modelName: "review-model", model: { complete: review } };
  expect(await state.run()).toMatchObject({ status: "failed", error: { code: "review_failed" } });
  expect(review).toHaveBeenCalledOnce();
  expect(state.usage()?.reviewer?.inputTokens).toBe(10);
  expect(state.events.some((event) => event.type === "analysis_ready")).toBe(false);
});

it("retains unknown reviewer usage on provider failure without retrying", async () => {
  const state = setup();
  const review = vi.fn(async () => {
    throw new Error("Provider offline");
  });
  state.deps.reviewer = { modelName: "review-model", model: { complete: review } };
  expect(await state.run()).toMatchObject({ status: "failed", error: { code: "review_failed" } });
  expect(review).toHaveBeenCalledOnce();
  expect(state.usage()).toMatchObject({
    inputTokens: null,
    cost: null,
    analyst: { inputTokens: 10 },
    reviewer: { inputTokens: null },
  });
  expect(
    state.history.messages.find((message) => message.content.kind === "review")?.content,
  ).toMatchObject({ review: { error: "provider_failed", usage: { inputTokens: null } } });
});

it("does not publish or retry when persisting an approved review fails", async () => {
  const state = setup();
  const append = state.store.append;
  state.store.append = async (...args) => {
    if (args[2].kind === "review") {
      throw new Error("Database offline");
    }
    await append(...args);
  };
  const review = vi.fn(async () => call("review_analysis", { approved: true, issues: [] }));
  state.deps.reviewer = { modelName: "review-model", model: { complete: review } };
  expect((await state.run()).status).toBe("failed");
  expect(review).toHaveBeenCalledOnce();
  expect(state.events.some((event) => event.type === "analysis_ready")).toBe(false);
  expect(state.usage()?.reviewer?.inputTokens).toBe(10);
});

it("interrupts review without publishing or replaying candidates", async () => {
  const state = setup();
  state.deps.model = fixtureModel();
  state.deps.reviewer = {
    modelName: "review-model",
    model: {
      complete: async (_system, _messages, _tools, signal) => {
        state.controller.abort();
        signal.throwIfAborted();
        return call("review_analysis", { approved: true, issues: [] });
      },
    },
  };
  expect((await state.run()).status).toBe("interrupted");
  expect(displayHistory(state.history).messages).toHaveLength(1);
  expect(state.history.messages.some((message) => message.content.kind === "chart_candidate")).toBe(
    true,
  );
  expect(state.usage()?.reviewer?.inputTokens).toBeNull();
});

it("fails review overflow without sending a preview or incurring a reviewer call", async () => {
  const state = setup();
  const refs = Array.from({ length: 3 }, () => randomUUID());
  for (const ref of refs) {
    state.results.set(ref, {
      ...result,
      ref,
      rows: [{ device: "x".repeat(45000), purchases: 12 }],
    });
  }
  state.deps.model = {
    complete: async () => call("present_analysis", { ...candidate, resultRefs: refs }),
  };
  const review = vi.fn(async () => call("review_analysis", { approved: true, issues: [] }));
  state.deps.reviewer = { modelName: "review-model", model: { complete: review } };
  expect(await state.run()).toMatchObject({ status: "failed", error: { code: "review_failed" } });
  expect(review).not.toHaveBeenCalled();
  expect(state.usage()?.reviewer?.modelCalls).toBe(0);
});

it("can use all eight initial calls, two repairs and two reviews within twelve calls", async () => {
  const state = setup();
  let calls = 0;
  let reviews = 0;
  state.deps.model = {
    complete: async () => {
      calls++;
      return calls === 8 || calls === 10
        ? call("present_analysis", candidate)
        : call("get_schema", {});
    },
  };
  state.deps.reviewer = {
    modelName: "review-model",
    model: {
      complete: async () =>
        call("review_analysis", ++reviews === 1 ? rejection : { approved: true, issues: [] }),
    },
  };
  expect((await state.run()).status).toBe("completed");
  expect(state.usage()?.modelCalls).toBe(12);
});

it("skips review for explanations without query evidence", async () => {
  const state = setup();
  const review = vi.fn(async () => call("review_analysis", { approved: true, issues: [] }));
  state.deps.reviewer = { modelName: "review-model", model: { complete: review } };
  state.deps.model = {
    complete: async () =>
      call("present_analysis", {
        ...candidate,
        narrative: "February is outside the available history.",
        resultRefs: [],
      }),
  };
  expect((await state.run()).status).toBe("completed");
  expect(review).not.toHaveBeenCalled();
  expect(state.usage()?.reviewer?.modelCalls).toBe(0);
});

it("skips review for a simple single-result catalog aggregate", async () => {
  const state = setup();
  state.results.set(result.ref, {
    ...result,
    origin: "catalog",
    catalog: {
      arguments: {
        metric: "purchases",
        startDate: "2020-11-01",
        endDate: "2021-01-31",
        dimensions: ["device"],
        filters: [],
      },
      definition: "Purchase-event count.",
    },
  });
  const review = vi.fn(async () => call("review_analysis", { approved: true, issues: [] }));
  state.deps.reviewer = { modelName: "review-model", model: { complete: review } };
  expect((await state.run()).status).toBe("completed");
  expect(review).not.toHaveBeenCalled();
  expect(state.usage()?.reviewer?.modelCalls).toBe(0);
});

it("reviews a chart", async () => {
  const state = setup();
  const review = vi.fn(async () => call("review_analysis", { approved: true, issues: [] }));
  state.deps.reviewer = { modelName: "review-model", model: { complete: review } };
  state.deps.model = fixtureModel();
  expect((await state.run()).status).toBe("completed");
  expect(review).toHaveBeenCalledOnce();
});

it.each<[string, Partial<MetricRequest>]>([
  ["a catalog rate", { metric: "conversion" }],
  ["a time series", { grain: "day" }],
  ["a filtered catalog result", { filters: [{ field: "device", op: "eq", value: "desktop" }] }],
])("reviews %s", async (_name, extra) => {
  const state = setup();
  state.results.set(result.ref, {
    ...result,
    origin: "catalog",
    catalog: {
      arguments: {
        metric: "purchases",
        startDate: "2020-11-01",
        endDate: "2021-01-31",
        dimensions: [],
        filters: [],
        ...extra,
      },
      definition: "Purchase-event count.",
    },
  });
  const review = vi.fn(async () => call("review_analysis", { approved: true, issues: [] }));
  state.deps.reviewer = { modelName: "review-model", model: { complete: review } };
  expect((await state.run()).status).toBe("completed");
  expect(review).toHaveBeenCalledOnce();
});
