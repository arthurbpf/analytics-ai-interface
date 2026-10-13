import type { SessionHistory } from "@analytics/contracts";
import type { ActiveResponse } from "./stream-events.ts";

/**
 * Merges a completed response into cached history when reloading it failed.
 *
 * @param cached - Cached history to merge published artifacts into.
 * @param active - Finished response to retain.
 * @returns A history containing the response's user prompt and published output.
 */
export function mergePublished(cached: SessionHistory, active: ActiveResponse): SessionHistory {
  const turnId = active.turnId;
  if (!turnId) {
    return cached;
  }
  const messages = [...cached.messages];
  if (!messages.some((message) => message.turnId === turnId && message.content.kind === "user")) {
    messages.push({
      id: active.clientTurnId,
      turnId,
      content: { kind: "user", text: active.text },
    });
  }
  for (const chart of active.charts) {
    if (
      !messages.some(
        (message) => message.content.kind === "chart" && message.content.chart.id === chart.id,
      )
    ) {
      messages.push({
        id: chart.id,
        turnId,
        content: { kind: "chart", chart },
      });
    }
  }
  if (
    active.analysis &&
    !messages.some((message) => message.turnId === turnId && message.content.kind === "analysis")
  ) {
    messages.push({
      id: crypto.randomUUID(),
      turnId,
      content: { kind: "analysis", analysis: active.analysis },
    });
  }
  if (
    active.clarification &&
    !messages.some(
      (message) => message.turnId === turnId && message.content.kind === "clarification",
    )
  ) {
    messages.push({
      id: crypto.randomUUID(),
      turnId,
      content: { kind: "clarification", clarification: active.clarification },
    });
  }
  return { ...cached, messages };
}
