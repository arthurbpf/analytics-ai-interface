import { expect, it } from "vitest";
import { chart } from "../testing/chat-fixtures.ts";
import { plotData } from "./chart-data.ts";
import { formatCell } from "./result-format.ts";
it("preserves null, zero, negative values and saved row order", () => {
  const value = chart("line");
  if (value.spec.type !== "line") {
    throw new Error("Expected line");
  }
  value.data.rows = [
    { device: "2020-11-03", purchases: null },
    { device: "2020-11-01", purchases: -2 },
    { device: "2020-11-02", purchases: 0 },
  ];
  expect(plotData(value.spec, value.data).rows).toEqual([
    { x: "2020-11-03", s0: null },
    { x: "2020-11-01", s0: -2 },
    { x: "2020-11-02", s0: 0 },
  ]);
});
it("pivots stacks with safe keys, first-seen ordering, and missing cells", () => {
  const value = chart("stacked_bar");
  if (value.spec.type !== "stacked_bar") {
    throw new Error("Expected stack");
  }
  value.data.rows = [
    { device: "mobile", source: "__proto__", purchases: 0 },
    { device: "desktop", source: "x.y", purchases: -2 },
    { device: "mobile", source: "x.y", purchases: null },
  ];
  const plot = plotData(value.spec, value.data);
  expect(plot.series).toEqual([
    { key: "s0", label: "__proto__" },
    { key: "s1", label: "x.y" },
  ]);
  expect(plot.rows).toEqual([
    { x: "mobile", s0: 0, s1: null },
    { x: "desktop", s0: null, s1: -2 },
  ]);
  value.data.rows.push({ device: "mobile", source: "__proto__", purchases: 9 });
  expect(plotData(value.spec, value.data).duplicate).toBe(true);
});
it("formats dates without shifting timezone and distinguishes missing from zero", () => {
  expect(formatCell("2020-11-01")).toBe("2020-11-01");
  expect(formatCell(null)).toBe("—");
  expect(formatCell(0)).toBe("0");
  expect(formatCell(false)).toBe("false");
});

it("keeps distinct numeric categories distinct when display rounding would match", () => {
  const value = chart("stacked_bar");
  if (value.spec.type !== "stacked_bar") {
    throw new Error("Expected stacked bar");
  }
  value.data.rows = [
    { device: 1.231, source: "direct", purchases: 1 },
    { device: 1.234, source: "direct", purchases: 2 },
  ];
  expect(plotData(value.spec, value.data).rows).toEqual([
    { x: 1.231, s0: 1 },
    { x: 1.234, s0: 2 },
  ]);
});
