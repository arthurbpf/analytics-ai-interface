import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { historySchema, readEvents, sessionSchema, type StreamEvent } from "@analytics/contracts";
import { createApp } from "../../src/app.ts";
import * as schema from "../../src/db/schema.ts";
import type { Store } from "../../src/db/store.ts";
import { fixtureModel, fixtureReviewer, fixtureWarehouse } from "../fixtures/analysis.ts";
import { testStore } from "../fixtures/database.ts";

const origin = "http://load.test";
const poolMax = 5;
const concurrency = poolMax + 3;

let store: Store;
let server: Server;
let base: string;
let hold: Promise<void> | undefined;
let releaseHold: (() => void) | undefined;

/**
 * Blocks turns at their final model call until {@link resumeHold} is called.
 */
function startHold() {
  hold = new Promise<void>((resolve) => {
    releaseHold = () => {
      resolve();
    };
  });
}

/**
 * Releases turns blocked by {@link startHold}.
 */
function resumeHold() {
  releaseHold?.();
  hold = undefined;
  releaseHold = undefined;
}

/**
 * Waits for a held turn to be released, or rejects when its request is aborted.
 *
 * @param gate - Release gate created by {@link startHold}.
 * @param signal - Abort signal for the in-flight turn.
 */
async function awaitHold(gate: Promise<void>, signal: AbortSignal) {
  if (signal.aborted) {
    throw new Error("Interrupted");
  }
  const aborted = new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("Interrupted")), {
      once: true,
    });
  });
  await Promise.race([gate, aborted]);
}

beforeAll(async () => {
  store = await testStore();
  await store.recover();
  const backend = createApp({
    store,
    origin,
    model: fixtureModel(async (signal) => {
      if (hold) {
        await awaitHold(hold, signal);
      }
    }),
    reviewer: fixtureReviewer(),
    warehouse: fixtureWarehouse(),
    queryBytes: 100n,
    turnBytes: 500n,
  });
  server = backend.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
  });
  base = `http://127.0.0.1:${portOf(server)}`;
});

afterEach(() => {
  resumeHold();
  hold = undefined;
});

afterAll(async () => {
  server.close();
  await store.pool.end();
  server.closeAllConnections();
});

/**
 * Reads the bound TCP port from a listening server.
 *
 * @param target - Listening HTTP server.
 * @returns The bound port number.
 */
function portOf(target: Server): number {
  const address = target.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a listening TCP server");
  }
  return address.port;
}

/**
 * Creates an anonymous guest and returns its auth cookie pair.
 *
 * @returns The `analytics_auth` cookie header value.
 */
async function guest() {
  const response = await fetch(`${base}/api/auth/guest`, {
    method: "POST",
    headers: { Origin: origin },
  });
  const [cookie] = response.headers.getSetCookie();
  if (!cookie) {
    throw new Error("Missing auth cookie");
  }
  return cookie.split(";")[0] ?? "";
}

/**
 * Creates a session owned by the given credential.
 *
 * @param cookie - Auth cookie header value.
 * @returns The created session.
 */
async function createSession(cookie: string) {
  const response = await fetch(`${base}/api/sessions`, {
    method: "POST",
    headers: { Origin: origin, Cookie: cookie },
  });
  return sessionSchema.parse(await response.json());
}

/**
 * Loads display history for a session.
 *
 * @param cookie - Auth cookie header value.
 * @param sessionId - Session to load.
 * @returns The parsed session history.
 */
async function history(cookie: string, sessionId: string) {
  const response = await fetch(`${base}/api/sessions/${sessionId}`, {
    headers: { Cookie: cookie },
  });
  return historySchema.parse(await response.json());
}

/**
 * Drains one turn's SSE stream into its events.
 *
 * @param cookie - Auth cookie header value.
 * @param sessionId - Session receiving the turn.
 * @param message - User prompt for the turn.
 * @param signal - Optional signal to abort the client request.
 * @returns Every stream event emitted by the turn.
 */
async function runTurn(
  cookie: string,
  sessionId: string,
  message: string,
  signal?: AbortSignal,
): Promise<StreamEvent[]> {
  const response = await fetch(`${base}/api/sessions/${sessionId}/turns`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Cookie: cookie,
    },
    body: JSON.stringify({ message, clientTurnId: randomUUID() }),
    ...(signal ? { signal } : {}),
  });
  if (!response.body) {
    throw new Error("Missing turn stream");
  }
  const events: StreamEvent[] = [];
  for await (const event of readEvents(response.body)) {
    events.push(event);
  }
  return events;
}

