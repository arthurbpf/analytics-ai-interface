import { z } from "zod";
import { analysisSchema, publishedChartSchema } from "./charts.ts";
import { idSchema, apiErrorSchema, terminalStatusSchema } from "./sessions.ts";

const eventBase = z.object({ turnId: idSchema });
export const streamEventSchema = z.discriminatedUnion("type", [
  eventBase.extend({ type: z.literal("turn_started") }),
  eventBase.extend({
    type: z.literal("progress"),
    stage: z.enum(["thinking", "querying", "charting", "composing"]),
    message: z.string(),
  }),
  eventBase.extend({ type: z.literal("chart_ready"), chart: publishedChartSchema }),
  eventBase.extend({ type: z.literal("analysis_ready"), analysis: analysisSchema }),
  eventBase.extend({
    type: z.literal("turn_finished"),
    status: terminalStatusSchema,
    error: apiErrorSchema.nullable(),
  }),
]);
export type StreamEvent = z.infer<typeof streamEventSchema>;

// Shared framing decoder for fetch/ReadableStream consumers. No vendor or renderer dependencies.
export async function* readEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) {
          const parsed: unknown = JSON.parse(data);
          yield streamEventSchema.parse(parsed);
        }
        boundary = buffer.indexOf("\n\n");
      }
      if (done) {
        if (buffer.trim() && !buffer.startsWith(":")) {
          throw new Error("Incomplete SSE frame");
        }
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
