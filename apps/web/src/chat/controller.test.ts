import type { Identity, StreamEvent } from "@analytics/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { ChatController } from "./controller.ts";
import { ApiFailure, type ChatApi } from "./api.ts";
import { chart, draftId, history, sessionId, timestamp, turnId } from "./test-fixtures.ts";
import { emptyIndex, storageKey } from "./storage.ts";

const guest: Identity = { id: draftId, kind: "guest", name: null, email: null };
const controllers: ChatController[] = [];
afterEach(() => {
  for (const controller of controllers.splice(0)) {
    controller.dispose();
  }
  vi.useRealTimers();
});
async function setup() {
  const saved = history();
  const api: ChatApi = {
    identity: vi.fn(async () => guest),
    guest: vi.fn(async () => guest),
    logout: vi.fn(async () => {}),
    listSessions: vi.fn(async () => [saved.session]),
    createSession: vi.fn(async () => saved.session),
    history: vi.fn(async () => saved),
    turn: vi.fn(async function* (): AsyncGenerator<StreamEvent> {
      yield { type: "turn_started", turnId };
      yield { type: "turn_finished", turnId, status: "completed", error: null };
    }),
  };
  const controller = new ChatController(api);
  controllers.push(controller);
  controller.initialize();
  await vi.waitFor(() => expect(controller.getSnapshot().ready).toBe(true));
  return { saved, api, controller };
}
const response = (controller: ChatController) => controller.getSnapshot().responses[sessionId];
const completed = (controller: ChatController) =>
  expect(Object.keys(controller.getSnapshot().responses)).toHaveLength(0);
