import { writeFile } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";
import { metricIdSchema, type QueryResult } from "@analytics/contracts";
import { BigQueryWarehouse, runQuery } from "../../src/analytics/bigquery.ts";
import { QueryBudget } from "../../src/analytics/budget.ts";
import { buildMetric, eventTable, historyEvents } from "../../src/analytics/catalog.ts";
import { guardSql, checkDryRun } from "../../src/analytics/guardrails.ts";

const project = z.string().min(1).parse(process.env["GOOGLE_CLOUD_PROJECT"]);
const warehouse = new BigQueryWarehouse(project);
const dates = { startDate: "2020-11-01", endDate: "2021-01-31" };
const observations: {
  category: string;
  definition: string;
  estimatedBytes: string;
  result: QueryResult;
}[] = [];
const estimates: { metric: string; sql: string; parameters: unknown; estimatedBytes: string }[] =
  [];
const window = "_TABLE_SUFFIX BETWEEN '20201101' AND '20210131'";
afterEach(async () => {
  await writeFile(
    new URL("../../../../docs/evaluations/live-catalog-results.json", import.meta.url),
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        project,
        availableHistory: dates,
        observations,
        estimates,
      },
      null,
      2,
    ) + "\n",
  );
});
async function query(sql: string, definition: string, category = "independent_observation") {
  const signal = AbortSignal.timeout(120000);
  const inspected = await warehouse.inspect(guardSql(sql), signal);
  const result = await runQuery(
    warehouse,
    new QueryBudget(2147483648n, 5368709120n, 5),
    { sql, purpose: definition },
    signal,
  );
  observations.push({
    category,
    definition,
    estimatedBytes: inspected.estimatedBytes.toString(),
    result,
  });
  expect(result.complete).toBe(true);
  return result;
}
async function runMetric(
  metric: z.infer<typeof metricIdSchema>,
  extra: Record<string, unknown> = {},
  fixture?: string,
) {
  const built = buildMetric({ metric, ...dates, ...extra });
  if (fixture) {
    built.sql = built.sql.replace(historyEvents, fixture);
  }
  const signal = AbortSignal.timeout(120000);
  const inspected = await warehouse.inspect(guardSql(built.sql), signal, built.parameters);
  const result = await runQuery(
    warehouse,
    new QueryBudget(1073741824n, 5368709120n, 5),
    { sql: built.sql, purpose: metric, catalog: built },
    signal,
    2147483648n,
  );
  observations.push({
    category: fixture ? "adversarial_fixture" : "catalog_observation",
    definition: built.definition,
    estimatedBytes: inspected.estimatedBytes.toString(),
    result,
  });
  expect(result.complete).toBe(true);
  return result;
}
it("records independent vocabulary and missing transaction identities", async () => {
  const events = await query(
    `SELECT event_name, COUNT(*) AS events FROM ${eventTable} WHERE ${window} GROUP BY event_name ORDER BY event_name`,
    "Recorded event vocabulary and counts",
    "vocabulary",
  );
  for (const step of [
    "view_item",
    "view_item_list",
    "select_item",
    "add_to_cart",
    "begin_checkout",
    "add_shipping_info",
    "add_payment_info",
    "purchase",
  ]) {
    expect(events.rows.some((row) => row["event_name"] === step)).toBe(true);
  }
  await query(
    `SELECT ecommerce.transaction_id AS transaction_id, COUNT(*) AS events FROM ${eventTable} WHERE ${window} AND event_name = 'purchase' AND (ecommerce.transaction_id IS NULL OR TRIM(ecommerce.transaction_id) = '' OR LOWER(TRIM(ecommerce.transaction_id)) IN ('(not set)', '<other>', '(data deleted)')) GROUP BY transaction_id ORDER BY transaction_id`,
    "Excluded transaction-ID vocabulary",
    "vocabulary",
  );
  await query(
    `SELECT COUNT(DISTINCT item.item_id) AS item_ids, COUNT(DISTINCT item.item_name) AS item_names FROM ${eventTable} CROSS JOIN UNNEST(items) AS item WHERE ${window}`,
    "Recorded item vocabulary across all events",
    "vocabulary",
  );
});
it("matches independent purchase totals and item aggregates", async () => {
  const reference = await query(
    `SELECT COUNT(*) AS purchases, COALESCE(SUM(ecommerce.purchase_revenue_in_usd), 0) AS revenue, COUNT(DISTINCT IF(ecommerce.transaction_id IS NOT NULL AND TRIM(ecommerce.transaction_id) != '' AND LOWER(TRIM(ecommerce.transaction_id)) NOT IN ('(not set)', '<other>', '(data deleted)'), ecommerce.transaction_id, NULL)) AS transactions FROM ${eventTable} WHERE ${window} AND event_name = 'purchase'`,
    "Purchase events, recorded USD event revenue, distinct valid transaction IDs",
  );
  expect(reference.rows[0]).toEqual({ purchases: 5692, revenue: 362165, transactions: 4451 });
  for (const name of ["purchases", "revenue", "transactions"] as const) {
    expect((await runMetric(name)).rows[0]?.[name]).toBe(reference.rows[0]?.[name]);
  }
  expect((await runMetric("aov")).rows[0]?.["aov"]).toBeCloseTo(362165 / 5692, 8);
  const items = await query(
    `SELECT COALESCE(SUM(item.quantity), 0) AS quantity, COALESCE(SUM(item.item_revenue_in_usd), 0) AS revenue, COUNTIF(item.quantity IS NULL) AS missing_quantities, COUNTIF(item.item_revenue_in_usd IS NULL) AS missing_revenues FROM ${eventTable} CROSS JOIN UNNEST(items) AS item WHERE ${window} AND event_name = 'purchase'`,
    "Recorded purchase-item quantities and USD revenue with missing counts",
  );
  expect(items.rows[0]).toEqual({
    quantity: 22720,
    revenue: 362110,
    missing_quantities: 448,
    missing_revenues: 448,
  });
  const totals = await runMetric("item_performance", { dimensions: ["device"] });
  expect(
    totals.rows.reduce((sum, row) => sum + z.number().parse(row["recorded_item_quantity"]), 0),
  ).toBe(22720);
  expect(
    totals.rows.reduce((sum, row) => sum + z.number().parse(row["recorded_item_revenue"]), 0),
  ).toBe(362110);
  expect((await runMetric("items_per_purchase")).rows[0]?.["items_per_purchase"]).toBeCloseTo(
    22720 / 5692,
    8,
  );
});
it("dry-runs all full-history and January metric shapes for scan calibration", async () => {
  for (const metric of metricIdSchema.options) {
    for (const startDate of ["2020-11-01", "2021-01-01"]) {
      const built = buildMetric({ metric, startDate, endDate: dates.endDate, grain: "week" });
      const inspection = await warehouse.inspect(
        guardSql(built.sql),
        AbortSignal.timeout(120000),
        built.parameters,
      );
      checkDryRun(inspection);
      estimates.push({
        metric,
        sql: built.sql,
        parameters: built.parameters,
        estimatedBytes: inspection.estimatedBytes.toString(),
      });
      expect(inspection.estimatedBytes).toBeLessThanOrEqual(2147483648n);
    }
  }
});

