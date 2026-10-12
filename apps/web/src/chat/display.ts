import type { ResultData } from "@analytics/contracts";

type Column = ResultData["columns"][number];
const numbers = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const integers = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
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

export function formatCell(value: unknown, column?: Column, axis = false): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "number") {
    const format = column?.display?.format;
    if (format === "percentage") {
      return percentages.format(value);
    }
    if (axis && Math.abs(value) >= 1000) {
      const short = compact.format(value);
      return format === "usd" ? `$${short}` : format === "seconds" ? `${short} s` : short;
    }
    switch (format) {
      case "usd":
        return usd.format(value);
      case "integer":
        return integers.format(value);
      case "seconds":
        return `${numbers.format(value)} s`;
      case "decimal":
      case undefined:
        return numbers.format(value);
    }
  }
  if (typeof value === "string" && column?.type === "date") {
    // Calendar dates are interpreted in UTC; malformed values remain reviewable.
    const calendar = /^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(value) ? value.slice(0, 10) : null;
    const date = new Date(calendar ? `${calendar}T00:00:00Z` : value);
    if (
      !Number.isNaN(date.getTime()) &&
      (!calendar || date.toISOString().slice(0, 10) === calendar)
    ) {
      return dates.format(date);
    }
  }
  return typeof value === "string" || typeof value === "boolean" ? String(value) : "—";
}