it("rejects invalid and duplicate submissions and creates sessions lazily", async () => {
  const { controller, api } = await setup();
  controller.send("   ");
  controller.send("x".repeat(8001));
  expect(api.createSession).not.toHaveBeenCalled();
  controller.send("Revenue");
  controller.send("Again");
  await vi.waitFor(() => completed(controller));
  expect(api.createSession).toHaveBeenCalledTimes(1);
  expect(api.turn).toHaveBeenCalledTimes(1);
  expect(controller.getSnapshot().index.sessions[0]?.label).toBe("Revenue");
});
it("keeps two streams, drafts and completions isolated while navigating; Stop affects selection", async () => {
  const { controller, api, saved } = await setup();
  const otherId = crypto.randomUUID();
  const otherTurn = crypto.randomUUID();
  const other = { ...history(), session: { ...saved.session, id: otherId, title: "Other" } };
  api.createSession = vi
    .fn()
    .mockResolvedValueOnce(saved.session)
    .mockResolvedValueOnce(other.session);
  api.history = vi.fn(async (id) => (id === sessionId ? saved : other));
  api.listSessions = vi.fn(async () => [saved.session, other.session]);
  const gates = {
    [sessionId]: Promise.withResolvers<void>(),
    [otherId]: Promise.withResolvers<void>(),
  };
  api.turn = vi.fn(async function* (
    input: Parameters<ChatApi["turn"]>[0],
    signal: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const id = input.params.id;
    const turn = id === sessionId ? turnId : otherTurn;
    yield { type: "turn_started", turnId: turn };
    yield {
      type: "activity",
      turnId: turn,
      activity: { id: "0:0", stage: "querying", message: id, status: "preparing" },
    };
    yield {
      type: "activity",
      turnId: turn,
      activity: { id: "0:0", stage: "querying", message: id, status: "running" },
    };
    yield { type: "chart_ready", turnId: turn, chart: chart() };
    yield { type: "analysis_started", turnId: turn, draftId };
    yield { type: "analysis_delta", turnId: turn, draftId, delta: id };
    signal.addEventListener("abort", () => gates[id]?.resolve(), { once: true });
    await gates[id]?.promise;
    signal.throwIfAborted();
    yield { type: "analysis_discarded", turnId: turn, draftId };
    yield { type: "turn_finished", turnId: turn, status: "completed", error: null };
  });
  controller.send("First");
  await vi.waitFor(() => expect(response(controller)?.draft?.text).toBe(sessionId));
  controller.select(null);
  controller.send("Second");
  await vi.waitFor(() =>
    expect(controller.getSnapshot().responses[otherId]?.draft?.text).toBe(otherId),
  );
  expect(api.turn).toHaveBeenCalledTimes(2);
  expect(response(controller)?.activities).toEqual([
    { id: "0:0", stage: "querying", message: sessionId, status: "running" },
  ]);
  expect(controller.getSnapshot().responses[otherId]?.activities).toEqual([
    { id: "0:0", stage: "querying", message: otherId, status: "running" },
  ]);
  controller.select(sessionId);
  await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
  controller.stop();
  await vi.waitFor(() => expect(response(controller)).toBeUndefined());
  expect(controller.getSnapshot().responses[otherId]?.controller.signal.aborted).toBe(false);
  gates[otherId]?.resolve();
  await vi.waitFor(() => completed(controller));
  expect(controller.getSnapshot().selected).toBe(sessionId);
});
it("disposes streams and cached history on identity change, ignoring late work", async () => {
  const { controller, api } = await setup();
  const gate = Promise.withResolvers<void>();
  api.turn = vi.fn(async function* (): AsyncGenerator<StreamEvent> {
    yield { type: "turn_started", turnId };
    yield { type: "analysis_started", turnId, draftId };
    yield { type: "analysis_delta", turnId, draftId, delta: "Private" };
    await gate.promise;
    yield { type: "turn_finished", turnId, status: "completed", error: null };
  });
  controller.send("Private question");
  await vi.waitFor(() => expect(response(controller)?.draft?.text).toBe("Private"));
  const signal = response(controller)?.controller.signal;
  api.identity = vi.fn(async () => ({ ...guest, id: crypto.randomUUID() }));
  api.listSessions = vi.fn(async () => []);
  controller.synchronize();
  await vi.waitFor(() => expect(controller.getSnapshot().histories).toEqual({}));
  expect(signal?.aborted).toBe(true);
  expect(controller.getSnapshot().selected).toBeNull();
  gate.resolve();
  await Promise.resolve();
  expect(controller.getSnapshot().histories).toEqual({});
  completed(controller);
});
it("clears private caches on logout and on a 401", async () => {
  const { controller, api } = await setup();
  controller.select(sessionId);
  await vi.waitFor(() => expect(controller.getSnapshot().histories[sessionId]).toBeDefined());
  controller.logout();
  await vi.waitFor(() => expect(controller.getSnapshot().identity).toBeNull());
  expect(controller.getSnapshot().histories).toEqual({});
  expect(api.logout).toHaveBeenCalledTimes(1);
  controller.guest();
  await vi.waitFor(() => expect(controller.getSnapshot().identity).toEqual(guest));
  api.history = vi.fn(async () => {
    throw new ApiFailure(401, "unauthenticated", "Expired");
  });
  controller.select(sessionId);
  await vi.waitFor(() => expect(controller.getSnapshot().identity).toBeNull());
  expect(controller.getSnapshot().histories).toEqual({});
});
it("ignores legacy localStorage chat IDs and restores preferences only for their identity", async () => {
  localStorage.setItem(
    "analytics.sessions.v1",
    JSON.stringify({ sessions: [{ id: sessionId }], selected: sessionId }),
  );
  localStorage.setItem(
    storageKey,
    JSON.stringify({ ...emptyIndex, identityId: crypto.randomUUID(), selected: sessionId }),
  );
  const { controller, api } = await setup();
  expect(controller.getSnapshot().index.selected).toBeNull();
  expect(api.history).not.toHaveBeenCalled();
});
it("reloads running histories without submitting paid work", async () => {
  const { controller, api, saved } = await setup();
  saved.turns.push({
    id: turnId,
    clientTurnId: draftId,
    status: "running",
    createdAt: timestamp,
    finishedAt: null,
    error: null,
  });
  controller.select(sessionId);
  await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
  controller.send("Again");
  expect(api.turn).not.toHaveBeenCalled();
  controller.reload();
  expect(api.turn).not.toHaveBeenCalled();
});
it("retains published artifacts and clears drafts when history reload fails", async () => {
  const { controller, api } = await setup();
  api.history = vi.fn(async () => {
    throw new Error("History unavailable");
  });
  api.turn = vi.fn(async function* (): AsyncGenerator<StreamEvent> {
    yield { type: "turn_started", turnId };
    yield { type: "chart_ready", turnId, chart: chart() };
    yield { type: "analysis_started", turnId, draftId };
    yield { type: "analysis_delta", turnId, draftId, delta: "Unvalidated" };
  });
  controller.send("Revenue");
  await vi.waitFor(() => completed(controller));
  expect(
    controller.getSnapshot().histories[sessionId]?.messages.map((message) => message.content.kind),
  ).toEqual(["user", "chart"]);
  expect(controller.getSnapshot().error).toContain("before completion");
});