const fixtureRows = [
  ["20201231", -1000000, "purchase", "v", 0, "desktop", 1, null, 5, "prior"],
  ["20210101", 0, "page_view", "u", null, "desktop", null, null, null, null],
  ["20201231", 0, "page_view", "u", 1, "desktop", null, null, null, null],
  ["20210101", 1000000, "begin_checkout", "u", 1, "mobile", 0, null, null, null],
  ["20210102", 2000000, "purchase", "u", 1, "mobile", 1, 500, 20, "same"],
  ["20210101", 3000000, "purchase", "u", 2, "mobile", null, null, 10, "same"],
  ["20210101", 4000000, "begin_checkout", "u", 2, "mobile", null, null, null, null],
  ["20210102", 5000000, "begin_checkout", "v", 3, "desktop", null, null, null, null],
  ["20210102", 5000000, "purchase", "v", 3, "mobile", null, null, 30, "(not set)"],
  ["20210102", 6000000, "purchase", "v", 3, "mobile", null, null, null, ""],
  ["20210103", 7000000, "page_view", "w", 4, "desktop", 0, 0, null, null],
  ["20210103", 8000000, "purchase", "u", 5, "desktop", 1, 1000, 40, "later"],
  ["20210101", 9000000, "purchase", null, null, "desktop", null, null, 100, null],
] as const;
const literal = (value: string | number | null) =>
  value === null ? "NULL" : typeof value === "number" ? String(value) : `'${value}'`;
const fixture = fixtureRows
  .map((row) => {
    const [date, timestamp, event, user, session, device, engaged, time, revenue, transaction] =
      row;

    return `SELECT '${date}' AS event_date, ${timestamp} AS event_timestamp, '${event}' AS event_name, ${literal(user)} AS user_pseudo_id, ${literal(session)} AS session_id, '${device}' AS device, 'US' AS country, 'google' AS source, 'organic' AS medium, ${literal(engaged)} AS engaged_flag, ${literal(time)} AS engagement_time, ${literal(revenue)} AS revenue, ${literal(transaction)} AS transaction_id`;
  })
  .join(" UNION ALL ");
