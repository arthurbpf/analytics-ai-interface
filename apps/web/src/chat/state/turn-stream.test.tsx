import type { Identity, SessionHistory, StreamEvent } from "@analytics/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { ApiFailure, type ChatApi } from "../api/chat-api.ts";
import { chart, draftId, history, sessionId, timestamp, turnId } from "../testing/chat-fixtures.ts";
import {
  createChatTestApi,
  renderChatHooks,
  guestIdentity as guest,
  type ChatTestHarness,
} from "../testing/chat-test-provider.tsx";
import { emptyPreferences, storageKey } from "./chat-preferences.ts";

const mounted: ChatTestHarness[] = [];
afterEach(() => {
  for (const chat of mounted.splice(0)) {
    chat.unmount();
    chat.client.clear();
  }
  vi.useRealTimers();
});
async function setup() {
  const { saved, api } = createChatTestApi();
  const chat = renderChatHooks(api);
  mounted.push(chat);
  await vi.waitFor(() => expect(chat.result.current.sessions.isSuccess).toBe(true));
  return { saved, api, chat };
}
const response = (chat: ChatTestHarness) =>
  chat.result.current.runtime.store.getState().responses[sessionId];
const completed = (chat: ChatTestHarness) =>
  expect(Object.keys(chat.result.current.runtime.store.getState().responses)).toHaveLength(0);
