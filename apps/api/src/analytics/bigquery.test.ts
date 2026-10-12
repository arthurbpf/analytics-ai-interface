import { BigQuery, type JobResponse } from "@google-cloud/bigquery";
import { expect, it, vi } from "vitest";
import { limits } from "../config.ts";
import { BigQueryWarehouse, boundResult, runQuery } from "./bigquery.ts";
import { QueryBudget } from "./budget.ts";
import { fixtureWarehouse, sql } from "../../tests/fixtures/analysis.ts";
import { buildMetric } from "./catalog.ts";

it("attaches declared custom formats without guessing units from aliases", async () => {
  const input = {
    sql,
    purpose: "Device",
    display: { purchases: { label: "Purchase events", format: "integer" } },
  } as const;
  const result = await runQuery(
    fixtureWarehouse(),
    new QueryBudget(100n, 500n, 5),
    input,
    new AbortController().signal,
  );
  expect(result.columns).toEqual([
    { name: "device", type: "string" },
    { name: "purchases", type: "number", display: input.display.purchases },
  ]);
  expect(result.rows[0]).toEqual({ device: "desktop", purchases: 12 });
});

it.each([{ missing: { label: "Missing" } }, { device: { format: "usd" } }] as const)(
  "rejects unknown columns and incompatible display units: %j",
  async (display) => {
    await expect(
      runQuery(
        fixtureWarehouse(),
        new QueryBudget(100n, 500n, 5),
        { sql, purpose: "Device", display },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/result column|numeric column/);
  },
);

it("attaches catalog units and readable quality counts before saving results", async () => {
  const warehouse = fixtureWarehouse();
  warehouse.execute = async () => ({
    jobId: "revenue-job",
    bytesProcessed: "10",
    bytesBilled: "10",
    data: {
      columns: [
        { name: "revenue", type: "number" },
        { name: "missing_revenue_events", type: "number" },
        { name: "_group_count", type: "number" },
        { name: "_present", type: "number" },
      ],
      rows: [
        {
          revenue: 1234.56,
          missing_revenue_events: 1234,
          _group_count: 1,
          _present: 1,
          _quality_missing_revenue_events: 1234,
        },
      ],
      complete: true,
      totalRows: "1",
    },
  });
  const catalog = buildMetric({
    metric: "revenue",
    startDate: "2020-11-01",
    endDate: "2020-11-30",
  });
  const result = await runQuery(
    warehouse,
    new QueryBudget(100n, 500n, 5),
    { sql: catalog.sql, purpose: "Revenue", catalog },
    new AbortController().signal,
  );
  expect(result.columns[0]?.display).toEqual({ label: "Recorded revenue", format: "usd" });
  expect(result.columns[1]?.display).toEqual({
    label: "Missing revenue events",
    format: "integer",
  });
  expect(result.requiredCaveats.join(" ")).toContain("Missing revenue events: 1,234");
});

it("keeps the serialized result cap after adding column metadata", async () => {
  const warehouse = fixtureWarehouse();
  warehouse.execute = async () => ({
    jobId: "large-result",
    bytesProcessed: "10",
    bytesBilled: "10",
    data: boundResult(
      [{ name: "text", type: "STRING" }],
      [{ text: "x".repeat(limits.resultBytes - 130) }],
      "1",
    ),
  });
  const result = await runQuery(
    warehouse,
    new QueryBudget(100n, 500n, 5),
    {
      sql,
      purpose: "Large result",
      display: { text: { label: "x".repeat(200) } },
    },
    new AbortController().signal,
  );
  expect(result.complete).toBe(false);
  expect(result.rows).toHaveLength(0);
  expect(result.totalRows).toBe("1");
});

it("accepts dry-run metadata with a job reference but no job ID", async () => {
  const job = new BigQuery().job("dry-run");
  job.metadata = {
    jobReference: { projectId: "test-project" },
    statistics: {
      query: {
        statementType: "SELECT",
        totalBytesProcessed: "42",
        referencedTables: [],
      },
    },
  };
  const response: JobResponse = [job, {}];
  const promiseClient: { createQueryJob(query: string): Promise<JobResponse> } = BigQuery.prototype;
  const create = vi.spyOn(promiseClient, "createQueryJob").mockResolvedValue(response);
  try {
    const inspection = await new BigQueryWarehouse("test-project").inspect(
      sql,
      new AbortController().signal,
    );
    expect(inspection.estimatedBytes).toBe(42n);
    expect(inspection.statementType).toBe("SELECT");
  } finally {
    create.mockRestore();
  }
});

it("bounds rows, columns, and serialized bytes and flags incomplete evidence", () => {
  expect(
    boundResult(
      [{ name: "n", type: "INTEGER" }],
      Array.from({ length: 501 }, () => ({ n: 1 })),
      "501",
    ).complete,
  ).toBe(false);
  expect(
    boundResult(
      Array.from({ length: 33 }, (_, n) => ({ name: `c${n}`, type: "STRING" })),
      [{}],
      "1",
    ).complete,
  ).toBe(false);
  const large = boundResult(
    [{ name: "text", type: "STRING" }],
    [{ text: "x".repeat(limits.resultBytes) }],
    "1",
  );
  expect(large.complete).toBe(false);
  expect(large.rows).toHaveLength(0);
});
it("normalizes dates, nulls and safe integers without losing large integer precision", () => {
  const client = new BigQuery();
  const data = boundResult(
    [
      { name: "n", type: "INTEGER" },
      { name: "date", type: "DATE" },
      { name: "empty", type: "STRING" },
    ],
    [
      { n: client.int("12"), date: client.date("2020-11-01"), empty: null },
      { n: client.int("9007199254740993"), date: client.date("2020-11-02"), empty: null },
    ],
    "2",
  );
  expect(data.rows[0]).toEqual({ n: 12, date: "2020-11-01", empty: null });
  expect(data.rows[1]?.["n"]).toBe("9007199254740993");
  expect(() =>
    boundResult([{ name: "n", type: "INTEGER" }], [{ n: 9007199254740992 }], "1"),
  ).toThrow("Unsafe");
  expect(() => boundResult([{ name: "n", type: "RECORD" }], [{ n: { nested: 1 } }], "1")).toThrow(
    "scalar",
  );
});
it("dry-runs before execution, enforces caps independently of LIMIT, and reconciles billing", async () => {
  const warehouse = fixtureWarehouse();
  warehouse.execute = vi.fn(warehouse.execute);
  const budget = new QueryBudget(100n, 150n, 5);
  const result = await runQuery(
    warehouse,
    budget,
    { sql, purpose: "Device" },
    new AbortController().signal,
  );
  expect(result.complete).toBe(true);
  expect(budget.remaining).toBe(140n);
  expect(warehouse.execute).toHaveBeenCalledWith(sql, 100n, expect.any(AbortSignal), undefined);
  warehouse.inspect = async () => ({
    statementType: "SELECT",
    tables: [],
    routines: [],
    estimatedBytes: 101n,
  });
  await expect(
    runQuery(
      warehouse,
      budget,
      { sql: `${sql} LIMIT 1`, purpose: "Device" },
      new AbortController().signal,
    ),
  ).rejects.toThrow("allowed");
  expect(warehouse.execute).toHaveBeenCalledTimes(1);
});
it("does not release uncertain charges and feeds correctable BigQuery errors back", async () => {
  const warehouse = fixtureWarehouse();
  const budget = new QueryBudget(100n, 100n, 5);
  warehouse.execute = async () => {
    throw Object.assign(new Error("Maximum bytes billed exceeded"), { code: 400 });
  };
  await expect(
    runQuery(warehouse, budget, { sql, purpose: "Device" }, new AbortController().signal),
  ).rejects.toMatchObject({ name: "ToolError" });
  expect(budget.remaining).toBe(0n);
});