it("executes adversarial SQL fixtures for membership, attribution, rates, ordering and bounded history", async () => {
  const selected = { startDate: "2021-01-01", endDate: "2021-01-02" };
  expect(
    (await runMetric("sessions", { ...selected, dimensions: ["device"] }, fixture)).rows,
  ).toEqual([
    { device: "desktop", sessions: 1 },
    { device: "mobile", sessions: 1 },
  ]);
  expect(
    (
      await runMetric(
        "conversion",
        { ...selected, filters: [{ field: "device", op: "eq", value: "desktop" }] },
        fixture,
      )
    ).rows[0],
  ).toEqual({ conversion_rate: 1, purchasing_sessions: 1, sessions: 1 });
  expect((await runMetric("checkout_abandonment", selected, fixture)).rows[0]).toEqual({
    checkout_abandonment: 0.5,
    abandoned_checkout_sessions: 1,
    checkout_sessions: 2,
  });
  expect((await runMetric("engagement_rate", selected, fixture)).rows[0]).toMatchObject({
    engagement_rate: null,
    unknown_sessions: 2,
    known_sessions: 0,
    sessions: 2,
  });
  expect(
    (await runMetric("avg_observed_session_duration", selected, fixture)).rows[0]?.[
      "avg_observed_session_duration"
    ],
  ).toBe(1);
  expect(
    (
      await runMetric(
        "purchasers_by_purchasing_session_count",
        { startDate: "2021-01-01", endDate: "2021-01-01" },
        fixture,
      )
    ).rows[0],
  ).toEqual({
    one_purchasing_session_users: 1,
    multiple_purchasing_session_users: 0,
    purchasers: 1,
  });
  expect(
    (await runMetric("purchasers_by_purchasing_session_count", selected, fixture)).rows[0],
  ).toEqual({
    one_purchasing_session_users: 0,
    multiple_purchasing_session_users: 2,
    purchasers: 2,
  });
  const top = await runMetric(
    "users",
    { ...selected, dimensions: ["device"], topN: { by: "users", count: 1 } },
    fixture,
  );
  expect(top.rows[0]?.["device"]).toBe("desktop");
  expect(top.scope.topN?.omittedGroupCount).toBe("1");
  expect((await runMetric("transactions", selected, fixture)).rows[0]?.["transactions"]).toBe(1);
  const empty = await runMetric(
    "users",
    {
      ...selected,
      dimensions: ["device"],
      filters: [{ field: "country", op: "eq", value: "missing" }],
      topN: { by: "users", count: 5 },
    },
    fixture,
  );
  expect(empty.rows).toEqual([]);
  expect(empty.scope.topN?.groupCount).toBe("0");
  expect(empty.complete).toBe(true);
  const buckets = await runMetric("sessions", { ...selected, grain: "day" }, fixture);
  expect(buckets.rows).toEqual([
    { day: "2021-01-01", sessions: 1 },
    { day: "2021-01-02", sessions: 1 },
  ]);
  const overlap = await runMetric("users", { ...selected, dimensions: ["device"] }, fixture);
  expect(overlap.rows.reduce((sum, row) => sum + z.number().parse(row["users"]), 0)).toBe(4);
  expect((await runMetric("users", selected, fixture)).rows[0]?.["users"]).toBe(2);
  expect((await runMetric("aov", selected, fixture)).rows[0]).toEqual({
    aov: 32,
    purchases: 5,
    missing_revenue_events: 1,
  });
  const third = { startDate: "2021-01-03", endDate: "2021-01-03" };
  expect(
    (await runMetric("avg_observed_session_duration", third, fixture)).rows[0]?.[
      "avg_observed_session_duration"
    ],
  ).toBe(0);
  expect((await runMetric("avg_recorded_engagement_time", selected, fixture)).rows[0]).toEqual({
    avg_recorded_engagement_time: 0,
    sessions_without_recorded_engagement: 2,
    sessions: 2,
  });
  expect(
    (await runMetric("new_vs_returning_sessions", { ...selected, endDate: "2021-01-03" }, fixture))
      .rows[0],
  ).toEqual({ first_observed_sessions: 1, later_observed_sessions: 3, sessions: 4 });
  const frequency = await runMetric(
    "purchasers_by_purchasing_session_count",
    { ...selected, grain: "day" },
    fixture,
  );
  expect(frequency.rows).toEqual([
    {
      day: "2021-01-01",
      one_purchasing_session_users: 1,
      multiple_purchasing_session_users: 0,
      purchasers: 1,
    },
    {
      day: "2021-01-02",
      one_purchasing_session_users: 0,
      multiple_purchasing_session_users: 2,
      purchasers: 2,
    },
  ]);
});

