import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Store } from "../../src/db/store.ts";
import { sessions } from "../../src/db/schema.ts";
import { testStore } from "../fixtures/database.ts";
import { result, fixtureModel, fixtureWarehouse } from "../fixtures/analysis.ts";
import { validateChart } from "../../src/agent/presentation.ts";
import { runAgent } from "../../src/agent/loop.ts";

let store: Store;
const created: string[] = [];
beforeAll(async () => {
  store = await testStore();
});
afterAll(async () => {
  if (store) {
    for (const id of created) {
      await store.db.delete(sessions).where(eq(sessions.id, id));
    }
    await store.pool.end();
  }
});
async function session() {
  const createdSession = await store.createSession();
  created.push(createdSession.id);
  return createdSession;
}
it("persists ordered messages, query rows, charts and answer across connection restart", async () => {
  const s = await session();
  const turn = await store.startTurn(s.id, randomUUID(), "Device purchases");
  await store.append(s.id, turn.id, {
    kind: "model",
    message: {
      role: "assistant",
      content: "Internal reasoning",
      toolCalls: [{ id: "call-1", name: "run_sql", arguments: "{}" }],
    },
  });
  await store.append(s.id, turn.id, {
    kind: "model",
    message: { role: "tool", toolCallId: "call-1", content: "Internal result" },
  });
  const formattedResult = {
    ...result,
    columns: result.columns.map((column) =>
      column.name === "purchases"
        ? { ...column, display: { label: "Purchase events", format: "integer" as const } }
        : column,
    ),
  };
  await store.saveResult(s.id, turn.id, formattedResult);
  const chart = validateChart(
    { type: "bar", title: "Device", resultRef: result.ref, x: "device", y: "purchases" },
    formattedResult,
  );
  await store.append(s.id, turn.id, { kind: "chart", chart });
  const analysis = {
    narrative: "Findings",
    caveats: [],
    resultRefs: [result.ref],
    chartIds: [chart.id],
  };
  await store.complete(s.id, turn.id, { kind: "analysis", analysis }, null);
  const reopened = new Store(
    process.env["TEST_DATABASE_URL"] ?? "postgresql://localhost:5432/analytics_test",
  );
  try {
    const history = await reopened.history(s.id);
    expect((await reopened.agentHistory(s.id)).messages).toHaveLength(5);
    expect(history.messages[0]?.content).toEqual({ kind: "user", text: "Device purchases" });
    expect(history.turns[0]?.status).toBe("completed");
    expect(history.messages.map((message) => message.content.kind)).toEqual([
      "user",
      "chart",
      "analysis",
    ]);
    expect(await reopened.result(s.id, result.ref)).toEqual(formattedResult);
    expect(history.messages[1]?.content).toEqual({ kind: "chart", chart });
  } finally {
    await reopened.pool.end();
  }
});
it("serializes concurrent starts and deduplicates completed requests", async () => {
  const s = await session();
  const request = randomUUID();
  const starts = await Promise.allSettled([
    store.startTurn(s.id, request, "One"),
    store.startTurn(s.id, randomUUID(), "Two"),
  ]);
  expect(starts.filter((start) => start.status === "fulfilled")).toHaveLength(1);
  const history = await store.history(s.id);
  const turn = history.turns[0];
  if (!turn) {
    throw new Error("Missing turn");
  }
  await store.finish(turn.id, "completed", null);
  await expect(store.startTurn(s.id, turn.clientTurnId, "Retry")).rejects.toMatchObject({
    status: 409,
    code: "duplicate_turn",
  });
});
it("isolates result references and exposes recent references for retrieval", async () => {
  const s = await session();
  const other = await session();
  const turn = await store.startTurn(s.id, randomUUID(), "One");
  const data = { ...result, ref: randomUUID() };
  await store.saveResult(s.id, turn.id, data);
  await expect(store.result(other.id, data.ref)).rejects.toMatchObject({ status: 404 });
  expect(await store.recentResults(s.id)).toEqual([
    { ref: data.ref, purpose: data.purpose, columns: data.columns, complete: true },
  ]);
});
it("marks running turns interrupted on startup without deleting saved artifacts", async () => {
  const s = await session();
  const turn = await store.startTurn(s.id, randomUUID(), "One");
  await store.append(s.id, turn.id, {
    kind: "chart",
    chart: validateChart(
      { type: "table", title: "Table", resultRef: result.ref, columns: ["device"] },
      result,
    ),
  });
  await store.recover();
  const history = await store.history(s.id);
  expect(history.turns[0]?.status).toBe("interrupted");
  expect(history.messages.at(-1)?.content.kind).toBe("chart");
});
it("answers a follow-up with persisted prior context and a fresh query", async () => {
  const s = await session();
  const first = await store.startTurn(s.id, randomUUID(), "Purchases by device in November");
  const warehouse = fixtureWarehouse();
  let executions = 0;
  const execute = warehouse.execute;
  warehouse.execute = async (...args) => {
    executions++;
    return execute(...args);
  };
  const deps = { store, model: fixtureModel(), warehouse, queryBytes: 100n, turnBytes: 500n };
  await runAgent(deps, s.id, first.id, new AbortController().signal, async () => {});
  const followup = await store.startTurn(s.id, randomUUID(), "Now break that down further");
  const normal = fixtureModel();
  let sawContext = false;
  deps.model = {
    complete: async (system, messages, tools, signal) => {
      sawContext ||= messages.some(
        (message) => message.role === "user" && message.content.includes("November"),
      );
      return normal.complete(system, messages, tools, signal);
    },
  };
  const outcome = await runAgent(
    deps,
    s.id,
    followup.id,
    new AbortController().signal,
    async () => {},
  );
  expect(outcome.status).toBe("completed");
  expect(sawContext).toBe(true);
  expect(executions).toBe(2);
});

it("persists clarification atomically as completed, retains artifacts and accepts a normal follow-up", async () => {
  const s = await session();
  const request = randomUUID();
  const turn = await store.startTurn(s.id, request, "Compare customer frequency");
  const data = { ...result, ref: randomUUID() };
  await store.saveResult(s.id, turn.id, data);
  const clarification = {
    context: "Frequency needs a unit.",
    questions: ["Purchase events or purchasing sessions?"],
  };
  await store.complete(s.id, turn.id, { kind: "clarification", clarification }, null);
  const history = await store.history(s.id);
  expect(history.turns[0]?.status).toBe("completed");
  expect(history.messages.map((message) => message.content.kind)).toEqual([
    "user",
    "clarification",
  ]);
  expect(history.messages.at(-1)?.content).toEqual({ kind: "clarification", clarification });
  expect(await store.result(s.id, data.ref)).toEqual(data);
  await expect(store.startTurn(s.id, request, "Retry")).rejects.toMatchObject({
    code: "duplicate_turn",
  });
  const next = await store.startTurn(s.id, randomUUID(), "Purchasing sessions");
  expect(next.status).toBe("running");
  const { buildContext } = await import("../../src/agent/context.ts");
  expect(JSON.stringify(buildContext(await store.agentHistory(s.id), next.id, 0))).toContain(
    clarification.questions[0],
  );
  await store.finish(next.id, "interrupted", null);
});
