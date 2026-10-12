import { readEvents, type StreamEvent } from "@analytics/contracts";
export async function firstChart(sessionId: string, clientTurnId: string): Promise<StreamEvent[]> {
  const controller = new AbortController();
  const response = await fetch(`/api/sessions/${sessionId}/turns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Purchases by device", clientTurnId }),
    signal: controller.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error("Missing response stream");
  }
  const events: StreamEvent[] = [];
  try {
    for await (const event of readEvents(response.body)) {
      events.push(event);
      if (event.type === "chart_ready") {
        return events;
      }
    }
    throw new Error("No chart before stream ended");
  } finally {
    controller.abort();
  }
}