it("clears live activity on a disconnected stream before history reload finishes", async () => {
  const { controller, api, saved } = await setup();
  const gate = Promise.withResolvers<void>();
  api.history = vi.fn(async () => {
    await gate.promise;
    return saved;
  });
  api.turn = vi.fn(async function* (): AsyncGenerator<StreamEvent> {
    yield { type: "turn_started", turnId };
    yield {
      type: "activity",
      turnId,
      activity: { id: "0:0", stage: "querying", message: "Preparing a query", status: "preparing" },
    };
  });
  controller.send("Revenue");
  try {
    await vi.waitFor(() => expect(response(controller)?.finished).toBe(true));
    expect(response(controller)?.activities).toEqual([]);
  } finally {
    gate.resolve();
  }
  await vi.waitFor(() => completed(controller));
});
it("does not let an earlier reload replace completed history", async () => {
  const { controller, api, saved } = await setup();
  const pending = Promise.withResolvers<typeof saved>();
  const gate = Promise.withResolvers<void>();
  api.history = vi
    .fn()
    .mockImplementationOnce(() => pending.promise)
    .mockImplementationOnce(async () => saved);
  api.turn = vi.fn(async function* (): AsyncGenerator<StreamEvent> {
    yield { type: "turn_started", turnId };
    await gate.promise;
    saved.messages.push({ id: draftId, turnId, content: { kind: "chart", chart: chart() } });
    yield { type: "turn_finished", turnId, status: "completed", error: null };
  });
  controller.send("Revenue");
  await vi.waitFor(() => expect(response(controller)?.turnId).toBe(turnId));
  controller.reload();
  gate.resolve();
  await vi.waitFor(() => completed(controller));
  pending.resolve(history());
  await Promise.resolve();
  expect(controller.getSnapshot().histories[sessionId]?.messages).toHaveLength(1);
});
it("does not change selection when session creation finishes in the background", async () => {
  const { controller, api, saved } = await setup();
  const pending = Promise.withResolvers<typeof saved.session>();
  api.createSession = vi.fn(() => pending.promise);
  controller.send("Revenue");
  controller.select(null);
  pending.resolve(saved.session);
  await vi.waitFor(() => completed(controller));
  expect(controller.getSnapshot().selected).toBeNull();
});
it("updates persisted sidebar titles from SSE", async () => {
  const { controller, api, saved } = await setup();
  api.turn = vi.fn(async function* (): AsyncGenerator<StreamEvent> {
    yield { type: "turn_started", turnId };
    saved.session.title = "Purchases over time";
    yield { type: "session_updated", turnId, session: saved.session };
    yield { type: "turn_finished", turnId, status: "completed", error: null };
  });
  controller.send("Revenue");
  await vi.waitFor(() => completed(controller));
  expect(controller.getSnapshot().index.sessions[0]?.label).toBe("Purchases over time");
});
it("reconciles simultaneous completions without overwriting either chat", async () => {
  const { controller, api, saved } = await setup();
  const otherId = crypto.randomUUID();
  const otherTurn = crypto.randomUUID();
  const other = { ...history(), session: { ...saved.session, id: otherId, title: "Other" } };
  const gate = Promise.withResolvers<void>();
  api.createSession = vi
    .fn()
    .mockResolvedValueOnce(saved.session)
    .mockResolvedValueOnce(other.session);
  api.listSessions = vi.fn(async () => [saved.session, other.session]);
  api.history = vi.fn(async (id: string) => (id === sessionId ? saved : other));
  api.turn = vi.fn(async function* (
    input: Parameters<ChatApi["turn"]>[0],
  ): AsyncGenerator<StreamEvent> {
    const target = input.params.id === sessionId ? saved : other;
    const turn = input.params.id === sessionId ? turnId : otherTurn;
    yield { type: "turn_started", turnId: turn };
    await gate.promise;
    target.messages.push({
      id: crypto.randomUUID(),
      turnId: turn,
      content: { kind: "user", text: input.body.message },
    });
    yield { type: "turn_finished", turnId: turn, status: "completed", error: null };
  });
  controller.send("First");
  await vi.waitFor(() => expect(response(controller)?.turnId).toBe(turnId));
  controller.select(null);
  controller.send("Second");
  await vi.waitFor(() =>
    expect(controller.getSnapshot().responses[otherId]?.turnId).toBe(otherTurn),
  );
  gate.resolve();
  await vi.waitFor(() => completed(controller));
  expect(controller.getSnapshot().histories[sessionId]?.messages[0]?.content).toEqual({
    kind: "user",
    text: "First",
  });
  expect(controller.getSnapshot().histories[otherId]?.messages[0]?.content).toEqual({
    kind: "user",
    text: "Second",
  });
});
it("ignores a stale authentication failure after another account has loaded", async () => {
  const { controller, api } = await setup();
  const oldList = Promise.withResolvers<ReturnType<typeof history>["session"][]>();
  api.listSessions = vi
    .fn()
    .mockImplementationOnce(() => oldList.promise)
    .mockResolvedValue([]);
  controller.synchronize();
  await vi.waitFor(() => expect(api.listSessions).toHaveBeenCalledTimes(1));
  const account: Identity = {
    id: crypto.randomUUID(),
    kind: "google",
    name: "Person",
    email: "person@example.test",
  };
  api.identity = vi.fn(async () => account);
  controller.synchronize();
  await vi.waitFor(() => expect(controller.getSnapshot().identity).toEqual(account));
  oldList.reject(new ApiFailure(401, "unauthenticated", "Old guest expired"));
  await Promise.resolve();
  await Promise.resolve();
  expect(controller.getSnapshot().identity).toEqual(account);
});

