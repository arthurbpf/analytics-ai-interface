import { z } from "zod";

export const scalarSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
export const columnSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["number", "string", "boolean", "date"]),
});
// Counts and byte sizes use decimal strings to preserve integer precision in JSON.
export const resultDataSchema = z.object({
  columns: z.array(columnSchema).max(32),
  rows: z.array(z.record(z.string(), scalarSchema)).max(500),
  // False means rows are a preview and cannot support a final analysis.
  complete: z.boolean(),
  totalRows: z.string().regex(/^\d+$/),
});
export type ResultData = z.infer<typeof resultDataSchema>;
export const queryResultSchema = resultDataSchema.extend({
  ref: z.uuid(),
  sql: z.string(),
  purpose: z.string(),
  jobId: z.string(),
  bytesProcessed: z.string().regex(/^\d+$/),
  bytesBilled: z.string().regex(/^\d+$/).nullable(),
});
export type QueryResult = z.infer<typeof queryResultSchema>;
