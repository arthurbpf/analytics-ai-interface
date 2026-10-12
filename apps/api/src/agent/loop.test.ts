import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { StreamEvent } from "@analytics/contracts";
import { runAgent, type AgentDependencies } from "./loop.ts";
import {
  call,
  fixtureModel,
  fixtureWarehouse,
  memoryStore,
  sessionId,
  turnId,
  sql,
  toolOutputs,
  result,
} from "../../tests/fixtures/analysis.ts";

function setup() {
  const state = memoryStore();
  const events: StreamEvent[] = [];
  const deps: AgentDependencies = {
    store: state.store,
    model: fixtureModel(),
    warehouse: fixtureWarehouse(),
    queryBytes: 100n,
    turnBytes: 500n,
  };
  const emit = async (event: StreamEvent) => {
    events.push(event);
  };
  return { ...state, deps, events, emit };
}
it("persists and publishes a chart before the authoritative final answer", async () => {
  const { deps, events, emit, history, results } = setup();
  expect(await runAgent(deps, sessionId, turnId, new AbortController().signal, emit)).toEqual({
    status: "completed",
    error: null,
  });
  expect(history.turns[0]?.status).toBe("completed");
  expect(results.size).toBe(1);
  expect(
    events
      .filter((event) => event.type === "chart_ready" || event.type === "analysis_ready")
      .map((event) => event.type),
  ).toEqual(["chart_ready", "analysis_ready"]);
  const answer = history.messages.at(-1)?.content;
  expect(answer?.kind).toBe("analysis");
  expect(
    history.messages.some(
      (message) =>
        message.content.kind === "model" &&
        message.content.message.role === "tool" &&
        message.content.message.content.includes("accepted"),
    ),
  ).toBe(true);
});
it("returns malformed and unknown tool errors for correction, then succeeds", async () => {
  const { deps, emit } = setup();
  const next = fixtureModel();
  let requests = 0;
  deps.model = {
    complete: async (system, messages, tools, signal) => {
      requests++;
      if (requests === 1) {
        const bad = call("run_sql", {});
        const first = bad.message.toolCalls[0];
        if (first) {
          first.arguments = "{";
        }
        return bad;
      }
      if (requests === 2) {
        expect(toolOutputs(messages).at(-1)).toContain("valid JSON");
        return call("unknown", {});
      }
      if (requests === 3) {
        expect(toolOutputs(messages).at(-1)).toContain("Unknown tool");
      }
      return next.complete(system, messages, tools, signal);
    },
  };
  expect((await runAgent(deps, sessionId, turnId, new AbortController().signal, emit)).status).toBe(
    "completed",
  );
});
it("repairs a prohibited SQL query without executing it", async () => {
  const { deps, emit } = setup();
  const normal = fixtureModel();
  let calls = 0;
  deps.warehouse.execute = vi.fn(deps.warehouse.execute);
  deps.model = {
    complete: async (system, messages, tools, signal) => {
      calls++;
      if (calls === 1) {
        return call("run_sql", { sql: "DELETE FROM prohibited", purpose: "Bad" });
      }
      return normal.complete(system, messages, tools, signal);
    },
  };
  expect((await runAgent(deps, sessionId, turnId, new AbortController().signal, emit)).status).toBe(
    "completed",
  );
  expect(deps.warehouse.execute).toHaveBeenCalledTimes(1);
});
it("repairs a chart mapping without streaming an invalid chart", async () => {
  const { deps, emit, events } = setup();
  const normal = fixtureModel();
  let requests = 0;
  deps.model = {
    complete: async (system, messages, tools, signal) => {
      requests++;
      const response = await normal.complete(system, messages, tools, signal);
      if (requests === 2) {
        const first = response.message.toolCalls[0];
        if (first) {
          const raw: unknown = JSON.parse(first.arguments);
          const { chartSpecSchema } = await import("@analytics/contracts");
          first.arguments = JSON.stringify({ ...chartSpecSchema.parse(raw), y: "missing" });
        }
      }
      if (requests === 3) {
        const history = await deps.store.agentHistory(sessionId);
        const chart = history.messages.find(
          (message) =>
            message.content.kind === "model" &&
            message.content.message.role === "assistant" &&
            message.content.message.toolCalls.some((tool) => tool.name === "publish_chart"),
        );
        if (chart?.content.kind === "model" && chart.content.message.role === "assistant") {
          const first = chart.content.message.toolCalls[0];
          if (first) {
            const { chartSpecSchema } = await import("@analytics/contracts");
            const raw: unknown = JSON.parse(first.arguments);
            return call("publish_chart", { ...chartSpecSchema.parse(raw), y: "purchases" });
          }
        }
      }
      return response;
    },
  };
  expect((await runAgent(deps, sessionId, turnId, new AbortController().signal, emit)).status).toBe(
    "completed",
  );
  expect(events.filter((event) => event.type === "chart_ready")).toHaveLength(1);
});
it("plain prose cannot complete; last call exposes only presentation", async () => {
  const { deps, emit, history } = setup();
  let requests = 0;
  deps.model = {
    complete: async (_system, _messages, tools) => {
      requests++;
      if (requests === 8) {
        expect(tools.map((tool) => tool.function.name)).toEqual(["present_analysis"]);
      }
      return {
        message: { role: "assistant", content: "Done", toolCalls: [] },
        usage: { inputTokens: 1, outputTokens: 1, cost: null },
      };
    },
  };
  expect((await runAgent(deps, sessionId, turnId, new AbortController().signal, emit)).status).toBe(
    "failed",
  );
  expect(requests).toBe(8);
  expect(history.messages.some((message) => message.content.kind === "analysis")).toBe(false);
});
it("keeps charts after disconnect and aborts pending model work", async () => {
  const { deps, events, emit, history } = setup();
  const controller = new AbortController();
  deps.model = fixtureModel(async (signal) => {
    controller.abort(new Error("Disconnected"));
    signal.throwIfAborted();
  });
  expect((await runAgent(deps, sessionId, turnId, controller.signal, emit)).status).toBe(
    "interrupted",
  );
  expect(events.some((event) => event.type === "chart_ready")).toBe(true);
  expect(history.turns[0]?.status).toBe("interrupted");
});
it("does not emit success on persistence failure or retry vendor failure", async () => {
  const { deps, emit, events } = setup();
  deps.store.complete = async () => {
    throw new Error("Database offline");
  };
  expect((await runAgent(deps, sessionId, turnId, new AbortController().signal, emit)).status).toBe(
    "failed",
  );
  expect(events.some((event) => event.type === "analysis_ready")).toBe(false);
  const failed = setup();
  const complete = vi.fn(async () => {
    throw new Error("Vendor offline");
  });
  failed.deps.model = { complete };
  expect(
    (await runAgent(failed.deps, sessionId, turnId, new AbortController().signal, failed.emit))
      .status,
  ).toBe("failed");
  expect(complete).toHaveBeenCalledTimes(1);
});
it("preserves completion when transport closes after commit", async () => {
  const { deps, history } = setup();
  const emit = vi.fn(async (event: StreamEvent) => {
    if (event.type === "analysis_ready") {
      throw new Error("Closed after commit");
    }
  });
  expect((await runAgent(deps, sessionId, turnId, new AbortController().signal, emit)).status).toBe(
    "completed",
  );
  expect(history.turns[0]?.status).toBe("completed");
});
it("executes tool calls sequentially and rejects presentation before later calls", async () => {
  const { deps, emit } = setup();
  const normal = fixtureModel();
  let requests = 0;
  deps.model = {
    complete: async (system, messages, tools, signal) => {
      requests++;
      if (requests === 1) {
        const response = call("present_analysis", {
          narrative: "Too soon",
          caveats: [],
          resultRefs: [],
          chartIds: [],
        });
        response.message.toolCalls.push(
          ...call("run_sql", { sql, purpose: "Device" }).message.toolCalls,
        );
        return response;
      }
      return normal.complete(system, messages, tools, signal);
    },
  };
  expect((await runAgent(deps, sessionId, turnId, new AbortController().signal, emit)).status).toBe(
    "completed",
  );
});
it("rejects unpublished final chart references", async () => {
  const { deps, emit } = setup();
  deps.model = {
    complete: async () =>
      call("present_analysis", {
        narrative: "Bad reference",
        caveats: [],
        resultRefs: [],
        chartIds: [randomUUID()],
      }),
  };
  expect((await runAgent(deps, sessionId, turnId, new AbortController().signal, emit)).status).toBe(
    "failed",
  );
});
it("enforces SQL and chart counts separately from the model budget", async () => {
  const queries = setup();
  const execute = vi.fn(queries.deps.warehouse.execute);
  queries.deps.warehouse.execute = execute;
  queries.deps.model = {
    complete: async () => call("run_sql", { sql, purpose: "Repeated query" }),
  };
  expect(
    (await runAgent(queries.deps, sessionId, turnId, new AbortController().signal, queries.emit))
      .status,
  ).toBe("failed");
  expect(execute).toHaveBeenCalledTimes(5);
  const charts = setup();
  charts.results.set(result.ref, result);
  charts.deps.model = {
    complete: async () =>
      call("publish_chart", {
        type: "table",
        title: "Repeated chart",
        resultRef: result.ref,
        columns: ["device"],
      }),
  };
  expect(
    (await runAgent(charts.deps, sessionId, turnId, new AbortController().signal, charts.emit))
      .status,
  ).toBe("failed");
  expect(charts.events.filter((event) => event.type === "chart_ready")).toHaveLength(4);
});
it("retrieves existing results without additional warehouse execution", async () => {
  const { deps, results, emit } = setup();
  results.set(result.ref, result);
  const next = fixtureModel();
  let requests = 0;
  const execute = vi.fn(deps.warehouse.execute);
  deps.warehouse.execute = execute;
  deps.model = {
    complete: async (system, messages, tools, signal) => {
      requests++;
      if (requests === 1) {
        return call("get_result", { resultRef: result.ref });
      }
      return next.complete(system, messages, tools, signal);
    },
  };
  expect((await runAgent(deps, sessionId, turnId, new AbortController().signal, emit)).status).toBe(
    "completed",
  );
  expect(execute).not.toHaveBeenCalled();
});
it("propagates cancellation into an active warehouse operation", async () => {
  const { deps, emit } = setup();
  const controller = new AbortController();
  let cancelled = false;
  deps.warehouse.execute = async (_sql, _cap, signal) => {
    controller.abort(new Error("Deadline"));
    cancelled = signal.aborted;
    signal.throwIfAborted();
    throw new Error("Unreachable");
  };
  expect((await runAgent(deps, sessionId, turnId, controller.signal, emit)).status).toBe(
    "interrupted",
  );
  expect(cancelled).toBe(true);
});
it("refuses to stream a chart when its persistence fails", async () => {
  const { deps, emit, events } = setup();
  const append = deps.store.append;
  deps.store.append = async (...args) => {
    if (args[2].kind === "chart") {
      throw new Error("Database offline");
    }
    await append(...args);
  };
  expect((await runAgent(deps, sessionId, turnId, new AbortController().signal, emit)).status).toBe(
    "failed",
  );
  expect(events.some((event) => event.type === "chart_ready")).toBe(false);
});

