import { z } from "zod";

export const idSchema = z.uuid();
export const scalarSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
export const columnSchema = z.object({ name: z.string().min(1), type: z.enum(["number", "string", "boolean", "date"]) });
export const resultDataSchema = z.object({
  columns: z.array(columnSchema).max(32),
  rows: z.array(z.record(z.string(), scalarSchema)).max(500),
  complete: z.boolean(),
  totalRows: z.string().regex(/^\d+$/),
});
export const queryResultSchema = resultDataSchema.extend({
  ref: idSchema, sql: z.string(), purpose: z.string(), jobId: z.string(),
  bytesProcessed: z.string().regex(/^\d+$/), bytesBilled: z.string().regex(/^\d+$/).nullable(),
});
const chartBase = z.object({ title: z.string().min(1).max(200), resultRef: idSchema });
const axes = chartBase.extend({ x: z.string().min(1), y: z.string().min(1) });
export const chartSpecSchema = z.discriminatedUnion("type", [
  axes.extend({ type: z.literal("bar") }),
  axes.extend({ type: z.literal("line") }),
  axes.extend({ type: z.literal("stacked_bar"), series: z.string().min(1) }),
  chartBase.extend({ type: z.literal("table"), columns: z.array(z.string().min(1)).min(1).max(32) }),
  chartBase.extend({ type: z.literal("kpi"), column: z.string().min(1), row: z.number().int().min(0).max(499) }),
]);
export const publishedChartSchema = z.object({ id: idSchema, spec: chartSpecSchema, data: resultDataSchema });
export const analysisSchema = z.object({
  narrative: z.string().min(1).max(16000), caveats: z.array(z.string().max(1000)).max(10),
  resultRefs: z.array(idSchema).max(5), chartIds: z.array(idSchema).max(4),
});
export const terminalStatusSchema = z.enum(["completed", "failed", "interrupted"]);
export const turnStatusSchema = z.enum(["running", "completed", "failed", "interrupted"]);
export const apiErrorSchema = z.object({ code: z.string(), message: z.string() });
export const turnRequestSchema = z.object({ message: z.string().trim().min(1).max(8000), clientTurnId: idSchema });
export const sessionSchema = z.object({ id: idSchema, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() });
export const turnSchema = z.object({
  id: idSchema, clientTurnId: idSchema, status: turnStatusSchema,
  createdAt: z.iso.datetime(), finishedAt: z.iso.datetime().nullable(), error: apiErrorSchema.nullable(),
});
// Persist protocol exchanges intact; the browser receives display content only.
export const toolCallSchema = z.object({ id: z.string(), name: z.string(), arguments: z.string() });
export const modelMessageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), content: z.string() }),
  z.object({ role: z.literal("assistant"), content: z.string().nullable(), toolCalls: z.array(toolCallSchema) }),
  z.object({ role: z.literal("tool"), toolCallId: z.string(), content: z.string() }),
]);
export const messageContentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("model"), message: modelMessageSchema }),
  z.object({ kind: z.literal("chart"), chart: publishedChartSchema }),
  z.object({ kind: z.literal("analysis"), analysis: analysisSchema }),
]);
export const displayMessageSchema = z.object({ id: idSchema, turnId: idSchema, content: messageContentSchema });
export const historySchema = z.object({ session: sessionSchema, turns: z.array(turnSchema), messages: z.array(displayMessageSchema) });
const eventBase = z.object({ turnId: idSchema });
export const streamEventSchema = z.discriminatedUnion("type", [
  eventBase.extend({ type: z.literal("turn_started") }),
  eventBase.extend({ type: z.literal("progress"), stage: z.enum(["thinking", "querying", "charting", "composing"]), message: z.string() }),
  eventBase.extend({ type: z.literal("chart_ready"), chart: publishedChartSchema }),
  eventBase.extend({ type: z.literal("analysis_ready"), analysis: analysisSchema }),
  eventBase.extend({ type: z.literal("turn_finished"), status: terminalStatusSchema, error: apiErrorSchema.nullable() }),
]);
export type QueryResult = z.infer<typeof queryResultSchema>;
export type ResultData = z.infer<typeof resultDataSchema>;
export type ChartSpec = z.infer<typeof chartSpecSchema>;
export type PublishedChart = z.infer<typeof publishedChartSchema>;
export type Analysis = z.infer<typeof analysisSchema>;
export type StreamEvent = z.infer<typeof streamEventSchema>;
export type ModelMessage = z.infer<typeof modelMessageSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type MessageContent = z.infer<typeof messageContentSchema>;
export type SessionHistory = z.infer<typeof historySchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type TerminalStatus = z.infer<typeof terminalStatusSchema>;

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
        const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (data) {
          const parsed: unknown = JSON.parse(data);
          yield streamEventSchema.parse(parsed);
        }
        boundary = buffer.indexOf("\n\n");
      }
      if (done) {
        if (buffer.trim() && !buffer.startsWith(":")) { throw new Error("Incomplete SSE frame"); }
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