function histories(chat: ChatTestHarness) {
  return Object.fromEntries(
    chat.client
      .getQueriesData<SessionHistory>({
        queryKey: [...chat.result.current.runtime.queries.scope, "history"],
      })
      .flatMap(([, saved]) => (saved ? [[saved.session.id, saved]] : [])),
  );
}
function streamSignal(chat: ChatTestHarness, id: string) {
  const runtime = chat.result.current.runtime;
  const active = runtime.store.getState().responses[id];
  return active ? runtime.streams.get(active.clientTurnId)?.signal : undefined;
}
it("rejects invalid and duplicate submissions and creates sessions lazily", async () => {
  const { chat, api } = await setup();
  chat.send("   ");
  chat.send("x".repeat(8001));
  expect(api.createSession).not.toHaveBeenCalled();
  chat.send("Revenue");
  chat.send("Again");
  await vi.waitFor(() => completed(chat));
  expect(api.createSession).toHaveBeenCalledTimes(1);
  expect(api.turn).toHaveBeenCalledTimes(1);
  expect(chat.result.current.sessions.data?.[0]?.title).toBe("Revenue");
});
it("keeps two streams isolated while navigating; Stop affects selection", async () => {
  const { chat, api, saved } = await setup();
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
    signal.addEventListener("abort", () => gates[id]?.resolve(), { once: true });
    await gates[id]?.promise;
    signal.throwIfAborted();
    yield { type: "turn_finished", turnId: turn, status: "completed", error: null };
  });
  chat.send("First");
  await vi.waitFor(() => expect(response(chat)?.charts).toHaveLength(1));
  chat.select(null);
  chat.send("Second");
  await vi.waitFor(() =>
    expect(chat.result.current.runtime.store.getState().responses[otherId]?.charts).toHaveLength(1),
  );
  expect(api.turn).toHaveBeenCalledTimes(2);
  expect(response(chat)?.activities).toEqual([
    { id: "0:0", stage: "querying", message: sessionId, status: "running" },
  ]);
  expect(chat.result.current.runtime.store.getState().responses[otherId]?.activities).toEqual([
    { id: "0:0", stage: "querying", message: otherId, status: "running" },
  ]);
  chat.select(sessionId);
  await vi.waitFor(() => expect(chat.result.current.history.isFetching).toBe(false));
  chat.stop();
  await vi.waitFor(() => expect(response(chat)).toBeUndefined());
  expect(streamSignal(chat, otherId)?.aborted).toBe(false);
  gates[otherId]?.resolve();
  await vi.waitFor(() => completed(chat));
  expect(chat.result.current.runtime.store.getState().selected).toBe(sessionId);
});
it("disposes streams and cached history on identity change, ignoring late work", async () => {
  const { chat, api } = await setup();
  const gate = Promise.withResolvers<void>();
  api.turn = vi.fn(async function* (): AsyncGenerator<StreamEvent> {
    yield { type: "turn_started", turnId };
    yield { type: "chart_ready", turnId, chart: chart() };
    await gate.promise;
    yield { type: "turn_finished", turnId, status: "completed", error: null };
  });
  chat.send("Private question");
  await vi.waitFor(() => expect(response(chat)?.charts).toHaveLength(1));
  const signal = streamSignal(chat, sessionId);
  api.identity = vi.fn(async () => ({ ...guest, id: crypto.randomUUID() }));
  api.listSessions = vi.fn(async () => []);
  chat.synchronize();
  await vi.waitFor(() => expect(histories(chat)).toEqual({}));
  expect(signal?.aborted).toBe(true);
  expect(chat.result.current.runtime.store.getState().selected).toBeNull();
  gate.resolve();
  await Promise.resolve();
  expect(histories(chat)).toEqual({});
  completed(chat);
});
it("clears private caches on logout and on a 401", async () => {
  const { chat, api } = await setup();
  chat.select(sessionId);
  await vi.waitFor(() => expect(histories(chat)[sessionId]).toBeDefined());
  chat.logout();
  await vi.waitFor(() => expect(chat.result.current.identity).toBeNull());
  expect(histories(chat)).toEqual({});
  expect(api.logout).toHaveBeenCalledTimes(1);
  chat.guest();
  await vi.waitFor(() => expect(chat.result.current.identity).toEqual(guest));
  api.history = vi.fn(async () => {
    throw new ApiFailure(401, "unauthenticated", "Expired");
  });
  chat.select(sessionId);
  await vi.waitFor(() => expect(chat.result.current.identity).toBeNull());
  expect(histories(chat)).toEqual({});
});
it("ignores legacy localStorage chat IDs and restores preferences only for their identity", async () => {
  localStorage.setItem(
    "analytics.sessions.v1",
    JSON.stringify({ sessions: [{ id: sessionId }], selected: sessionId }),
  );
  localStorage.setItem(
    storageKey,
    JSON.stringify({ ...emptyPreferences, identityId: crypto.randomUUID(), selected: sessionId }),
  );
  const { chat, api } = await setup();
  expect(chat.result.current.runtime.store.getState().preferences.selected).toBeNull();
  expect(api.history).not.toHaveBeenCalled();
});
it("reloads running histories without submitting paid work", async () => {
  const { chat, api, saved } = await setup();
  saved.turns.push({
    id: turnId,
    clientTurnId: draftId,
    status: "running",
    createdAt: timestamp,
    finishedAt: null,
    error: null,
  });
  chat.select(sessionId);
  await vi.waitFor(() => expect(chat.result.current.history.isFetching).toBe(false));
  chat.send("Again");
  expect(api.turn).not.toHaveBeenCalled();
  chat.reload();
  expect(api.turn).not.toHaveBeenCalled();
});
it("retains published artifacts when history reload fails", async () => {
  const { chat, api } = await setup();
  api.history = vi.fn(async () => {
    throw new Error("History unavailable");
  });
  api.turn = vi.fn(async function* (): AsyncGenerator<StreamEvent> {
    yield { type: "turn_started", turnId };
    yield { type: "chart_ready", turnId, chart: chart() };
  });
  chat.send("Revenue");
  await vi.waitFor(() => completed(chat));
  expect(histories(chat)[sessionId]?.messages.map((message) => message.content.kind)).toEqual([
    "user",
    "chart",
  ]);
  expect(chat.result.current.runtime.store.getState().error).toContain("before completion");
});

