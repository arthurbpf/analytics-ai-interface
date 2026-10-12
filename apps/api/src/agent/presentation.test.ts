import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  chartSpecSchema,
  streamEventSchema,
  turnRequestSchema,
  type ChartSpec,
} from "@analytics/contracts";
import { validateAnalysis, validateChart } from "./presentation.ts";
import { result, memoryStore, sessionId } from "../../tests/fixtures/analysis.ts";

it.each<ChartSpec>([
  { type: "bar", title: "Device", resultRef: result.ref, x: "device", y: "purchases" },
  { type: "line", title: "Device", resultRef: result.ref, x: "device", y: "purchases" },
  {
    type: "stacked_bar",
    title: "Device",
    resultRef: result.ref,
    x: "device",
    y: "purchases",
    series: "device",
  },
  { type: "table", title: "Device", resultRef: result.ref, columns: ["device", "purchases"] },
  { type: "kpi", title: "Desktop", resultRef: result.ref, column: "purchases", row: 0 },
])("validates and streams $type with saved rows", (spec) => {
  const chart = validateChart(spec, result);
  expect(chart.data.rows).toEqual(result.rows);
  expect(streamEventSchema.parse({ type: "chart_ready", turnId: randomUUID(), chart }).type).toBe(
    "chart_ready",
  );
});
it("rejects unknown columns, incompatible numbers, missing series, and KPI cells", () => {
  const base = {
    type: "bar",
    title: "Device",
    resultRef: result.ref,
    x: "device",
    y: "purchases",
  } satisfies ChartSpec;
  expect(() => validateChart({ ...base, x: "missing" }, result)).toThrow("Unknown");
  expect(() => validateChart({ ...base, y: "device" }, result)).toThrow("numeric");
  expect(() => chartSpecSchema.parse({ ...base, type: "stacked_bar" })).toThrow();
  expect(() =>
    validateChart(
      { type: "kpi", title: "Total", resultRef: result.ref, column: "purchases", row: 3 },
      result,
    ),
  ).toThrow("cell");
});
it("rejects incomplete and mismatched results; empty tables remain valid", () => {
  const spec = {
    type: "table",
    title: "Table",
    resultRef: result.ref,
    columns: ["device"],
  } satisfies ChartSpec;
  expect(() => validateChart(spec, { ...result, complete: false })).toThrow("complete");
  expect(() => validateChart({ ...spec, resultRef: randomUUID() }, result)).toThrow("complete");
  expect(validateChart(spec, { ...result, rows: [], totalRows: "0" }).data.rows).toEqual([]);
});
it("final evidence and chart references must be complete and session-scoped", async () => {
  const { store, results } = memoryStore();
  results.set(result.ref, result);
  const chart = validateChart(
    { type: "table", title: "Table", resultRef: result.ref, columns: ["device"] },
    result,
  );
  const answer = {
    narrative: "Findings",
    resultRefs: [result.ref],
    chartIds: [chart.id],
    caveats: [],
  };
  await expect(validateAnalysis(answer, sessionId, store, [chart])).resolves.toEqual(answer);
  await expect(validateAnalysis(answer, randomUUID(), store, [chart])).rejects.toThrow("not found");
  await expect(
    validateAnalysis({ ...answer, chartIds: [randomUUID()] }, sessionId, store, [chart]),
  ).rejects.toThrow("unpublished");
  results.set(result.ref, { ...result, complete: false });
  await expect(validateAnalysis(answer, sessionId, store, [chart])).rejects.toThrow("complete");
});
it("rejects malformed request and stream payloads", () => {
  expect(() => turnRequestSchema.parse({ message: "", clientTurnId: "bad" })).toThrow();
  expect(() =>
    turnRequestSchema.parse({ message: "x".repeat(8001), clientTurnId: randomUUID() }),
  ).toThrow();
  expect(() =>
    streamEventSchema.parse({ type: "analysis_ready", turnId: randomUUID(), analysis: {} }),
  ).toThrow();
});

it("attaches result-specific caveats and selection scope to charts and final answers", async () => {
  const { store, results } = memoryStore();
  const scoped = {
    ...result,
    scope: {
      kind: "top_n",
      topN: {
        by: "purchases",
        requestedCount: 2,
        returnedCount: 2,
        groupCount: "5",
        omittedGroupCount: "3",
      },
    },
    requiredCaveats: [
      "Only the top two groups; three omitted.",
      "Custom SQL definitions are not catalog-validated.",
    ],
  } satisfies typeof result;
  results.set(result.ref, scoped);
  const chart = validateChart(
    { type: "table", title: "Selection", resultRef: result.ref, columns: ["device"] },
    scoped,
  );
  expect(chart.scope).toEqual(scoped.scope);
  expect(chart.requiredCaveats).toEqual(scoped.requiredCaveats);
  const answer = await validateAnalysis(
    {
      narrative: "Findings",
      resultRefs: [result.ref],
      chartIds: [chart.id],
      caveats: [scoped.requiredCaveats[0]],
    },
    sessionId,
    store,
    [chart],
  );
  expect(answer.caveats).toEqual(scoped.requiredCaveats);
});
