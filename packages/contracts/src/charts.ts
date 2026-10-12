import { z } from "zod";
import { resultDataSchema } from "./results.ts";

const chartBase = z.object({ title: z.string().min(1).max(200), resultRef: z.uuid() });
const axes = chartBase.extend({ x: z.string().min(1), y: z.string().min(1) });
export const chartSpecSchema = z.discriminatedUnion("type", [
  axes.extend({ type: z.literal("bar") }),
  axes.extend({ type: z.literal("line") }),
  axes.extend({ type: z.literal("stacked_bar"), series: z.string().min(1) }),
  chartBase.extend({
    type: z.literal("table"),
    columns: z.array(z.string().min(1)).min(1).max(32),
  }),
  chartBase.extend({
    type: z.literal("kpi"),
    column: z.string().min(1),
    row: z.number().int().min(0).max(499),
  }),
]);
export type ChartSpec = z.infer<typeof chartSpecSchema>;
// Includes saved data so rendering never requires another warehouse query.
export const publishedChartSchema = z.object({
  id: z.uuid(),
  spec: chartSpecSchema,
  data: resultDataSchema,
});
export type PublishedChart = z.infer<typeof publishedChartSchema>;
export const analysisSchema = z.object({
  narrative: z.string().min(1).max(16000),
  caveats: z.array(z.string().max(1000)).max(10),
  // Evidence references identify saved queries; chart IDs identify published visualizations.
  resultRefs: z.array(z.uuid()).max(5),
  chartIds: z.array(z.uuid()).max(4),
});
export type Analysis = z.infer<typeof analysisSchema>;