it("clears live activity on a disconnected stream before history reload finishes", async () => {
  const { chat, api, saved } = await setup();
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
  chat.send("Revenue");
  try {
    await vi.waitFor(() => expect(response(chat)?.finished).toBe(true));
    expect(response(chat)?.activities).toEqual([]);
  } finally {
    gate.resolve();
  }
  await vi.waitFor(() => completed(chat));
});
it("does not let an earlier reload replace completed history", async () => {
  const { chat, api, saved } = await setup();
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
  chat.send("Revenue");
  await vi.waitFor(() => expect(response(chat)?.turnId).toBe(turnId));
  chat.reload();
  gate.resolve();
  await vi.waitFor(() => completed(chat));
  pending.resolve(history());
  await Promise.resolve();
  expect(histories(chat)[sessionId]?.messages).toHaveLength(1);
});
it("does not change selection when session creation finishes in the background", async () => {
  const { chat, api, saved } = await setup();
  const pending = Promise.withResolvers<typeof saved.session>();
  api.createSession = vi.fn(() => pending.promise);
  chat.send("Revenue");
  chat.select(null);
  pending.resolve(saved.session);
  await vi.waitFor(() => completed(chat));
  expect(chat.result.current.runtime.store.getState().selected).toBeNull();
});
it("updates persisted sidebar titles from SSE", async () => {
  const { chat, api, saved } = await setup();
  api.turn = vi.fn(async function* (): AsyncGenerator<StreamEvent> {
    yield { type: "turn_started", turnId };
    saved.session.title = "Purchases over time";
    yield { type: "session_updated", turnId, session: saved.session };
    yield { type: "turn_finished", turnId, status: "completed", error: null };
  });
  chat.send("Revenue");
  await vi.waitFor(() => completed(chat));
  expect(chat.result.current.sessions.data?.[0]?.title).toBe("Purchases over time");
});
it("reconciles simultaneous completions without overwriting either chat", async () => {
  const { chat, api, saved } = await setup();
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
  chat.send("First");
  await vi.waitFor(() => expect(response(chat)?.turnId).toBe(turnId));
  chat.select(null);
  chat.send("Second");
  await vi.waitFor(() =>
    expect(chat.result.current.runtime.store.getState().responses[otherId]?.turnId).toBe(otherTurn),
  );
  gate.resolve();
  await vi.waitFor(() => completed(chat));
  expect(histories(chat)[sessionId]?.messages[0]?.content).toEqual({
    kind: "user",
    text: "First",
  });
  expect(histories(chat)[otherId]?.messages[0]?.content).toEqual({
    kind: "user",
    text: "Second",
  });
});
it("ignores a stale authentication failure after another account has loaded", async () => {
  const { chat, api } = await setup();
  const oldList = Promise.withResolvers<ReturnType<typeof history>["session"][]>();
  api.listSessions = vi
    .fn()
    .mockImplementationOnce(() => oldList.promise)
    .mockResolvedValue([]);
  chat.synchronize();
  await vi.waitFor(() => expect(api.listSessions).toHaveBeenCalledTimes(1));
  const account: Identity = {
    id: crypto.randomUUID(),
    kind: "google",
    name: "Person",
    email: "person@example.test",
  };
  api.identity = vi.fn(async () => account);
  chat.synchronize();
  await vi.waitFor(() => expect(chat.result.current.identity).toEqual(account));
  oldList.reject(new ApiFailure(401, "unauthenticated", "Old guest expired"));
  await Promise.resolve();
  await Promise.resolve();
  expect(chat.result.current.identity).toEqual(account);
});

