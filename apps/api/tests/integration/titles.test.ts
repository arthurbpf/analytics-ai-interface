import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { sessions, titleAttempts } from "../../src/db/schema.ts";
import type { Store } from "../../src/db/store.ts";
import { generateTitle, type TitleClient } from "../../src/llm/titles.ts";
import { testStore } from "../fixtures/database.ts";
let store: Store;
const ids: string[] = [];
beforeAll(async () => {
  store = await testStore();
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  if (store) {
    for (const id of ids) {
      await store.db.delete(sessions).where(eq(sessions.id, id));
    }
    await store.pool.end();
  }
});
async function create() {
  const session = await store.createSession();
  ids.push(session.id);
  return session.id;
}
const usage = { inputTokens: 3, outputTokens: 4, cost: 0.001 };
it("triggers exactly on persisted prompts 1 and 3, including failed or interrupted analyses", async () => {
  const id = await create();
  const first = await store.startTurn(id, randomUUID(), "First intent");
  expect(first.titleAttempt).toEqual({ revision: 1, prompts: ["First intent"] });
  expect((await store.history(id)).session).toMatchObject({
    title: "First intent",
    titleStatus: "pending",
    titleRevision: 1,
  });
  await store.finish(first.id, "failed", null);
  await expect(store.startTurn(id, first.clientTurnId, "Retry")).rejects.toMatchObject({
    code: "duplicate_turn",
  });
  const second = await store.startTurn(id, randomUUID(), "Second intent");
  expect(second.titleAttempt).toBeNull();
  await store.finish(second.id, "interrupted", null);
  const third = await store.startTurn(id, randomUUID(), "Third intent");
  expect(third.titleAttempt).toEqual({
    revision: 3,
    prompts: ["First intent", "Second intent", "Third intent"],
  });
  await store.finish(third.id, "failed", null);
  const fourth = await store.startTurn(id, randomUUID(), "Fourth");
  expect(fourth.titleAttempt).toBeNull();
  const attempts = await store.db
    .select()
    .from(titleAttempts)
    .where(eq(titleAttempts.sessionId, id));
  expect(attempts.map((attempt) => attempt.revision)).toEqual(expect.arrayContaining([1, 3]));
  expect(attempts).toHaveLength(2);
});
it("rejects out-of-order title writes while retaining separate usage for both attempts", async () => {
  const id = await create();
  const first = await store.startTurn(id, randomUUID(), "First");
  await store.finish(first.id, "failed", null);
  const second = await store.startTurn(id, randomUUID(), "Second");
  await store.finish(second.id, "failed", null);
  await store.startTurn(id, randomUUID(), "Third");
  expect(await store.finishTitle(id, 3, "Refined title", usage)).not.toBeNull();
  expect(await store.finishTitle(id, 1, "Old title", usage)).toBeNull();
  expect((await store.history(id)).session).toMatchObject({
    title: "Refined title",
    titleStatus: "succeeded",
    titleRevision: 3,
  });
  const attempts = await store.db
    .select()
    .from(titleAttempts)
    .where(eq(titleAttempts.sessionId, id));
  expect(attempts.every((attempt) => attempt.usage?.cost === usage.cost)).toBe(true);
  expect(await store.finishTitle(id, 3, "Replay", usage)).toBeNull();
});
it("retains fallback or previous titles after invalid output, failure, timeout, and restart", async () => {
  const id = await create();
  const first = await store.startTurn(id, randomUUID(), "Fallback");
  if (!first.titleAttempt) {
    throw new Error("Missing title attempt");
  }
  const invalid: TitleClient = { complete: async () => ({ title: "", usage }) };
  await generateTitle(store, invalid, id, first.titleAttempt);
  expect((await store.history(id)).session).toMatchObject({
    title: "Fallback",
    titleStatus: "failed",
  });
  const [attempt] = await store.db
    .select()
    .from(titleAttempts)
    .where(eq(titleAttempts.sessionId, id));
  expect(attempt?.usage).toEqual(usage);
  await store.finish(first.id, "failed", null);
  const second = await store.startTurn(id, randomUUID(), "Second");
  await store.finish(second.id, "failed", null);
  const third = await store.startTurn(id, randomUUID(), "Third");
  if (!third.titleAttempt) {
    throw new Error("Missing third title attempt");
  }
  let signal: AbortSignal | undefined;
  const hanging: TitleClient = {
    complete: async (_prompts, abort) => {
      signal = abort;
      return new Promise(() => {});
    },
  };
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const task = generateTitle(store, hanging, id, third.titleAttempt);
  await vi.advanceTimersByTimeAsync(10000);
  await task;
  vi.useRealTimers();
  expect(signal?.aborted).toBe(true);
  expect((await store.history(id)).session.title).toBe("Fallback");
  const restart = await create();
  const pending = await store.startTurn(restart, randomUUID(), "Retain this");
  await store.recover();
  expect((await store.history(restart)).session).toMatchObject({
    title: "Retain this",
    titleStatus: "failed",
  });
  expect(await store.finishTitle(restart, 1, "Late write", usage)).toBeNull();
  expect((await store.history(restart)).turns.find((turn) => turn.id === pending.id)?.status).toBe(
    "interrupted",
  );
});
it("retains an existing successful title when revision 3 fails", async () => {
  const id = await create();
  const first = await store.startTurn(id, randomUUID(), "First");
  await store.finishTitle(id, 1, "Initial summary", usage);
  await store.finish(first.id, "failed", null);
  const second = await store.startTurn(id, randomUUID(), "Second");
  await store.finish(second.id, "failed", null);
  const third = await store.startTurn(id, randomUUID(), "Third");
  if (!third.titleAttempt) {
    throw new Error("Missing attempt");
  }
  const failure: TitleClient = {
    complete: async () => {
      throw new Error("Unavailable");
    },
  };
  await generateTitle(store, failure, id, third.titleAttempt);
  expect((await store.history(id)).session).toMatchObject({
    title: "Initial summary",
    titleStatus: "failed",
    titleRevision: 3,
  });
});
