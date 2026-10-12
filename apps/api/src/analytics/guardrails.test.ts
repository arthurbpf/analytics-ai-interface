import { describe, expect, it } from "vitest";
import { guardSql, checkDryRun } from "./guardrails.ts";

const table = "`bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`";
describe("SQL access", () => {
  it.each([
    `SELECT COUNT(*) AS users FROM ${table} WHERE _TABLE_SUFFIX BETWEEN '20201101' AND '20201130'`,
    `WITH events AS (SELECT user_pseudo_id FROM ${table}) SELECT COUNT(DISTINCT user_pseudo_id) AS users FROM events`,
    `SELECT (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS session_id FROM ${table}`,
    `SELECT item.item_name, COUNT(*) AS n FROM ${table} CROSS JOIN UNNEST(items) AS item GROUP BY item.item_name`,
    `SELECT a.event_name, COUNT(*) AS n FROM ${table} AS a JOIN ${table} AS b ON a.user_pseudo_id = b.user_pseudo_id GROUP BY a.event_name`,
  ])("accepts canonical read-only patterns: %s", (sql) => {
    expect(guardSql(sql)).toContain("SELECT");
  });
  it.each([
    "DELETE FROM `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_20201101` WHERE TRUE",
    `SELECT 1; SELECT * FROM ${table}`,
    "EXPORT DATA OPTIONS(uri='gs://bucket/*', format='CSV') AS SELECT 1",
    "CREATE TEMP FUNCTION f() AS (1); SELECT f()",
    "SELECT * FROM EXTERNAL_QUERY('connection', 'SELECT 1')",
    "SELECT `project.dataset.function`(1)",
    "SELECT * FROM `other.dataset.events_20201101`",
    `WITH x AS (SELECT * FROM \`other.dataset.events_20201101\`) SELECT * FROM x`,
    `SELECT * FROM ${table} UNION ALL SELECT * FROM \`other.dataset.events_20201101\``,
    "nonsense",
  ])("rejects prohibited SQL: %s", (sql) => {
    expect(() => guardSql(sql)).toThrow();
  });
  it("checks dry-run statement and resources independently", () => {
    expect(() => checkDryRun({ statementType: "DELETE", tables: [], routines: [] })).toThrow();
    expect(() =>
      checkDryRun({
        statementType: "SELECT",
        tables: [{ projectId: "other", datasetId: "dataset", tableId: "events_1" }],
        routines: [],
      }),
    ).toThrow();
    expect(() => checkDryRun({ statementType: "SELECT", tables: [], routines: [{}] })).toThrow();
  });
});
