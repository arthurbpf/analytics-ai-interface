import { expect, it } from "vitest";
import { columnLabel, resultDataSchema, type ColumnDisplay } from "@analytics/contracts";
import { formatCell } from "./display.ts";

it.each([
  [1234.56, "usd", "$1,234.56"],
  [-1234.56, "usd", "-$1,234.56"],
  [0, "usd", "$0.00"],
  [0.1234, "percentage", "12.34%"],
  [0, "percentage", "0%"],
  [1234567, "integer", "1,234,567"],
  [1.23456, "decimal", "1.23"],
  [12.345, "seconds", "12.35 s"],
] satisfies [number, ColumnDisplay["format"], string][])(
  "formats %s as %s",
  (value, format, expected) => {
    expect(formatCell(value, { name: "value", type: "number", display: { format } })).toBe(
      expected,
    );
  },
);
it("uses full values outside axes and preserves missing, zero, and unknown units", () => {
  const column = { name: "value", type: "number", display: { format: "usd" } } as const;
  expect(formatCell(1234567.89, column, true)).toBe("$1.2M");
  expect(formatCell(1234567.89, column)).toBe("$1,234,567.89");
  expect(formatCell(null, column)).toBe("—");
  expect(formatCell(undefined)).toBe("—");
  expect(formatCell(0)).toBe("0");
  expect(formatCell(0.1234, { name: "conversion_rate", type: "number" })).toBe("0.12");
  expect(formatCell("9007199254740993", { name: "id", type: "number" })).toBe("9007199254740993");
});
it("formats dates in UTC, leaves strings untouched, and reads legacy columns", () => {
  const column = { name: "day", type: "date" } as const;
  expect(formatCell("2020-11-01", column)).toBe("Nov 1, 2020");
  expect(formatCell("2020-11-01T00:00:00Z", column)).toBe("Nov 1, 2020");
  expect(formatCell("2020-11-01T23:59:00", column)).toBe("Nov 1, 2020");
  expect(formatCell("2020-02-31", column)).toBe("2020-02-31");
  expect(formatCell("invalid", column)).toBe("invalid");
  expect(formatCell("2020-11-01")).toBe("2020-11-01");
  expect(formatCell("some_product_name")).toBe("some_product_name");
  expect(columnLabel("average_order_value")).toBe("Average order value");
  expect(columnLabel("aov", { label: "Average order value" })).toBe("Average order value");
  expect(
    resultDataSchema.parse({ columns: [column], rows: [], totalRows: "0", complete: true }).columns,
  ).toEqual([column]);
});