it("polls pending titles after stream closure without replaying a turn", async () => {
  const { chat, api, saved } = await setup();
  vi.useFakeTimers();
  saved.session.titleStatus = "pending";
  chat.send("Revenue");
  await vi.waitFor(() => completed(chat));
  const originalCalls = vi.mocked(api.listSessions).mock.calls.length;
  saved.session.title = "Late title";
  saved.session.titleStatus = "succeeded";
  await vi.advanceTimersByTimeAsync(2000);
  expect(vi.mocked(api.listSessions).mock.calls.length).toBeGreaterThan(originalCalls);
  expect(chat.result.current.sessions.data?.[0]?.title).toBe("Late title");
  expect(api.turn).toHaveBeenCalledTimes(1);
});

it("retains clarification once even when reload fails", async () => {
  const { chat, api } = await setup();
  const clarification = { context: "Specify a period.", questions: ["Which month?"] };
  api.history = vi.fn(async () => {
    throw new Error("Reload unavailable");
  });
  api.turn = vi.fn(async function* (): AsyncGenerator<StreamEvent> {
    yield { type: "turn_started", turnId };
    yield { type: "chart_ready", turnId, chart: chart() };
    yield { type: "clarification_ready", turnId, clarification };
    yield { type: "clarification_ready", turnId, clarification };
    yield { type: "turn_finished", turnId, status: "completed", error: null };
  });
  chat.send("Compare");
  await vi.waitFor(() => completed(chat));
  expect(histories(chat)[sessionId]?.messages.map((message) => message.content.kind)).toEqual([
    "user",
    "chart",
    "clarification",
  ]);
});

it("does not restore an expired identity from an earlier credential refresh", async () => {
  const { chat, api } = await setup();
  const pending = Promise.withResolvers<Identity | null>();
  api.identity = vi.fn(() => pending.promise);
  chat.synchronize();
  await vi.waitFor(() => expect(api.identity).toHaveBeenCalled());
  api.history = vi.fn(async () => {
    throw new ApiFailure(401, "unauthenticated", "Expired");
  });
  chat.select(sessionId);
  await vi.waitFor(() => expect(chat.result.current.identity).toBeNull());
  pending.resolve(guest);
  await vi.waitFor(() => expect(chat.client.isFetching()).toBe(0));
  expect(chat.result.current.identity).toBeNull();
});

it("keeps a second session creation reserved when a background turn finishes", async () => {
  const { chat, api, saved } = await setup();
  const gate = Promise.withResolvers<void>();
  const pending = Promise.withResolvers<typeof saved.session>();
  api.createSession = vi
    .fn()
    .mockResolvedValueOnce(saved.session)
    .mockImplementationOnce(() => pending.promise);
  api.turn = vi.fn(async function* (): AsyncGenerator<StreamEvent> {
    yield { type: "turn_started", turnId };
    await gate.promise;
    yield { type: "turn_finished", turnId, status: "completed", error: null };
  });
  chat.send("First");
  await vi.waitFor(() => expect(response(chat)?.turnId).toBe(turnId));
  chat.select(null);
  chat.send("Second");
  gate.resolve();
  await vi.waitFor(() => expect(response(chat)).toBeUndefined());
  chat.send("Duplicate second");
  expect(api.createSession).toHaveBeenCalledTimes(2);
  const otherId = crypto.randomUUID();
  const other = { ...history(), session: { ...saved.session, id: otherId } };
  api.history = vi.fn(async (id) => (id === otherId ? other : saved));
  pending.resolve(other.session);
  await vi.waitFor(() => completed(chat));
});

it("synchronizes another tab's identity without reacting to unrelated storage", async () => {
  const { chat, api } = await setup();
  api.identity = vi.fn(async () => ({ ...guest, id: crypto.randomUUID() }));
  window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
  expect(api.identity).not.toHaveBeenCalled();
  const scope = chat.result.current.runtime.queries.scope;
  window.dispatchEvent(new StorageEvent("storage", { key: storageKey }));
  await vi.waitFor(() => expect(chat.result.current.identity?.id).not.toBe(guest.id));
  await vi.waitFor(() => expect(chat.client.getQueriesData({ queryKey: scope })).toHaveLength(0));
  expect(api.identity).toHaveBeenCalledOnce();
  expect(api.turn).not.toHaveBeenCalled();
});

