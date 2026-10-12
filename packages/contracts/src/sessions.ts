import { z } from "zod";
import { analysisSchema, publishedChartSchema } from "./charts.ts";

export const idSchema = z.uuid();
export const terminalStatusSchema = z.enum(["completed", "failed", "interrupted"]);
export type TerminalStatus = z.infer<typeof terminalStatusSchema>;
export const turnStatusSchema = z.enum(["running", "completed", "failed", "interrupted"]);
export const apiErrorSchema = z.object({ code: z.string(), message: z.string() });
export type ApiError = z.infer<typeof apiErrorSchema>;
export const turnRequestSchema = z.object({
  message: z.string().trim().min(1).max(8000),
  clientTurnId: idSchema,
});
export const sessionSchema = z.object({
  id: idSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const turnSchema = z.object({
  id: idSchema,
  clientTurnId: idSchema,
  status: turnStatusSchema,
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  error: apiErrorSchema.nullable(),
});
// History contains user prompts and published output; model/tool exchanges stay server-side.
export const messageContentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), text: z.string() }),
  z.object({ kind: z.literal("chart"), chart: publishedChartSchema }),
  z.object({ kind: z.literal("analysis"), analysis: analysisSchema }),
]);
export type MessageContent = z.infer<typeof messageContentSchema>;
export const displayMessageSchema = z.object({
  id: idSchema,
  turnId: idSchema,
  content: messageContentSchema,
});
export const historySchema = z.object({
  session: sessionSchema,
  turns: z.array(turnSchema),
  messages: z.array(displayMessageSchema),
});
export type SessionHistory = z.infer<typeof historySchema>;
