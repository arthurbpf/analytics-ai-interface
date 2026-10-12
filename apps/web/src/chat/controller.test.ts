import type { StreamEvent } from "@analytics/contracts";
import { expect, it, vi } from "vitest";
import { ChatController } from "./controller.ts";
import { ApiFailure, type ChatApi } from "./api.ts";
import { chart, draftId, history, sessionId, timestamp, turnId } from "./test-fixtures.ts";
import { emptyIndex, storageKey } from "./storage.ts";

function setup() {
  const saved = history();
  const api: ChatApi = {
    createSession: vi.fn(async () => saved.session),
    history: vi.fn(async () => saved),
    turn: vi.fn(async function* (): AsyncGenerator<StreamEvent> {
      yield { type: "turn_started", turnId };
      yield { type: "turn_finished", turnId, status: "completed", error: null };
    }),
  };
  return { saved, api, controller: new ChatController(api) };
}
it("prevents empty, oversized, and duplicate submissions while creating a session lazily", async () => {
  const { controller, api } = setup();
  controller.send("   ");
  controller.send("x".repeat(8001));
  expect(api.createSession).not.toHaveBeenCalled();
  controller.send("Revenue");
  controller.send("Again");
  await vi.waitFor(() => expect(controller.getSnapshot().active).toBeNull());
  expect(api.createSession).toHaveBeenCalledTimes(1);
  expect(api.turn).toHaveBeenCalledTimes(1);
  expect(controller.getSnapshot().index.sessions[0]?.label).toBe("Revenue");
});
it("retains streaming across selection, discards drafts, and reconciles saved charts", async () => {
  const { controller, api, saved } = setup();
  const { promise: gate, resolve: resume } = Promise.withResolvers<void>();
  const value = chart();
  api.turn = vi.fn(async function* (): AsyncGenerator<StreamEvent> {
    yield { type: "turn_started", turnId };
    yield { type: "chart_ready", turnId, chart: value };
    yield { type: "chart_ready", turnId, chart: value };
    yield { type: "analysis_started", turnId, draftId };
    yield { type: "analysis_delta", turnId, draftId, delta: "Rejected draft" };
    await gate;
    yield { type: "analysis_discarded", turnId, draftId };
    saved.messages.push({ id: draftId, turnId, content: { kind: "chart", chart: value } });
    yield {
      type: "turn_finished",
      turnId,
      status: "failed",
      error: { code: "failed", message: "Presentation rejected" },
    };
  });
  controller.send("Revenue");
  await vi.waitFor(() =>
    expect(controller.getSnapshot().active?.draft?.text).toBe("Rejected draft"),
  );
  controller.select(null);
  controller.send("Second prompt");
  expect(controller.getSnapshot().active?.controller.signal.aborted).toBe(false);
  expect(controller.getSnapshot().active?.charts).toHaveLength(1);
  expect(api.turn).toHaveBeenCalledTimes(1);
  resume();
  await vi.waitFor(() => expect(controller.getSnapshot().active).toBeNull());
  expect(controller.getSnapshot().histories[sessionId]?.messages).toHaveLength(1);
});
it("stops work without replaying it and recovers from premature EOF", async () => {
  const { controller, api } = setup();
  api.turn = vi.fn(async function* (
    _input: Parameters<ChatApi["turn"]>[0],
    signal: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    yield { type: "turn_started", turnId };
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
    signal.throwIfAborted();
  });
  controller.send("Revenue");
  await vi.waitFor(() => expect(api.turn).toHaveBeenCalledTimes(1));
  controller.stop();
  await vi.waitFor(() => expect(controller.getSnapshot().active).toBeNull());
  expect(controller.getSnapshot().error).toContain("stopped");
  expect(api.turn).toHaveBeenCalledTimes(1);
  api.turn = vi.fn(async function* (): AsyncGenerator<StreamEvent> {
    yield { type: "turn_started", turnId };
  });
  controller.send("Follow-up");
  await vi.waitFor(() => expect(controller.getSnapshot().active).toBeNull());
  expect(controller.getSnapshot().error).toContain("before completion");
  expect(api.turn).toHaveBeenCalledTimes(1);
});
it("ignores stale history and removes only confirmed missing sessions", async () => {
  const { controller, api } = setup();
  const { promise: pending, resolve: resolveHistory } =
    Promise.withResolvers<ReturnType<typeof history>>();
  api.history = vi.fn(() => pending);
  controller.select(sessionId);
  controller.select(null);
  resolveHistory(history());
  await Promise.resolve();
  expect(controller.getSnapshot().selected).toBeNull();
  expect(controller.getSnapshot().histories[sessionId]).toBeUndefined();
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      ...emptyIndex,
      sessions: [{ id: sessionId, label: "Revenue", updatedAt: timestamp }],
    }),
  );
  controller.synchronize();
  api.history = vi.fn(async () => {
    throw new ApiFailure(500, "internal", "Server offline");
  });
  controller.select(sessionId);
  await vi.waitFor(() => expect(controller.getSnapshot().error).toBe("Server offline"));
  expect(controller.getSnapshot().index.sessions).toHaveLength(1);
  api.history = vi.fn(async () => {
    throw new ApiFailure(404, "not_found", "Session unavailable");
  });
  controller.reload();
  await vi.waitFor(() => expect(controller.getSnapshot().index.sessions).toHaveLength(0));
});
it("does not send a turn for saved running history and reloads conflicts without retry", async () => {
  const { saved, controller, api } = setup();
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
  controller.select(null);
  api.turn = vi.fn(async function* (): AsyncGenerator<StreamEvent> {
    yield await Promise.reject(new ApiFailure(409, "duplicate_turn", "Retrieve history"));
  });
  controller.send("New chat");
  await vi.waitFor(() => expect(controller.getSnapshot().active).toBeNull());
  expect(api.turn).toHaveBeenCalledTimes(1);
  expect(controller.getSnapshot().error).toContain("Retrieve history");
  controller.select(null);
});
it("keeps New chat selected when session creation finishes in the background", async () => {
  const { controller, api, saved } = setup();
  const { promise, resolve } = Promise.withResolvers<typeof saved.session>();
  api.createSession = vi.fn(() => promise);
  controller.send("Revenue");
  controller.select(null);
  resolve(saved.session);
  await vi.waitFor(() => expect(controller.getSnapshot().active).toBeNull());
  expect(controller.getSnapshot().selected).toBeNull();
  expect(controller.getSnapshot().index.sessions).toHaveLength(1);
});
it("retains published charts when reloading history fails", async () => {
  const { controller, api } = setup();
  api.history = vi.fn(async () => {
    throw new Error("History unavailable");
  });
  api.turn = vi.fn(async function* (): AsyncGenerator<StreamEvent> {
    yield { type: "turn_started", turnId };
    yield { type: "chart_ready", turnId, chart: chart() };
    yield { type: "turn_finished", turnId, status: "completed", error: null };
  });
  controller.send("Revenue");
  await vi.waitFor(() => expect(controller.getSnapshot().active).toBeNull());
  expect(
    controller.getSnapshot().histories[sessionId]?.messages.map((message) => message.content.kind),
  ).toEqual(["user", "chart"]);
  expect(controller.getSnapshot().error).toBe("History unavailable");
});
it("does not replace completed history with an earlier pending reload", async () => {
  const { controller, api, saved } = setup();
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
  await vi.waitFor(() => expect(controller.getSnapshot().active?.turnId).toBe(turnId));
  controller.reload();
  gate.resolve();
  await vi.waitFor(() => expect(controller.getSnapshot().active).toBeNull());
  pending.resolve(history());
  await Promise.resolve();
  expect(controller.getSnapshot().histories[sessionId]?.messages).toHaveLength(1);
});
