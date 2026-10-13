import type {
  Activity,
  Analysis,
  Clarification,
  Identity,
  PublishedChart,
  SessionHistory,
  StreamEvent,
} from "@analytics/contracts";
import type { SessionIndex } from "./storage.ts";

export interface ChatState {
  identity: Identity | null;
  ready: boolean;
  index: SessionIndex;
  selected: string | null;
  histories: Record<string, SessionHistory>;
  responses: Record<string, ActiveResponse>;
  creating: boolean;
  loading: boolean;
  error: string | null;
  warning: string | null;
}
export type ActiveResponse = {
  sessionId: string | null;
  label: string;
  turnId: string | null;
  text: string;
  clientTurnId: string;
  controller: AbortController;
  charts: PublishedChart[];
  analysis: Analysis | null;
  clarification: Clarification | null;
  progress: string;
  activities: Activity[];
  finished: boolean;
};

/**
 * Creates an in-flight response for a submitted prompt.
 *
 * @param clientTurnId - Client-generated turn identifier.
 * @param message - User prompt being answered.
 * @param sessionId - Owning session, or null before it is created.
 * @returns A new active response awaiting its first stream event.
 */
export function createResponse(
  clientTurnId: string,
  message: string,
  sessionId: string | null,
): ActiveResponse {
  return {
    sessionId,
    label: message.slice(0, 60),
    turnId: null,
    text: message,
    clientTurnId,
    controller: new AbortController(),
    charts: [],
    analysis: null,
    clarification: null,
    progress: "Starting analysis",
    activities: [],
    finished: false,
  };
}

/**
 * Applies one stream event, returning the updated active response.
 *
 * @param active - In-progress response the event belongs to.
 * @param event - Stream event to apply.
 * @returns The response with the event's state merged in.
 */
export function applyEvent(active: ActiveResponse, event: StreamEvent): ActiveResponse {
  switch (event.type) {
    case "turn_started":
      return { ...active, turnId: event.turnId };
    case "session_updated":
      return active;
    case "progress":
      return { ...active, progress: event.message };
    case "activity": {
      const index = active.activities.findIndex((item) => item.id === event.activity.id);
      const activities =
        index < 0
          ? [...active.activities, event.activity]
          : active.activities.map((item, position) => (position === index ? event.activity : item));
      return {
        ...active,
        activities,
        progress: `${event.activity.message} — ${event.activity.status}`,
      };
    }
    case "chart_ready":
      return active.charts.some((chart) => chart.id === event.chart.id)
        ? active
        : { ...active, charts: [...active.charts, event.chart] };
    case "clarification_ready":
      return { ...active, clarification: event.clarification };
    case "analysis_ready":
      return { ...active, analysis: event.analysis };
    case "turn_finished":
      return { ...active, finished: true, activities: [] };
    default:
      return active;
  }
}

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
