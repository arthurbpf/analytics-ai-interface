import { useQueries, useQuery } from "@tanstack/react-query";
import type { SessionHistory } from "@analytics/contracts";
import { hasPendingWork } from "../api/pending-work.ts";
import { useChatContext, useChatResponseIds } from "../state/chat-provider.tsx";

/**
 * Loads the session list and polls saved background work without replaying turns.
 *
 * @returns The current session-list query.
 */
export function useChatSessions() {
  const { runtime } = useChatContext();
  const responseIds = useChatResponseIds();
  const sessions = useQuery({
    ...runtime.queries.sessions,
    refetchInterval: (query) => {
      const histories = runtime.client
        .getQueriesData<SessionHistory>({
          queryKey: [...runtime.queries.scope, "history"],
        })
        .flatMap(([, history]) => (history ? [history] : []));
      return hasPendingWork(query.state.data ?? [], histories) ? 2000 : false;
    },
  });
  const cached = runtime.client
    .getQueriesData<SessionHistory>({
      queryKey: [...runtime.queries.scope, "history"],
    })
    .flatMap(([, history]) =>
      history?.turns.some((turn) => turn.status === "running") ? [history.session.id] : [],
    );
  const runningIds = new Set([
    ...(sessions.data ?? []).filter((session) => session.runningTurn).map((session) => session.id),
    ...cached,
  ]);
  useQueries({
    queries: [...runningIds]
      .filter((id) => !responseIds.includes(id))
      .map((id) => ({
        ...runtime.queries.history(id),
        refetchInterval: 2000,
      })),
  });
  return sessions;
}
