import { expect, it } from "vitest";
import { metricIdSchema, queryResultSchema, publishedChartSchema } from "@analytics/contracts";
import { buildMetric, catalog } from "./catalog.ts";
import { guardSql } from "./guardrails.ts";
import { runQuery } from "./bigquery.ts";
import { QueryBudget } from "./budget.ts";
import { fixtureWarehouse, result } from "../../tests/fixtures/analysis.ts";

const dates = { startDate: "2021-01-01", endDate: "2021-01-31" };
it.each(metricIdSchema.options)(
  "guards catalog SQL for %s with full-history semantics",
  (metric) => {
    const request = {
      metric,
      ...dates,
      grain: "week",
      topN: { by: catalog[metric]?.outputColumns[0], count: 5 },
    };
    const built = buildMetric(request);
    expect(guardSql(built.sql)).toBe(built.sql);
    expect(built.sql).toContain("'20201101' AND '20210131'");
    expect(built.parameters["start"]).toBe("20210101");
    expect(built.sql).toContain("LIMIT @top_count");
  },
);
it.each([
  { startDate: "2021-02-01" },
  { startDate: "2020-11-31" },
  { startDate: "2020-02-30" },
  { endDate: "2021-02-01" },
  { startDate: "2021-01-31", endDate: "2021-01-01" },
  { startDate: "2020-10-31" },
  { dimensions: ["device", "device"] },
  { dimensions: ["item_id"] },
  { filters: [{ field: "event_name", op: "eq", value: "purchase" }] },
  { topN: { by: "sessions DESC; DROP TABLE x", count: 1 } },
  { topN: { by: "sessions", count: 501 } },
  { steps: ["purchase"] },
])("rejects invalid session request %j", (override) => {
  expect(() => buildMetric({ metric: "sessions", ...dates, ...override })).toThrow();
});
it("rejects purchaser dimensions and unverified funnel steps, and preserves hostile parameter values", () => {
  expect(() =>
    buildMetric({
      metric: "purchasers_by_purchasing_session_count",
      ...dates,
      dimensions: ["device"],
    }),
  ).toThrow("Unsupported");
  expect(() => buildMetric({ metric: "funnel", ...dates, steps: ["refund"] })).toThrow();
  const value = "US'); DELETE FROM events; --";
  const built = buildMetric({
    metric: "conversion",
    ...dates,
    dimensions: ["device"],
    filters: [{ field: "country", op: "in", value: [value] }],
  });
  expect(built.parameters["filter_0"]).toEqual([value]);
  expect(built.sql).not.toContain(value);
  expect(guardSql(built.sql)).toBe(built.sql);
  expect(built.sql.indexOf("FROM ordered GROUP BY")).toBeLessThan(
    built.sql.indexOf("WHERE event_date BETWEEN @start"),
  );
  expect(built.sql).toContain("COUNTIF(purchased), COUNT(*)");
});
it("does not implicitly limit results and preserves item defaults without multiplying event revenue", () => {
  const built = buildMetric({ metric: "item_performance", ...dates });
  expect(built.sql).toContain("GROUP BY item_id, item_name");
  expect(built.sql).toContain("SUM(item_revenue)");
  expect(built.sql).not.toContain("SUM(revenue)");
  expect(built.sql).not.toContain(" LIMIT ");
  const perPurchase = buildMetric({ metric: "items_per_purchase", ...dates });
  expect(perPurchase.sql).not.toContain("CROSS JOIN UNNEST");
});
it("persists full group counts separately from complete top-N transport, with identical dry-run parameters", async () => {
  const built = buildMetric({
    metric: "users",
    ...dates,
    dimensions: ["device"],
    topN: { by: "users", count: 1 },
  });
  const warehouse = fixtureWarehouse();
  const seen: unknown[] = [];
  warehouse.inspect = async (_sql, _signal, parameters) => {
    seen.push(parameters);
    return { estimatedBytes: 150n, statementType: "SELECT", tables: [], routines: [] };
  };
  warehouse.execute = async (_sql, cap, _signal, parameters) => {
    seen.push(parameters);
    expect(cap).toBe(200n);
    return {
      jobId: "catalog-job",
      bytesProcessed: "150",
      bytesBilled: "150",
      data: {
        columns: [
          { name: "device", type: "string" },
          { name: "users", type: "number" },
          { name: "missing_user_events", type: "number" },
          { name: "_present", type: "number" },
          { name: "_group_count", type: "number" },
          { name: "_quality_missing_user_events", type: "number" },
        ],
        rows: [
          {
            device: "desktop",
            users: 10,
            missing_user_events: 1,
            _present: 1,
            _group_count: 3,
            _quality_missing_user_events: 4,
          },
        ],
        complete: true,
        totalRows: "1",
      },
    };
  };
  const budget = new QueryBudget(100n, 500n, 5);
  const saved = await runQuery(
    warehouse,
    budget,
    { sql: built.sql, purpose: "Users", catalog: built },
    new AbortController().signal,
    200n,
  );
  expect(seen).toEqual([built.parameters, built.parameters]);
  expect(saved.origin).toBe("catalog");
  expect(saved.complete).toBe(true);
  expect(saved.rows).toEqual([{ device: "desktop", users: 10, missing_user_events: 1 }]);
  expect(saved.scope.topN).toEqual({
    by: "users",
    requestedCount: 1,
    returnedCount: 1,
    groupCount: "3",
    omittedGroupCount: "2",
  });
  expect(saved.dataQuality).toEqual({ missing_user_events: 4 });
  expect(budget.remaining).toBe(350n);
});
it("defaults legacy results/charts to unspecified scope without inventing catalog provenance", () => {
  const {
    origin: _origin,
    catalog: _catalog,
    parameters: _parameters,
    scope: _scope,
    ...legacy
  } = result;
  expect(queryResultSchema.parse(legacy)).toMatchObject({
    origin: "adhoc",
    catalog: null,
    scope: { kind: "unspecified" },
  });
  expect(
    publishedChartSchema.parse({
      id: result.ref,
      spec: { type: "table", title: "Old", resultRef: result.ref, columns: ["device"] },
      data: result,
    }).scope.kind,
  ).toBe("unspecified");
});

it("preserves byte-overflow catalog previews without certifying analytical scope", async () => {
  const built = buildMetric({ metric: "users", ...dates, dimensions: ["country"] });
  const warehouse = fixtureWarehouse();
  warehouse.execute = async () => ({
    jobId: "overflow",
    bytesProcessed: "10",
    bytesBilled: "10",
    data: {
      columns: [
        { name: "country", type: "string" },
        { name: "users", type: "number" },
      ],
      rows: [],
      complete: false,
      totalRows: "1",
    },
  });
  const saved = await runQuery(
    warehouse,
    new QueryBudget(100n, 500n, 5),
    { sql: built.sql, purpose: "Users", catalog: built },
    new AbortController().signal,
  );
  expect(saved.origin).toBe("catalog");
  expect(saved.complete).toBe(false);
  expect(saved.scope.kind).toBe("unspecified");
  expect(saved.requiredCaveats.join(" ")).toContain("incomplete");
});
