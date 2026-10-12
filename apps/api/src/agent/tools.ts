import { z } from "zod";
import { analysisSchema, chartSpecSchema, idSchema } from "@analytics/contracts";
import type { ToolDefinition } from "../llm/openrouter.ts";

export const toolSchemas = {
  get_schema: z.object({}),
  get_metrics: z.object({ name: z.string().optional() }),
  run_sql: z.object({ sql: z.string().min(1).max(20000), purpose: z.string().min(1).max(500) }),
  get_result: z.object({ resultRef: idSchema }),
  publish_chart: chartSpecSchema,
  present_analysis: analysisSchema,
};
const descriptions = {
  get_schema: "Inspect the supported GA4 dataset, dates, fields, and nested extraction examples.",
  get_metrics:
    "Read metric definitions and canonical SQL. Use these meanings when freely authoring queries.",
  run_sql:
    "Execute one guarded read-only query. Prefer bounded aggregates with date filters; errors include correction hints.",
  get_result: "Retrieve a saved result belonging to this session without rerunning its query.",
  publish_chart:
    "Validate and publish a complete chart with saved data immediately. Returns its chart ID for the final answer.",
  present_analysis:
    "Complete the turn with narrative, caveats, complete evidence references, and published chart IDs. May also ask a clarification without evidence. Never invent numbers.",
};
export const toolDefinitions: ToolDefinition[] = Object.entries(toolSchemas).map(
  ([name, schema]) => {
    const key = z
      .enum([
        "get_schema",
        "get_metrics",
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
