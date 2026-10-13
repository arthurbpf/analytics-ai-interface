import { z } from "zod";
import { metricRequestSchema, resultScopeSchema, queryParametersSchema } from "./metrics.ts";

export const scalarSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
export const columnDisplaySchema = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  format: z.enum(["integer", "decimal", "usd", "percentage", "seconds"]).optional(),
});
export type ColumnDisplay = z.infer<typeof columnDisplaySchema>;
/**
 * Returns a column's display label, falling back to a title-cased column name.
 *
 * @param name - Raw column name.
 * @param display - Optional column display metadata.
 * @returns The configured label, or the name with underscores removed and first letter capitalized.
 */
export function columnLabel(name: string, display?: ColumnDisplay): string {
  if (display?.label) {
    return display.label;
  }
  const words = name.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
export const columnSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["number", "string", "boolean", "date"]),
  display: columnDisplaySchema.optional(),
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
  origin: z.enum(["catalog", "adhoc"]).default("adhoc"),
  catalog: z
    .object({ arguments: metricRequestSchema, definition: z.string() })
    .nullable()
    .default(null),
  parameters: queryParametersSchema.default({}),
  justification: z.string().nullable().default(null),
  requiredCaveats: z
    .array(z.string())
    .default(["Analytical scope and definitions are unspecified for this saved query."]),
  dataQuality: z.record(z.string(), z.union([z.number(), z.string(), z.null()])).default({}),
  scope: resultScopeSchema.default({ kind: "unspecified", topN: null }),
  ref: z.uuid(),
  sql: z.string(),
  purpose: z.string(),
  jobId: z.string(),
  bytesProcessed: z.string().regex(/^\d+$/),
  bytesBilled: z.string().regex(/^\d+$/).nullable(),
});
export type QueryResult = z.infer<typeof queryResultSchema>;
