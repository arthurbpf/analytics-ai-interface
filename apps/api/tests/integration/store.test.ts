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
beforeAll(async () => { store = await testStore(); });
afterAll(async () => { if (store) { for (const id of created) { await store.db.delete(sessions).where(eq(sessions.id, id)); } await store.pool.end(); } });
async function session() { const createdSession = await store.createSession(); created.push(createdSession.id); return createdSession; }
it("persists ordered messages, query rows, charts and answer across connection restart", async () => {
  const s = await session(); const turn = await store.startTurn(s.id, randomUUID(), "Device purchases");
  await store.saveResult(s.id, turn.id, result);
  const chart = validateChart({ type: "bar", title: "Device", resultRef: result.ref, x: "device", y: "purchases" }, result);
  await store.append(s.id, turn.id, { kind: "chart", chart });
  const analysis = { narrative: "Findings", caveats: [], resultRefs: [result.ref], chartIds: [chart.id] };
  await store.complete(s.id, turn.id, { kind: "analysis", analysis }, null);
  const reopened = new Store(process.env["TEST_DATABASE_URL"] ?? "postgresql://localhost:5432/analytics_test");
  try {
    const history = await reopened.history(s.id);
    expect(history.turns[0]?.status).toBe("completed");
    expect(history.messages.map((message) => message.content.kind)).toEqual(["model", "chart", "analysis"]);
    expect(await reopened.result(s.id, result.ref)).toEqual(result);
    expect(history.messages[1]?.content).toEqual({ kind: "chart", chart });
  } finally { await reopened.pool.end(); }
});
it("serializes concurrent starts and deduplicates completed requests", async () => {
  const s = await session(); const request = randomUUID();
  const starts = await Promise.allSettled([store.startTurn(s.id, request, "One"), store.startTurn(s.id, randomUUID(), "Two")]);
  expect(starts.filter((start) => start.status === "fulfilled")).toHaveLength(1);
  const history = await store.history(s.id); const turn = history.turns[0]; if (!turn) { throw new Error("Missing turn"); }
  await store.finish(turn.id, "completed", null);
  await expect(store.startTurn(s.id, turn.clientTurnId, "Retry")).rejects.toMatchObject({ status: 409, code: "duplicate_turn" });
});
it("isolates result references and exposes recent references for retrieval", async () => {
  const s = await session(); const other = await session(); const turn = await store.startTurn(s.id, randomUUID(), "One");
  const data = { ...result, ref: randomUUID() }; await store.saveResult(s.id, turn.id, data);
  await expect(store.result(other.id, data.ref)).rejects.toMatchObject({ status: 404 });
  expect(await store.recentResults(s.id)).toEqual([{ ref: data.ref, purpose: data.purpose, columns: data.columns, complete: true }]);
});
it("marks running turns interrupted on startup without deleting saved artifacts", async () => {
  const s = await session(); const turn = await store.startTurn(s.id, randomUUID(), "One");
  await store.append(s.id, turn.id, { kind: "chart", chart: validateChart({ type: "table", title: "Table", resultRef: result.ref, columns: ["device"] }, result) });
  await store.recover();
  const history = await store.history(s.id); expect(history.turns[0]?.status).toBe("interrupted"); expect(history.messages.at(-1)?.content.kind).toBe("chart");
});
it("answers a follow-up with persisted prior context and a fresh query", async () => {
  const s = await session(); const first = await store.startTurn(s.id, randomUUID(), "Purchases by device in November");
  const warehouse = fixtureWarehouse(); let executions = 0; const execute = warehouse.execute;
  warehouse.execute = async (...args) => { executions++; return execute(...args); };
  const deps = { store, model: fixtureModel(), warehouse, queryBytes: 100n, turnBytes: 500n };
  await runAgent(deps, s.id, first.id, new AbortController().signal, async () => {});
  const followup = await store.startTurn(s.id, randomUUID(), "Now break that down further");
  const normal = fixtureModel(); let sawContext = false;
  deps.model = { complete: async (system, messages, tools, signal) => {
    sawContext ||= messages.some((message) => message.role === "user" && message.content.includes("November"));
    return normal.complete(system, messages, tools, signal);
  } };
  const outcome = await runAgent(deps, s.id, followup.id, new AbortController().signal, async () => {});
  expect(outcome.status).toBe("completed"); expect(sawContext).toBe(true); expect(executions).toBe(2);
});