it("polls background running sessions until completion without replaying work", async () => {
  const { chat, api, saved } = await setup();
  vi.useFakeTimers();
  const running = structuredClone(saved);
  running.session.runningTurn = true;
  running.turns.push({
    id: turnId,
    clientTurnId: draftId,
    status: "running",
    createdAt: timestamp,
    finishedAt: null,
    error: null,
  });
  api.listSessions = vi.fn(async () => [structuredClone(running.session)]);
  api.history = vi.fn(async () => structuredClone(running));
  chat.reload();
  await vi.waitFor(() => expect(histories(chat)[sessionId]?.turns[0]?.status).toBe("running"));
  running.session.runningTurn = false;
  running.turns = [];
  await vi.advanceTimersByTimeAsync(2000);
  await vi.waitFor(() => expect(histories(chat)[sessionId]?.turns).toEqual([]));
  const calls = vi.mocked(api.listSessions).mock.calls.length;
  await vi.advanceTimersByTimeAsync(4000);
  expect(api.listSessions).toHaveBeenCalledTimes(calls);
  expect(api.turn).not.toHaveBeenCalled();
});

it("refreshes cached saved history when a session is selected again", async () => {
  const { chat, api, saved } = await setup();
  api.history = vi.fn(async () => structuredClone(saved));
  chat.select(sessionId);
  await vi.waitFor(() => expect(chat.result.current.history.isSuccess).toBe(true));
  chat.select(null);
  saved.messages.push({ id: draftId, turnId, content: { kind: "user", text: "From another tab" } });
  chat.select(sessionId);
  await vi.waitFor(() =>
    expect(histories(chat)[sessionId]?.messages[0]?.content).toEqual({
      kind: "user",
      text: "From another tab",
    }),
  );
  expect(api.history).toHaveBeenCalledTimes(2);
  expect(api.turn).not.toHaveBeenCalled();
});

it("ignores an authentication refresh cancelled by a newer synchronization", async () => {
  const { chat, api } = await setup();
  const pending = Promise.withResolvers<Identity | null>();
  api.identity = vi
    .fn()
    .mockImplementationOnce(() => pending.promise)
    .mockResolvedValue(guest);
  chat.synchronize();
  await vi.waitFor(() => expect(api.identity).toHaveBeenCalledTimes(1));
  chat.synchronize();
  await vi.waitFor(() => expect(api.identity).toHaveBeenCalledTimes(2));
  pending.resolve(guest);
  await vi.waitFor(() => expect(chat.client.isFetching()).toBe(0));
  expect(chat.result.current.runtime.store.getState().error).toBeNull();
});

it("does not restart a retired history query after an account switch during reload", async () => {
  const { chat, api } = await setup();
  chat.select(sessionId);
  await vi.waitFor(() => expect(chat.result.current.history.isSuccess).toBe(true));
  const scope = chat.result.current.runtime.queries.scope;
  const pending = Promise.withResolvers<ReturnType<typeof history>["session"][]>();
  api.history = vi.fn(async () => history());
  api.listSessions = vi
    .fn()
    .mockImplementationOnce(() => pending.promise)
    .mockResolvedValue([]);
  chat.reload();
  await vi.waitFor(() => expect(api.listSessions).toHaveBeenCalledTimes(1));
  const account = { ...guest, id: crypto.randomUUID() };
  api.identity = vi.fn(async () => account);
  chat.synchronize();
  await vi.waitFor(() => expect(chat.result.current.identity).toEqual(account));
  pending.resolve([]);
  await vi.waitFor(() => expect(chat.client.isFetching()).toBe(0));
  expect(api.history).not.toHaveBeenCalled();
  expect(chat.client.getQueriesData({ queryKey: scope })).toHaveLength(0);
});
