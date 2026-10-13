import { turnRequestSchema, type StreamEvent } from "@analytics/contracts";
import { ApiFailure } from "../api/chat-api.ts";
import { cacheSession } from "../api/chat-query-options.ts";
import {
  isCurrentRuntime,
  reportChatFailure,
  runChatTask,
  type ChatRuntime,
} from "./chat-runtime.ts";
import { applyEvent, createResponse, type ActiveResponse } from "./stream-events.ts";
import { mergePublished } from "./published-history.ts";

/**
 * Stores an immutable response snapshot for its session or provisional turn.
 *
 * @param runtime - Runtime owning the response.
 * @param active - Response snapshot to publish to subscribers.
 */
function saveResponse(runtime: ChatRuntime, active: ActiveResponse): void {
  runtime.store.setState((state) => ({
    responses: { ...state.responses, [active.sessionId ?? active.clientTurnId]: active },
  }));
}

/**
 * Validates a stream's ownership and applies its published event.
 *
 * @param runtime - Runtime owning the stream.
 * @param active - Response receiving the event.
 * @param event - Validated SSE event.
 * @returns The updated response snapshot.
 * @throws When the stream changes turn or session identity.
 */
function receiveEvent(
  runtime: ChatRuntime,
  active: ActiveResponse,
  event: StreamEvent,
): ActiveResponse {
  if (event.type !== "turn_started" && active.turnId !== event.turnId) {
    throw new Error("Stream contained a different turn.");
  }
  if (event.type === "session_updated") {
    if (event.session.id !== active.sessionId) {
      throw new Error("Stream contained a different session.");
    }
    cacheSession(runtime.client, runtime.queries, event.session);
  }
  if (
    event.type === "turn_finished" &&
    event.error &&
    runtime.store.getState().selected === active.sessionId
  ) {
    runtime.store.setState({ error: event.error.message });
  }
  const next = applyEvent(active, event);
  saveResponse(runtime, next);
  return next;
}

/**
 * Creates and caches a session without stealing a newer navigation selection.
 *
 * @param runtime - Runtime owning the submission.
 * @param active - Provisional response awaiting a session.
 * @param controller - Cancellation handle for this submission.
 * @param selectionRevision - Selection revision when the prompt was submitted.
 * @returns The response bound to its created session, or null after cancellation.
 */
async function createTurnSession(
  runtime: ChatRuntime,
  active: ActiveResponse,
  controller: AbortController,
  selectionRevision: number,
): Promise<ActiveResponse | null> {
  const session = await runtime.api.createSession();
  if (!isCurrentRuntime(runtime) || controller.signal.aborted) {
    return null;
  }
  const next = { ...active, sessionId: session.id };
  runtime.client.setQueryData(runtime.queries.history(session.id).queryKey, {
    session,
    turns: [],
    messages: [],
  });
  cacheSession(runtime.client, runtime.queries, session);
  runtime.store.setState((state) => {
    const responses = { ...state.responses };
    delete responses[active.clientTurnId];
    responses[session.id] = next;
    return { responses, creating: false };
  });
  const state = runtime.store.getState();
  if (state.selected === null && state.selectionRevision === selectionRevision) {
    state.select(session.id);
  }
  return next;
}

/**
 * Reconciles saved history, keeping published evidence when retrieval fails.
 *
 * @param runtime - Runtime owning the finished response.
 * @param active - Finished response to reconcile.
 * @param failure - Stream failure to retain in preference to a reload error.
 * @returns The error to show after reconciliation, if any.
 */
async function reconcileHistory(
  runtime: ChatRuntime,
  active: ActiveResponse,
  failure: string | null,
): Promise<string | null> {
  if (!active.sessionId) {
    return failure;
  }
  const options = runtime.queries.history(active.sessionId);
  await runtime.client.cancelQueries({ queryKey: options.queryKey });
  if (!isCurrentRuntime(runtime)) {
    return failure;
  }
  try {
    const history = await runtime.client.fetchQuery(options);
    if (isCurrentRuntime(runtime)) {
      cacheSession(runtime.client, runtime.queries, history.session);
    }
  } catch (error) {
    if (!isCurrentRuntime(runtime)) {
      return failure;
    }
    failure ??= error instanceof Error ? error.message : "Could not reload saved history.";
    runtime.client.setQueryData(options.queryKey, (cached) =>
      cached ? mergePublished(cached, active) : cached,
    );
  }
  return failure;
}

/**
 * Clears live activity and reconciles a turn before releasing its submission lock.
 *
 * @param runtime - Runtime owning the stream.
 * @param active - Last response snapshot.
 * @param controller - Cancellation handle for this stream.
 * @param failure - Stream failure, if any.
 */
