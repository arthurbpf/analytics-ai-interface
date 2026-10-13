import type { SessionHistory } from "@analytics/contracts";
import type { SessionEntry } from "./storage.ts";

/**
 * Reports whether any session has title generation or a turn still running.
 *
 * @param sessions - Known sessions from the index.
 * @param histories - Cached histories that may contain running turns.
 * @returns True when polling should continue.
 */
export function hasPendingWork(sessions: SessionEntry[], histories: SessionHistory[]): boolean {
  return (
    sessions.some((session) => session.titleStatus === "pending" || session.runningTurn) ||
    histories.some((history) => history.turns.some((turn) => turn.status === "running"))
  );
}