it("records transaction repetition/conflicts and validates independent session-start totals", async () => {
  const diagnostic = await query(
    `WITH ids AS (SELECT ecommerce.transaction_id AS transaction_id, COUNT(*) AS events, COUNT(DISTINCT user_pseudo_id) AS users, COUNT(DISTINCT event_date) AS dates, COUNT(DISTINCT ecommerce.purchase_revenue_in_usd) AS revenues FROM ${eventTable} WHERE ${window} AND event_name = 'purchase' AND ecommerce.transaction_id IS NOT NULL AND TRIM(ecommerce.transaction_id) != '' AND LOWER(TRIM(ecommerce.transaction_id)) NOT IN ('(not set)', '<other>', '(data deleted)') GROUP BY transaction_id) SELECT COUNTIF(events > 1) AS repeated_ids, COUNTIF(users > 1) AS cross_user_ids, COUNTIF(users > 1 AND dates > 1 AND revenues > 1) AS conflicting_revenue_ids FROM ids`,
    "Repeated valid IDs, cross-user IDs and conflicting revenue across users and dates",
  );
  expect(diagnostic.rows[0]?.["repeated_ids"]).toBe(326);
  expect(diagnostic.rows[0]?.["conflicting_revenue_ids"]).toBe(15);
  const canonical = await query(
    `WITH raw AS (SELECT event_date, event_timestamp, event_name, user_pseudo_id, (SELECT MAX(value.int_value) FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS session_id FROM ${eventTable} WHERE ${window}), first_events AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY user_pseudo_id, session_id ORDER BY event_timestamp, event_name) AS ordinal FROM raw WHERE user_pseudo_id IS NOT NULL AND session_id IS NOT NULL), starts AS (SELECT user_pseudo_id, session_id FROM first_events WHERE ordinal = 1 AND event_date BETWEEN '20210101' AND '20210131') SELECT COUNT(*) AS sessions, COUNT(purchased.session_id) AS purchasing_sessions FROM starts LEFT JOIN (SELECT DISTINCT user_pseudo_id, session_id FROM raw WHERE event_name = 'purchase') AS purchased USING(user_pseudo_id, session_id)`,
    "Independent January session-start count and purchasing-session count over full recorded membership",
  );
  const sessionTotals = await runMetric("sessions", { startDate: "2021-01-01" });
  const conversion = await runMetric("conversion", {
    startDate: "2021-01-01",
    dimensions: ["device"],
  });
  expect(sessionTotals.rows[0]?.["sessions"]).toBe(canonical.rows[0]?.["sessions"]);
  expect(conversion.rows.reduce((sum, row) => sum + z.number().parse(row["sessions"]), 0)).toBe(
    canonical.rows[0]?.["sessions"],
  );
  expect(
    conversion.rows.reduce((sum, row) => sum + z.number().parse(row["purchasing_sessions"]), 0),
  ).toBe(canonical.rows[0]?.["purchasing_sessions"]);
  const engagement = await runMetric("engagement_rate", { startDate: "2021-01-01" });
  expect(engagement.rows[0]?.["unknown_sessions"]).toBe(218);
});

it("executes missing-item SQL fixtures without multiplying purchase-event revenue", async () => {
  const items = `SELECT '20210101' AS event_date, 'purchase' AS event_name, 100 AS revenue,
    [STRUCT('id' AS item_id, '<Other>' AS item_name, 'category' AS item_category, 2 AS quantity, 3 AS item_revenue_in_usd), STRUCT('id' AS item_id, '<Other>' AS item_name, 'category' AS item_category, NULL AS quantity, NULL AS item_revenue_in_usd)] AS items
    UNION ALL SELECT '20210101', 'purchase', NULL, [STRUCT('b' AS item_id, 'B' AS item_name, 'category' AS item_category, NULL AS quantity, NULL AS item_revenue_in_usd)]`;
  const scope = { startDate: "2021-01-01", endDate: "2021-01-01" };
  expect((await runMetric("aov", scope, items)).rows[0]).toEqual({
    aov: 50,
    purchases: 2,
    missing_revenue_events: 1,
  });
  expect((await runMetric("items_per_purchase", scope, items)).rows[0]).toEqual({
    items_per_purchase: 1,
    recorded_item_quantity: 2,
    purchases: 2,
    missing_item_quantities: 2,
    purchase_events_without_items: 0,
  });
  const performance = await runMetric("item_performance", scope, items);
  expect(performance.rows).toEqual([
    {
      item_id: "b",
      item_name: "B",
      recorded_item_quantity: 0,
      recorded_item_revenue: 0,
      missing_item_quantities: 1,
      missing_item_revenues: 1,
    },
    {
      item_id: "id",
      item_name: "<Other>",
      recorded_item_quantity: 2,
      recorded_item_revenue: 3,
      missing_item_quantities: 1,
      missing_item_revenues: 1,
    },
  ]);
});