async function finishTurn(
  runtime: ChatRuntime,
  active: ActiveResponse,
  controller: AbortController,
  failure: string | null,
): Promise<void> {
  controller.abort();
  if (!isCurrentRuntime(runtime)) {
    return;
  }
  const finished = { ...active, finished: true, activities: [] };
  saveResponse(runtime, finished);
  failure = await reconcileHistory(runtime, finished, failure);
  if (!isCurrentRuntime(runtime)) {
    return;
  }
  runtime.streams.delete(active.clientTurnId);
  runtime.store.setState((state) => {
    const responses = { ...state.responses };
    delete responses[active.sessionId ?? active.clientTurnId];
    return {
      responses,
      creating: Object.values(responses).some((response) => response.sessionId === null),
      ...(failure && state.selected === active.sessionId ? { error: failure } : {}),
    };
  });
  await runtime.client.invalidateQueries({ queryKey: runtime.queries.sessions.queryKey });
}

/**
 * Runs one non-retryable stream, creating its session lazily when necessary.
 *
 * @param runtime - Runtime owning the stream.
 * @param initial - Reserved response for the user prompt.
 * @param controller - Cancellation handle for this submission.
 * @param selectionRevision - Selection revision at submission time.
 */
async function submitTurn(
  runtime: ChatRuntime,
  initial: ActiveResponse,
  controller: AbortController,
  selectionRevision: number,
): Promise<void> {
  let active = initial;
  let failure: string | null = null;
  try {
    if (!active.sessionId) {
      const created = await createTurnSession(runtime, active, controller, selectionRevision);
      if (!created) {
        return;
      }
      active = created;
    }
    const id = active.sessionId;
    if (!id) {
      return;
    }
    controller.signal.throwIfAborted();
    for await (const event of runtime.api.turn(
      { params: { id }, body: { message: active.text, clientTurnId: active.clientTurnId } },
      controller.signal,
    )) {
      if (!isCurrentRuntime(runtime)) {
        return;
      }
      active = receiveEvent(runtime, active, event);
    }
    if (!active.finished) {
      throw new Error("Connection ended before completion. Saved history has been reloaded.");
    }
  } catch (error) {
    if (!isCurrentRuntime(runtime)) {
      return;
    }
    if (error instanceof ApiFailure && error.status === 401) {
      reportChatFailure(runtime, error);
      return;
    }
    failure = controller.signal.aborted
      ? "Analysis stopped. Saved artifacts are retained."
      : error instanceof Error
        ? error.message
        : "Connection failed. Reload saved history before sending again.";
  } finally {
    await finishTurn(runtime, active, controller, failure);
  }
}

/**
 * Reserves and starts a prompt synchronously so double submissions cannot race.
 *
 * @param runtime - Runtime owning the submission.
 * @param text - User prompt.
 * @returns Whether the prompt was accepted.
 */
export function sendChatPrompt(runtime: ChatRuntime, text: string): boolean {
  if (!runtime.identityId || !isCurrentRuntime(runtime)) {
    return false;
  }
  const state = runtime.store.getState();
  const id = state.selected;
  const history = id
    ? runtime.client.getQueryData(runtime.queries.history(id).queryKey)
    : undefined;
  const loading =
    id &&
    !history &&
    runtime.client.getQueryState(runtime.queries.history(id).queryKey)?.fetchStatus === "fetching";
  const sessions = runtime.client.getQueryData(runtime.queries.sessions.queryKey) ?? [];
  if (
    state.creating ||
    loading ||
    (id && state.responses[id]) ||
    history?.turns.some((turn) => turn.status === "running") ||
    sessions.some((session) => session.id === id && session.runningTurn)
  ) {
    return false;
  }
  const parsed = turnRequestSchema.safeParse({ message: text, clientTurnId: crypto.randomUUID() });
  if (!parsed.success) {
    runtime.store.setState({ error: "Enter a question of 1–8,000 characters." });
    return false;
  }
  const active = createResponse(parsed.data.clientTurnId, parsed.data.message, id);
  const controller = new AbortController();
  runtime.streams.set(active.clientTurnId, controller);
  runtime.store.setState({
    responses: { ...state.responses, [id ?? active.clientTurnId]: active },
    creating: !id,
    error: null,
  });
  runChatTask(runtime, submitTurn(runtime, active, controller, state.selectionRevision));
  return true;
}

/**
 * Cancels only the selected session's stream.
 *
 * @param runtime - Runtime owning live responses.
 */
export function stopChatTurn(runtime: ChatRuntime): void {
  const state = runtime.store.getState();
  const active = state.selected ? state.responses[state.selected] : undefined;
  if (active) {
    runtime.streams.get(active.clientTurnId)?.abort();
  }
}
