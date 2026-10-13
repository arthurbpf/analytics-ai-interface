import type { Session, SessionHistory } from "@analytics/contracts";

/**
 * Reports whether any session has title generation or a turn still running.
 *
 * @param sessions - Known sessions from the index.
 * @param histories - Cached histories that may contain running turns.
 * @returns True when polling should continue.
 */
export function hasPendingWork(sessions: Session[], histories: SessionHistory[]): boolean {
  return (
    sessions.some((session) => session.titleStatus === "pending" || session.runningTurn) ||
    histories.some((history) => history.turns.some((turn) => turn.status === "running"))
  );
}
