import type {
  Activity,
  Analysis,
  Clarification,
  PublishedChart,
  StreamEvent,
} from "@analytics/contracts";
export type ActiveResponse = {
  sessionId: string | null;
  label: string;
  turnId: string | null;
  text: string;
  clientTurnId: string;
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
