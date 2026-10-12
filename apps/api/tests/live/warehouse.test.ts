import { writeFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import type { QueryResult } from "@analytics/contracts";
import { BigQueryWarehouse, runQuery } from "../../src/analytics/bigquery.ts";
import { QueryBudget } from "../../src/analytics/budget.ts";
import { definitions, eventTable } from "../../src/analytics/definitions.ts";
import { guardSql, checkDryRun } from "../../src/analytics/guardrails.ts";
import { validateChart } from "../../src/agent/presentation.ts";

const project = z.string().min(1).parse(process.env["GOOGLE_CLOUD_PROJECT"]);
const warehouse = new BigQueryWarehouse(project);
const queryCap = BigInt(process.env["QUERY_MAX_BYTES"] ?? "1073741824");
const turnCap = BigInt(process.env["TURN_MAX_BYTES"] ?? "5368709120");
const january = "_TABLE_SUFFIX BETWEEN '20210101' AND '20210131'";
const recorded: { purpose: string; estimatedBytes: string; result: QueryResult }[] = [];
const rejections: { sql: string; estimatedBytes: string; cap: string }[] = [];
let totals: QueryResult;
let daily: QueryResult;
function metric(name: keyof typeof definitions) {
  return definitions[name].sql.replace("20201101", "20210101");
}
function number(row: QueryResult["rows"][number] | undefined, column: string): number {
  return z.number().parse(row?.[column]);
}
function sum(result: QueryResult, column: string) {
  return result.rows.reduce((total, row) => total + number(row, column), 0);
}
async function query(sql: string, purpose: string, budget = new QueryBudget(queryCap, turnCap, 5)) {
  const signal = AbortSignal.timeout(120000);
  const inspection = await warehouse.inspect(guardSql(sql), signal);
  const result = await runQuery(warehouse, budget, { sql, purpose }, signal);
  recorded.push({ purpose, estimatedBytes: inspection.estimatedBytes.toString(), result });
  expect(result.complete).toBe(true);
  return result;
}
beforeAll(async () => {
  totals = await query(
    `SELECT COUNT(DISTINCT user_pseudo_id) AS users, COUNTIF(event_name = 'purchase') AS purchases, SUM(IF(event_name = 'purchase', COALESCE(ecommerce.purchase_revenue_in_usd, 0), 0)) AS revenue, SAFE_DIVIDE(SUM(IF(event_name = 'purchase', COALESCE(ecommerce.purchase_revenue_in_usd, 0), 0)), COUNTIF(event_name = 'purchase')) AS aov FROM ${eventTable} WHERE ${january}`,
    "January combined totals",
  );
});
afterAll(async () => {
  await writeFile(
    new URL("../../../../docs/live-bigquery-results.json", import.meta.url),
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        project,
        period: ["2021-01-01", "2021-01-31"],
        queryCap: queryCap.toString(),
        turnCap: turnCap.toString(),
        queries: recorded,
        rejections,
      },
      null,
      2,
    ) + "\n",
  );
});
it("matches independent canonical users, purchases, revenue and AOV", async () => {
  const budget = new QueryBudget(queryCap, turnCap, 5);
  for (const name of [
    "users",
    "purchases",
    "revenue",
    "aov",
  ] satisfies (keyof typeof definitions)[]) {
    const reference = await query(metric(name), `January canonical ${name}`, budget);
    expect(number(totals.rows[0], name)).toBeCloseTo(number(reference.rows[0], name), 6);
  }
  expect(number(totals.rows[0], "users")).toBeGreaterThan(0);
  expect(number(totals.rows[0], "aov")).toBeCloseTo(
    number(totals.rows[0], "revenue") / number(totals.rows[0], "purchases"),
    6,
  );
});
it("daily revenue has complete date buckets and reconciles to canonical total", async () => {
  daily = await query(
    `SELECT PARSE_DATE('%Y%m%d', event_date) AS date, SUM(COALESCE(ecommerce.purchase_revenue_in_usd, 0)) AS revenue FROM ${eventTable} WHERE ${january} AND event_name = 'purchase' GROUP BY date ORDER BY date`,
    "January daily revenue",
  );
  expect(daily.rows).toHaveLength(31);
  expect(daily.rows[0]?.["date"]).toBe("2021-01-01");
  expect(daily.rows.at(-1)?.["date"]).toBe("2021-01-31");
  expect(sum(daily, "revenue")).toBeCloseTo(number(totals.rows[0], "revenue"), 6);
  const chart = validateChart(
    { type: "line", title: "Daily USD revenue", resultRef: daily.ref, x: "date", y: "revenue" },
    daily,
  );
  expect(chart.data.rows).toEqual(daily.rows);
});
it("first-user source/medium attribution reconciles to revenue without dropping unknowns", async () => {
  const attribution = await query(metric("attribution"), "January first-user attribution");
  expect(sum(attribution, "revenue")).toBeCloseTo(number(totals.rows[0], "revenue"), 6);
  expect(
    attribution.rows.every(
      (row) => typeof row["source"] === "string" && typeof row["medium"] === "string",
    ),
  ).toBe(true);
});
it("device conversion counts each valid user/session pair once", async () => {
  const sql = `WITH events AS (SELECT user_pseudo_id, event_name, COALESCE(device.category, '(unknown)') AS device, (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS session_id FROM ${eventTable} WHERE ${january}), sessions AS (SELECT user_pseudo_id, session_id, MIN(device) AS device, MAX(IF(event_name = 'purchase', 1, 0)) AS purchased FROM events WHERE user_pseudo_id IS NOT NULL AND session_id IS NOT NULL GROUP BY user_pseudo_id, session_id) SELECT device, COUNT(*) AS sessions, SUM(purchased) AS purchasing_sessions, SAFE_DIVIDE(SUM(purchased), COUNT(*)) AS conversion_rate FROM sessions GROUP BY device ORDER BY device`;
  const result = await query(
    sql,
    "January device session conversion; assign multi-device sessions using MIN(device)",
  );
  const reference = await query(metric("conversion"), "January canonical overall conversion");
  const sessions = await query(metric("sessions"), "January canonical sessions");
  expect(sum(result, "sessions")).toBe(number(sessions.rows[0], "sessions"));
  expect(sum(result, "purchasing_sessions") / sum(result, "sessions")).toBeCloseTo(
    number(reference.rows[0], "conversion_rate"),
    10,
  );
  for (const row of result.rows) {
    expect(number(row, "conversion_rate")).toBeCloseTo(
      number(row, "purchasing_sessions") / number(row, "sessions"),
      10,
    );
    expect(number(row, "purchasing_sessions")).toBeLessThanOrEqual(number(row, "sessions"));
  }
});
it("weekly aggregation preserves January filters and reconciles to daily revenue", async () => {
  const weekly = await query(
    `SELECT DATE_TRUNC(PARSE_DATE('%Y%m%d', event_date), WEEK(MONDAY)) AS week, SUM(COALESCE(ecommerce.purchase_revenue_in_usd, 0)) AS revenue FROM ${eventTable} WHERE ${january} AND event_name = 'purchase' GROUP BY week ORDER BY week`,
    "January weekly revenue, Monday weeks",
  );
  const expected = new Map<string, number>();
  for (const row of daily.rows) {
    const date = new Date(z.string().parse(row["date"]) + "T00:00:00Z");
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const week = date.toISOString().slice(0, 10);
    expected.set(week, (expected.get(week) ?? 0) + number(row, "revenue"));
  }
  expect(weekly.rows).toHaveLength(expected.size);
  for (const row of weekly.rows) {
    expect(number(row, "revenue")).toBeCloseTo(
      expected.get(z.string().parse(row["week"])) ?? -1,
      6,
    );
  }
});
it("rejects a broad scan before execution even with LIMIT and permits narrowing", async () => {
  const sql = `SELECT * FROM ${eventTable} LIMIT 1`;
  const inspection = await warehouse.inspect(guardSql(sql), AbortSignal.timeout(30000));
  checkDryRun(inspection);
  const budget = new QueryBudget(queryCap, turnCap, 5);
  expect(inspection.estimatedBytes).toBeGreaterThan(queryCap);
  expect(() => budget.reserve(inspection.estimatedBytes)).toThrow("Narrow");
  rejections.push({
    sql,
    estimatedBytes: inspection.estimatedBytes.toString(),
    cap: queryCap.toString(),
  });
  expect(budget.remaining).toBe(turnCap);
  await query(metric("revenue"), "Narrowed January revenue after broad-scan rejection", budget);
});
