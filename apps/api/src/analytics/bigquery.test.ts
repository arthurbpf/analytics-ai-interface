import { BigQuery, type JobResponse } from "@google-cloud/bigquery";
import { expect, it, vi } from "vitest";
import { limits } from "../config.ts";
import { BigQueryWarehouse, boundResult, runQuery } from "./bigquery.ts";
import { QueryBudget } from "./budget.ts";
import { fixtureWarehouse, sql } from "../../tests/fixtures/analysis.ts";

it("accepts dry-run metadata with a job reference but no job ID", async () => {
  const job = new BigQuery().job("dry-run");
  job.metadata = { jobReference: { projectId: "test-project" }, statistics: { query: {
    statementType: "SELECT", totalBytesProcessed: "42", referencedTables: [],
  } } };
  const response: JobResponse = [job, {}];
  const create = vi.spyOn(BigQuery.prototype, "createQueryJob").mockImplementation(async () => response);
  try {
    const inspection = await new BigQueryWarehouse("test-project").inspect(sql, new AbortController().signal);
    expect(inspection.estimatedBytes).toBe(42n);
    expect(inspection.statementType).toBe("SELECT");
  } finally { create.mockRestore(); }
});

it("bounds rows, columns, and serialized bytes and flags incomplete evidence", () => {
  expect(boundResult([{ name: "n", type: "INTEGER" }], Array.from({ length: 501 }, () => ({ n: 1 })), "501").complete).toBe(false);
  expect(boundResult(Array.from({ length: 33 }, (_, n) => ({ name: `c${n}`, type: "STRING" })), [{}], "1").complete).toBe(false);
  const large = boundResult([{ name: "text", type: "STRING" }], [{ text: "x".repeat(limits.resultBytes) }], "1");
  expect(large.complete).toBe(false); expect(large.rows).toHaveLength(0);
});
it("normalizes dates, nulls and safe integers without losing large integer precision", () => {
  const client = new BigQuery();
  const data = boundResult([{ name: "n", type: "INTEGER" }, { name: "date", type: "DATE" }, { name: "empty", type: "STRING" }], [
    { n: client.int("12"), date: client.date("2020-11-01"), empty: null },
    { n: client.int("9007199254740993"), date: client.date("2020-11-02"), empty: null },
  ], "2");
  expect(data.rows[0]).toEqual({ n: 12, date: "2020-11-01", empty: null });
  expect(data.rows[1]?.["n"]).toBe("9007199254740993");
  expect(() => boundResult([{ name: "n", type: "INTEGER" }], [{ n: 9007199254740992 }], "1")).toThrow("Unsafe");
  expect(() => boundResult([{ name: "n", type: "RECORD" }], [{ n: { nested: 1 } }], "1")).toThrow("scalar");
});
it("dry-runs before execution, enforces caps independently of LIMIT, and reconciles billing", async () => {
  const warehouse = fixtureWarehouse();
  warehouse.execute = vi.fn(warehouse.execute);
  const budget = new QueryBudget(100n, 150n, 5);
  const result = await runQuery(warehouse, budget, { sql, purpose: "Device" }, new AbortController().signal);
  expect(result.complete).toBe(true); expect(budget.remaining).toBe(140n);
  expect(warehouse.execute).toHaveBeenCalledWith(sql, 100n, expect.any(AbortSignal));
  warehouse.inspect = async () => ({ statementType: "SELECT", tables: [], routines: [], estimatedBytes: 101n });
  await expect(runQuery(warehouse, budget, { sql: `${sql} LIMIT 1`, purpose: "Device" }, new AbortController().signal)).rejects.toThrow("allowed");
  expect(warehouse.execute).toHaveBeenCalledTimes(1);
});
it("does not release uncertain charges and feeds correctable BigQuery errors back", async () => {
  const warehouse = fixtureWarehouse(); const budget = new QueryBudget(100n, 100n, 5);
  warehouse.execute = async () => { throw Object.assign(new Error("Maximum bytes billed exceeded"), { code: 400 }); };
  await expect(runQuery(warehouse, budget, { sql, purpose: "Device" }, new AbortController().signal)).rejects.toMatchObject({ name: "ToolError" });
  expect(budget.remaining).toBe(0n);
});
