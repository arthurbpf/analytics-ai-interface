import { columnLabel, type ChartSpec, type ResultData } from "@analytics/contracts";
import { formatCell } from "./display.ts";
/**
 * Transforms result rows into the series and row shape a chart renders.
 *
 * Detects duplicate x/series pairs, which stacked bars cannot represent faithfully.
 *
 * @param spec - Bar, line, or stacked-bar chart specification.
 * @param data - Result data to plot.
 * @returns Row and series data, plus a duplicate flag when the shape is unrepresentable.
 */
export function plotData(
  spec: Extract<ChartSpec, { type: "bar" | "line" | "stacked_bar" }>,
  data: ResultData,
) {
  if (spec.type !== "stacked_bar") {
    return {
      rows: data.rows.map((row) => ({
        x: row[spec.x] ?? null,
        s0: row[spec.y] ?? null,
      })),
      series: [
        {
          key: "s0",
          label: columnLabel(
            spec.y,
            data.columns.find((column) => column.name === spec.y)?.display,
          ),
        },
      ],
      duplicate: false,
    };
  }
  const seriesIndex = new Map<string, string>();
  const series: { key: string; label: string }[] = [];
  for (const row of data.rows) {
    const value = row[spec.series] ?? null;
    const identifier = JSON.stringify(value);
    if (!seriesIndex.has(identifier)) {
      const key = `s${series.length}`;
      seriesIndex.set(identifier, key);
      series.push({ key, label: formatCell(value) });
    }
  }
  const groups = new Map<string, Record<string, string | number | boolean | null>>();
  const seen = new Set<string>();
  for (const row of data.rows) {
    const x = row[spec.x] ?? null;
    const label = row[spec.series] ?? null;
    const pair = JSON.stringify([x, label]);
    if (seen.has(pair)) {
      return { rows: [], series, duplicate: true };
    }
    seen.add(pair);
    const groupKey = JSON.stringify(x);
    let entry = groups.get(groupKey);
    if (!entry) {
      entry = { x };
      for (const item of series) {
        entry[item.key] = null;
      }
      groups.set(groupKey, entry);
    }
    const key = seriesIndex.get(JSON.stringify(label));
    if (key) {
      entry[key] = row[spec.y] ?? null;
    }
  }
  return { rows: [...groups.values()], series, duplicate: false };
}