it("polls pending titles after stream closure without replaying a turn", async () => {
  const { controller, api, saved } = await setup();
  vi.useFakeTimers();
  saved.session.titleStatus = "pending";
  controller.send("Revenue");
  await vi.waitFor(() => completed(controller));
  const originalCalls = vi.mocked(api.listSessions).mock.calls.length;
  saved.session.title = "Late title";
  saved.session.titleStatus = "succeeded";
  await vi.advanceTimersByTimeAsync(2000);
  expect(vi.mocked(api.listSessions).mock.calls.length).toBeGreaterThan(originalCalls);
  expect(controller.getSnapshot().index.sessions[0]?.label).toBe("Late title");
  expect(api.turn).toHaveBeenCalledTimes(1);
});

it("retains clarification once and disposes the draft even when reload fails", async () => {
  const { controller, api } = await setup();
  const clarification = { context: "Specify a period.", questions: ["Which month?"] };
  api.history = vi.fn(async () => {
    throw new Error("Reload unavailable");
  });
  api.turn = vi.fn(async function* (): AsyncGenerator<StreamEvent> {
    yield { type: "turn_started", turnId };
    yield { type: "chart_ready", turnId, chart: chart() };
    yield { type: "analysis_started", turnId, draftId };
    yield { type: "analysis_delta", turnId, draftId, delta: "Discard this" };
    yield { type: "clarification_ready", turnId, clarification };
    yield { type: "clarification_ready", turnId, clarification };
    yield { type: "turn_finished", turnId, status: "completed", error: null };
  });
  controller.send("Compare");
  await vi.waitFor(() => completed(controller));
  expect(
    controller.getSnapshot().histories[sessionId]?.messages.map((message) => message.content.kind),
  ).toEqual(["user", "chart", "clarification"]);
});
