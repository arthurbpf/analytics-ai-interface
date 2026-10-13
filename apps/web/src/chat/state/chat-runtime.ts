import type { Identity } from "@analytics/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { ApiFailure, type ChatApi } from "../api/chat-api.ts";
import {
  createChatQueries,
  identityQueryKey,
  type ChatQueries,
} from "../api/chat-query-options.ts";
import { createChatStore, type ChatStore } from "./chat-store.ts";

export interface ChatRuntime {
  api: ChatApi;
  client: QueryClient;
  identityId: string | null;
  store: ChatStore;
  queries: ChatQueries;
  lifetime: AbortController;
  streams: Map<string, AbortController>;
  onUnauthorized: (message: string) => void;
}

/**
 * Checks that a runtime still belongs to the authenticated identity.
 *
 * @param runtime - Runtime whose callbacks are being applied.
 * @returns Whether it can still change private state.
 */
export function isCurrentRuntime(runtime: ChatRuntime): boolean {
  const identity = runtime.client.getQueryData<Identity | null>(identityQueryKey);
  return !runtime.lifetime.signal.aborted && (identity?.id ?? null) === runtime.identityId;
}

/**
 * Stops stream work and removes the runtime's private cache.
 *
 * @param runtime - Runtime being retired.
 */
export async function disposeChatRuntime(runtime: ChatRuntime): Promise<void> {
  const lifetime = runtime.lifetime;
  runtime.lifetime.abort();
  for (const controller of runtime.streams.values()) {
    controller.abort();
  }
  runtime.streams.clear();
  runtime.store.setState({ responses: {}, creating: false });
  await runtime.client.cancelQueries({ queryKey: runtime.queries.scope });
  if (runtime.lifetime === lifetime) {
    runtime.client.removeQueries({ queryKey: runtime.queries.scope });
  }
}

/**
 * Starts a fresh lifecycle after React's development cleanup rehearsal.
 *
 * @param runtime - Runtime whose effects are being mounted.
 */
export function startChatRuntime(runtime: ChatRuntime): void {
  if (runtime.lifetime.signal.aborted) {
    runtime.lifetime = new AbortController();
  }
}

/**
 * Observes background work and reports unexpected failures.
 *
 * @param runtime - Runtime owning the work.
 * @param task - Work started by a synchronous UI action.
 */
export function runChatTask(runtime: ChatRuntime, task: Promise<unknown>): void {
  void task.then(
    () => {},
    (error: unknown) => reportChatFailure(runtime, error),
  );
}

/**
 * Cancels credential refresh before clearing an expired identity.
 *
 * @param runtime - Runtime owning the expired credential.
 * @param message - Authentication error to retain at the signed-out gate.
 */
async function expireIdentity(runtime: ChatRuntime, message: string): Promise<void> {
  await runtime.client.cancelQueries({ queryKey: identityQueryKey });
  if (!isCurrentRuntime(runtime)) {
    return;
  }
  runtime.lifetime.abort();
  for (const controller of runtime.streams.values()) {
    controller.abort();
  }
  runtime.onUnauthorized(message);
  runtime.client.setQueryData(identityQueryKey, null);
}

/**
 * Reports a current request failure and clears expired credentials.
 *
 * @param runtime - Runtime owning the failed request.
 * @param error - Request failure.
 * @param sessionId - Session to which a history failure belongs, when applicable.
 */
export function reportChatFailure(runtime: ChatRuntime, error: unknown, sessionId?: string): void {
  if (!isCurrentRuntime(runtime)) {
    return;
  }
  if (error instanceof ApiFailure && error.status === 401) {
    runChatTask(runtime, expireIdentity(runtime, error.message));
  } else if (sessionId && sessionId !== runtime.store.getState().selected) {
    return;
  }
  runtime.store.setState({
    error: error instanceof Error ? error.message : "Request could not complete.",
  });
}

/**
 * Creates the small runtime shared by query hooks and stream actions.
 *
 * @param api - Injectable API transport.
 * @param client - Application query cache.
 * @param identityId - Identity owning this runtime.
 * @param onUnauthorized - Retains credential failures after the private runtime is replaced.
 * @returns Runtime containing client state and stream cancellation handles.
 */
export function createChatRuntime(
  api: ChatApi,
  client: QueryClient,
  identityId: string | null,
  onUnauthorized: (message: string) => void,
): ChatRuntime {
  const runtime: ChatRuntime = {
    api,
    client,
    identityId,
    store: createChatStore(identityId),
    queries: createChatQueries(api, identityId, (error, sessionId) =>
      reportChatFailure(runtime, error, sessionId),
    ),
    lifetime: new AbortController(),
    streams: new Map(),
    onUnauthorized,
  };
  return runtime;
}