it("streams only presentation drafts, discards failed validation, and replaces with a repaired answer", async () => {
  const { deps, events, emit, history } = setup();
  let attempts = 0;
  deps.model = {
    complete: async (_system, _messages, _tools, _signal, update) => {
      attempts++;
      await update?.({ index: 1, name: "run_sql", arguments: '{"sql":"secret"}' });
      const narrative = attempts === 1 ? 'Rejected "draft"\n📊' : 'Repaired "answer"\n📊';
      const response = call("present_analysis", {
        narrative,
        caveats: [],
        resultRefs: [],
        chartIds: attempts === 1 ? [randomUUID()] : [],
      });
      const args = response.message.toolCalls[0]?.arguments;
      if (!args) {
        throw new Error("Missing fixture arguments");
      }
      for (let length = 1; length <= args.length; length++) {
        await update?.({ index: 0, name: "present_analysis", arguments: args.slice(0, length) });
      }
      return response;
    },
  };
  expect((await runAgent(deps, sessionId, turnId, new AbortController().signal, emit)).status).toBe(
    "completed",
  );
  const starts = events.filter((event) => event.type === "analysis_started");
  expect(starts).toHaveLength(2);
  expect(events.filter((event) => event.type === "analysis_discarded")).toEqual([
    { type: "analysis_discarded", turnId, draftId: starts[0]?.draftId },
  ]);
  const draft = events
    .filter((event) => event.type === "analysis_delta")
    .filter((event) => event.draftId === starts[1]?.draftId)
    .map((event) => event.delta)
    .join("");
  expect(draft).toBe('Repaired "answer"\n📊');
  expect(JSON.stringify(events)).not.toContain("secret");
  expect(history.messages.filter((message) => message.content.kind === "analysis")).toHaveLength(1);
});
