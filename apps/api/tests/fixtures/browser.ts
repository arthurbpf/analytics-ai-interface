import { readEvents, type StreamEvent } from "@analytics/contracts";
export async function interruptReview(
  sessionId: string,
  clientTurnId: string,
): Promise<StreamEvent[]> {
  const controller = new AbortController();
  const response = await fetch(`/api/sessions/${sessionId}/turns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Hold this analysis", clientTurnId }),
    signal: controller.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error("Missing response stream");
  }
  const events: StreamEvent[] = [];
  try {
    for await (const event of readEvents(response.body)) {
      events.push(event);
      if (event.type === "progress" && event.message === "Checking the analysis") {
        return events;
      }
    }
    throw new Error("No review before stream ended");
  } finally {
    controller.abort();
  }
}
