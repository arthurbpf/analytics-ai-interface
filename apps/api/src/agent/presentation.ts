import { ToolError } from "../errors.ts";
import { randomUUID } from "node:crypto";
import {
  analysisRequestSchema,
  chartSpecSchema,
  type Analysis,
  type ChartSpec,
  type PublishedChart,
  type QueryResult,
} from "@analytics/contracts";
import type { AgentStore } from "../db/store.ts";

/**
 * Validates a chart specification against its saved result and publishes it.
 *
 * Ensures the result is complete and owned by the session, that referenced columns exist,
 * and that the chart type's column roles are satisfied.
 *
 * @param spec - Chart specification proposed by the model.
 * @param result - Complete saved result the chart will render.
 * @returns The validated published chart.
 * @throws When the result or column mappings are invalid for the chart.
 */
export function validateChart(spec: ChartSpec, result: QueryResult): PublishedChart {
  chartSpecSchema.parse(spec);
  if (result.ref !== spec.resultRef || !result.complete) {
    throw new ToolError("Chart requires a complete saved result from this session");
  }
  /**
   * Resolves a column by name, failing when it is absent.
   *
   * @param name - Column name to look up.
   * @returns The matching result column.
   */
  const column = (name: string) => {
    const found = result.columns.find((field) => field.name === name);
    if (!found) {
      throw new ToolError(`Unknown result column: ${name}`);
    }
    return found;
  };
  /**
   * Asserts that a column holds safe numeric values.
   *
   * @param name - Column name that must be numeric.
   */
  const numeric = (name: string) => {
    if (
      column(name).type !== "number" ||
      result.rows.some((row) => row[name] !== null && typeof row[name] !== "number")
    ) {
      throw new ToolError(
        `Chart requires safe numeric values in ${name}; aggregate or cast appropriately.`,
      );
    }
  };
  switch (spec.type) {
    case "table":
      spec.columns.forEach(column);
      break;
    case "kpi":
      numeric(spec.column);
      if (typeof result.rows[spec.row]?.[spec.column] !== "number") {
        throw new ToolError("KPI requires an existing numeric cell");
      }
      break;
    case "bar":
    case "line":
    case "stacked_bar":
      column(spec.x);
      numeric(spec.y);
      if (spec.type === "line" && !["date", "number", "string"].includes(column(spec.x).type)) {
        throw new ToolError("Line axis must be a date, number, or ordered string");
      }
      if (
        spec.type === "stacked_bar" &&
        !["string", "boolean"].includes(column(spec.series).type)
      ) {
        throw new ToolError("Stacked bars require a categorical series column");
      }
      break;
  }
  return {
    id: randomUUID(),
    spec,
    scope: result.scope,
    requiredCaveats: result.requiredCaveats,
    data: {
      columns: result.columns,
      rows: result.rows,
      complete: result.complete,
      totalRows: result.totalRows,
    },
  };
}
/**
 * Validates a final analysis and merges in the caveats of its evidence.
 *
 * Requires every referenced result to exist and be complete, and every selected chart to
 * be prepared and grounded in one of those results.
 *
 * @param value - Untrusted analysis arguments from the model.
 * @param sessionId - Session that must own all referenced results.
 * @param store - Store used to load referenced results.
 * @param charts - Charts prepared so far in the turn.
 * @returns The validated analysis with collected caveats.
 * @throws When evidence or chart references are invalid.
 */
export async function validateAnalysis(
  value: unknown,
  sessionId: string,
  store: AgentStore,
  charts: PublishedChart[],
): Promise<Analysis> {
  const analysis = analysisRequestSchema.parse(value);
  const requiredCaveats: string[] = [];
  for (const ref of analysis.resultRefs) {
    const result = await store.result(sessionId, ref);
    requiredCaveats.push(...result.requiredCaveats);
    if (!result.complete) {
      throw new ToolError("Final evidence must reference complete query results");
    }
  }
  for (const chartId of analysis.chartIds) {
    const chart = charts.find((candidate) => candidate.id === chartId);
    if (!chart) {
      throw new ToolError("Final answer references an unprepared chart");
    }
    if (!analysis.resultRefs.includes(chart.spec.resultRef)) {
      throw new ToolError("Chart result must be included in final evidence references");
    }
  }
  return {
    ...analysis,
    caveats: [...new Set([...analysis.caveats, ...requiredCaveats])],
  };
}
