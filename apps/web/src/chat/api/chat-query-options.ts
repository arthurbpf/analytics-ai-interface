import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type { Session } from "@analytics/contracts";
import type { ChatApi } from "./chat-api.ts";

export const identityQueryKey = ["chat-identity"] as const;

/**
 * Defines the current credential query.
 *
 * @param api - API transport.
 * @returns Identity query options with cancellable reads and no retries.
 */
export function identityQueryOptions(api: ChatApi) {
  return queryOptions({
    queryKey: identityQueryKey,
    queryFn: ({ signal }) => api.identity(signal),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/**
 * Refreshes credentials after cancelling any older authentication request.
 *
 * @param client - Application query client.
 * @param api - API transport.
 */
export async function refreshChatIdentity(client: QueryClient, api: ChatApi): Promise<void> {
  await client.cancelQueries({ queryKey: identityQueryKey });
  await client.fetchQuery({ ...identityQueryOptions(api), staleTime: 0 });
}

/**
 * Defines identity-scoped session and history queries.
 *
 * @param api - API transport.
 * @param identityId - Owner of the private cache.
 * @param onFailure - Reports failures from requests that have not been cancelled.
 * @returns Query options and keys shared by hooks and stream reconciliation.
 */
export function createChatQueries(
  api: ChatApi,
  identityId: string | null,
  onFailure: (error: unknown, sessionId?: string) => void,
) {
  const scope = ["chat", identityId] as const;
  return {
    scope,
    sessions: queryOptions({
      queryKey: [...scope, "sessions"],
      enabled: Boolean(identityId),
      retry: false,
      refetchOnWindowFocus: false,
      queryFn: async ({ signal }) => {
        try {
          return await api.listSessions(signal);
        } catch (error) {
          if (!signal.aborted) {
            onFailure(error);
          }
          throw error;
        }
      },
    }),
    history: (id: string) =>
      queryOptions({
        queryKey: [...scope, "history", id],
        enabled: Boolean(identityId && id),
        retry: false,
        refetchOnWindowFocus: false,
        queryFn: async ({ signal }) => {
          try {
            return await api.history(id, signal);
          } catch (error) {
            if (!signal.aborted) {
              onFailure(error, id);
            }
            throw error;
          }
        },
      }),
  };
}

export type ChatQueries = ReturnType<typeof createChatQueries>;

/**
 * Updates one session in the saved list without duplicating its title.
 *
 * @param client - Query cache receiving the session.
 * @param queries - Identity-scoped query definitions.
 * @param session - Session received from creation, history, or SSE.
 */
export function cacheSession(client: QueryClient, queries: ChatQueries, session: Session): void {
  client.setQueryData(queries.sessions.queryKey, (sessions = []) =>
    [...sessions.filter((entry) => entry.id !== session.id), session].toSorted((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    ),
  );
}
