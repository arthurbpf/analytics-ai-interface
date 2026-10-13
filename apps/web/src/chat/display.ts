import type { ColumnDisplay, ResultData } from "@analytics/contracts";

type Column = ResultData["columns"][number];
const numbers = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const integers = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const percentages = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 2,
});
const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const dates = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Formats a numeric cell, honouring the column's declared display format.
 *
 * @param value - The numeric value to render.
 * @param format - Declared display format, or undefined for the default decimal form.
 * @param axis - Whether the cell is a chart axis tick, where large numbers are compacted.
 * @returns The formatted number, compacted when it is a large axis tick.
 */
function formatNumber(value: number, format: ColumnDisplay["format"], axis: boolean): string {
  if (format === "percentage") {
    return percentages.format(value);
  }
  if (axis && Math.abs(value) >= 1000) {
    const short = compact.format(value);
    return format === "usd" ? `$${short}` : format === "seconds" ? `${short} s` : short;
  }
  if (format === "usd") {
    return usd.format(value);
  }
  if (format === "integer") {
    return integers.format(value);
  }
  if (format === "seconds") {
    return `${numbers.format(value)} s`;
  }
  return numbers.format(value);
}

/**
 * Renders a date string as a short calendar date in UTC.
 *
 * Calendar dates are interpreted in UTC; malformed values are rejected so they remain
 * reviewable as raw text rather than being silently shifted by a time zone.
 *
 * @param value - Candidate date string from the result set.
 * @returns The formatted date, or null when the value is not a valid calendar date.
 */
function formatDate(value: string): string | null {
  const calendar = /^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(value) ? value.slice(0, 10) : null;
  const date = new Date(calendar ? `${calendar}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime()) || (calendar && date.toISOString().slice(0, 10) !== calendar)) {
    return null;
  }
  return dates.format(date);
}

/**
 * Formats a single result cell as display text, applying column metadata.
 *
 * @param value - Raw cell value from the result set.
 * @param column - Column metadata supplying the type and display format.
 * @param axis - Whether the cell is a chart axis tick, where large numbers are compacted.
 * @returns The cell rendered as text; an em dash for null, undefined, or unrenderable values.
 */
export function formatCell(value: unknown, column?: Column, axis = false): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "number") {
    return formatNumber(value, column?.display?.format, axis);
  }
  if (typeof value === "string" && column?.type === "date") {
    const formatted = formatDate(value);
    if (formatted !== null) {
      return formatted;
    }
  }
  return typeof value === "string" || typeof value === "boolean" ? String(value) : "—";
}