/**
 * Polls a session until its single turn reaches a status.
 *
 * @param cookie - Auth cookie header value.
 * @param sessionId - Session to poll.
 * @param status - Expected turn status.
 */
async function waitForStatus(cookie: string, sessionId: string, status: string) {
  await expect.poll(async () => (await history(cookie, sessionId)).turns[0]?.status).toBe(status);
}

it("completes many concurrent turns without exceeding the connection pool", async () => {
  const cookie = await guest();
  const sessions = await Promise.all(
    Array.from({ length: concurrency }, () => createSession(cookie)),
  );
  const results = await Promise.all(
    sessions.map((session, index) => runTurn(cookie, session.id, `Question ${index}`)),
  );
  for (const events of results) {
    expect(events.at(-1)).toMatchObject({
      type: "turn_finished",
      status: "completed",
    });
    expect(events.some((event) => event.type === "analysis_ready")).toBe(true);
  }
  expect(store.pool.totalCount).toBeGreaterThan(0);
  expect(store.pool.totalCount).toBeLessThanOrEqual(poolMax);
  expect(store.pool.waitingCount).toBe(0);
}, 20000);

it("rejects a second turn on a running session instead of queueing it", async () => {
  const cookie = await guest();
  const session = await createSession(cookie);
  startHold();
  const first = runTurn(cookie, session.id, "First");
  await waitForStatus(cookie, session.id, "running");
  const second = await fetch(`${base}/api/sessions/${session.id}/turns`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Cookie: cookie,
    },
    body: JSON.stringify({ message: "Second", clientTurnId: randomUUID() }),
  });
  expect(second.status).toBe(409);
  const body: unknown = await second.json();
  expect(body).toMatchObject({ code: "turn_running" });
  resumeHold();
  const events = await first;
  expect(events.at(-1)).toMatchObject({
    type: "turn_finished",
    status: "completed",
  });
  const saved = await history(cookie, session.id);
  expect(saved.turns).toHaveLength(1);
}, 20000);

it("interrupts every in-flight turn on disconnect and stays usable", async () => {
  const cookie = await guest();
  const sessions = await Promise.all(
    Array.from({ length: concurrency }, () => createSession(cookie)),
  );
  startHold();
  const controllers = sessions.map(() => new AbortController());
  const attempts = sessions.map((session, index) => {
    const controller = controllers[index];
    if (!controller) {
      throw new Error("Missing abort controller");
    }
    return runTurn(cookie, session.id, `Abort ${index}`, controller.signal).catch(
      (): StreamEvent[] => [],
    );
  });
  for (const session of sessions) {
    await waitForStatus(cookie, session.id, "running");
  }
  for (const controller of controllers) {
    controller.abort();
  }
  await Promise.all(attempts);
  for (const session of sessions) {
    await waitForStatus(cookie, session.id, "interrupted");
  }
  expect(store.pool.waitingCount).toBe(0);
  resumeHold();
  const fresh = await createSession(cookie);
  const events = await runTurn(cookie, fresh.id, "After the storm");
  expect(events.at(-1)).toMatchObject({
    type: "turn_finished",
    status: "completed",
  });
}, 20000);

it("keeps billed bytes and token usage isolated per turn under load", async () => {
  const cookie = await guest();
  const sessions = await Promise.all(
    Array.from({ length: concurrency }, () => createSession(cookie)),
  );
  const results = await Promise.all(
    sessions.map((session, index) => runTurn(cookie, session.id, `Billing ${index}`)),
  );
  for (const events of results) {
    expect(events.at(-1)).toMatchObject({
      type: "turn_finished",
      status: "completed",
    });
  }
  for (const session of sessions) {
    const saved = await store.db
      .select({ data: schema.queryResults.data })
      .from(schema.queryResults)
      .where(eq(schema.queryResults.sessionId, session.id));
    expect(saved).toHaveLength(1);
    expect(saved[0]?.data.bytesBilled).toBe("10");
    expect(saved[0]?.data.bytesProcessed).toBe("10");
    const [turn] = await store.db
      .select({ status: schema.turns.status, usage: schema.turns.usage })
      .from(schema.turns)
      .where(eq(schema.turns.sessionId, session.id));
    expect(turn?.status).toBe("completed");
    expect(turn?.usage).toMatchObject({
      modelCalls: 4,
      inputTokens: 40,
      outputTokens: 40,
      analyst: { modelCalls: 3, inputTokens: 30, outputTokens: 30 },
      reviewer: { modelCalls: 1, inputTokens: 10, outputTokens: 10 },
    });
    expect(turn?.usage?.cost ?? -1).toBeCloseTo(0.004);
  }
  expect(store.pool.waitingCount).toBe(0);
}, 20000);
