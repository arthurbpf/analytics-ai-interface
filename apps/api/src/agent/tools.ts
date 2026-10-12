import { z } from "zod";
import {
  analysisRequestSchema,
  chartSpecSchema,
  idSchema,
  metricRequestSchema,
  clarificationSchema,
  columnDisplaySchema,
} from "@analytics/contracts";
import type { ToolDefinition } from "../llm/openrouter.ts";

export const toolSchemas = {
  get_schema: z.object({}),
  get_metrics: z.object({ name: z.string().optional() }),
  run_metric: metricRequestSchema,
  request_clarification: clarificationSchema,
  run_sql: z
    .object({
      sql: z.string().min(1).max(20000),
      purpose: z.string().min(1).max(500),
      justification: z.string().trim().min(1).max(1000),
      display: z.record(z.string().min(1), columnDisplaySchema).optional(),
    })
    .strict(),
  get_result: z.object({ resultRef: idSchema }),
  publish_chart: chartSpecSchema,
  present_analysis: analysisRequestSchema,
};
const descriptions = {
  get_schema: "Inspect the supported GA4 dataset, dates, fields, and nested extraction examples.",
  get_metrics:
    "Read catalog definitions, accepted parameters, output columns, and canonical guidance.",
  run_metric:
    "Execute a server-built catalog metric with dates, dimensions, typed filters, optional grain and explicit top-N.",
  request_clarification:
    "Complete the turn with 1–3 questions and context when ambiguity materially affects the answer. Must be last.",
  run_sql:
    "Execute one guarded read-only query. Requires justification for a clear computable request outside the catalog. Prefer bounded aggregates with date filters; errors include correction hints. Supply display metadata keyed by output alias: readable labels and integer, decimal, usd, percentage (a ratio, not a 0–100 value), or seconds formats only when units are known.",
  get_result: "Retrieve a saved result belonging to this session without rerunning its query.",
  publish_chart:
    "Validate and save a candidate chart from complete saved data. Returns its ID; selected charts publish with the approved final answer.",
  present_analysis:
    "Complete the turn with narrative, caveats, complete evidence references, and prepared chart IDs. The answer must pass analytical review before publication. Metric explanations may omit references; dataset-specific numerical claims require saved evidence. Must be last. Never invent numbers.",
};
export const toolDefinitions: ToolDefinition[] = Object.entries(toolSchemas).map(
  ([name, schema]) => {
    const key = z
      .enum([
        "get_schema",
        "get_metrics",
        "run_metric",
        "request_clarification",
        "run_sql",
        "get_result",
        "publish_chart",
        "present_analysis",
      ])
      .parse(name);
    return {
      type: "function",
      function: { name, description: descriptions[key], parameters: z.toJSONSchema(schema) },
    };
  },
);
