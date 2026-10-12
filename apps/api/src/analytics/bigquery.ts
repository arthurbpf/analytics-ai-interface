import { randomUUID } from "node:crypto";
import { BigQuery, BigQueryInt } from "@google-cloud/bigquery";
import { z } from "zod";
import { queryResultSchema, type QueryResult, type ResultData } from "@analytics/contracts";
import { ToolError } from "../errors.ts";
import { limits } from "../config.ts";
import type { QueryBudget } from "./budget.ts";
import { guardSql, checkDryRun, type DryRunAccess } from "./guardrails.ts";

const bytes = z.string().regex(/^\d+$/);
const fieldSchema = z.object({ name: z.string(), type: z.string(), mode: z.string().optional() });
const metadataSchema = z.object({
  jobReference: z.object({ jobId: z.string().optional() }).optional(),
  statistics: z.object({
    query: z.object({
      statementType: z.string().optional(),
      totalBytesProcessed: bytes.default("0"),
      totalBytesBilled: bytes.optional(),
      referencedTables: z
        .array(z.object({ projectId: z.string(), datasetId: z.string(), tableId: z.string() }))
        .default([]),
      referencedRoutines: z.array(z.unknown()).default([]),
      schema: z.object({ fields: z.array(fieldSchema) }).optional(),
    }),
  }),
});
export interface Inspection extends DryRunAccess {
  estimatedBytes: bigint;
}
export interface Execution {
  jobId: string;
  bytesProcessed: string;
  bytesBilled: string | null;
  data: ResultData;
}
export interface Warehouse {
  inspect(this: void, sql: string, signal: AbortSignal): Promise<Inspection>;
  execute(this: void, sql: string, cap: bigint, signal: AbortSignal): Promise<Execution>;
}
const rawRowsSchema = z.array(z.record(z.string(), z.unknown()));
const wrappedValue = z.object({ value: z.string() });
function normalize(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new ToolError("Unsafe numeric result; CAST this value AS STRING in SQL.");
    }
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof BigQueryInt) {
    const n = Number(value.value);
    return Number.isSafeInteger(n) ? n : value.value;
  }
  const wrapped = wrappedValue.safeParse(value);
  if (wrapped.success) {
    return wrapped.data.value;
  }
  throw new ToolError("Nested result cells are unsupported. Return scalar aggregates instead.");
}
export function boundResult(
  fields: z.infer<typeof fieldSchema>[],
  rawRows: unknown,
  totalRows: string,
): ResultData {
  const source = rawRowsSchema.parse(rawRows);
  const columns: ResultData["columns"] = fields.slice(0, limits.columns).map((field) => ({
    name: field.name,
    type: (["INTEGER", "INT64", "FLOAT", "FLOAT64", "NUMERIC", "BIGNUMERIC"].includes(field.type)
      ? "number"
      : ["DATE", "DATETIME", "TIMESTAMP"].includes(field.type)
        ? "date"
        : field.type === "BOOLEAN" || field.type === "BOOL"
          ? "boolean"
          : "string") satisfies ResultData["columns"][number]["type"],
  }));
  let complete = fields.length <= limits.columns && BigInt(totalRows) <= BigInt(limits.rows);
  const rows: ResultData["rows"] = [];
  for (const raw of source.slice(0, limits.rows)) {
    const row: ResultData["rows"][number] = {};
    for (const column of columns) {
      row[column.name] = normalize(raw[column.name]);
    }
    rows.push(row);
    if (
      Buffer.byteLength(JSON.stringify({ columns, rows, complete, totalRows })) > limits.resultBytes
    ) {
      rows.pop();
      complete = false;
      break;
    }
  }
  if (BigInt(rows.length) < BigInt(totalRows)) {
    complete = false;
  }
  return { columns, rows, complete, totalRows };
}
export class BigQueryWarehouse implements Warehouse {
  private readonly client: BigQuery;
  constructor(projectId: string) {
    this.client = new BigQuery({ projectId });
  }
  async inspect(sql: string, signal: AbortSignal): Promise<Inspection> {
    signal.throwIfAborted();
    const [job] = await this.client.createQueryJob({
      query: sql,
      dryRun: true,
      useLegacySql: false,
      location: "US",
    });
    signal.throwIfAborted();
    const raw: unknown = job.metadata;
    const query = metadataSchema.parse(raw).statistics.query;
    return {
      statementType: query.statementType ?? "",
      tables: query.referencedTables,
      routines: query.referencedRoutines,
      estimatedBytes: BigInt(query.totalBytesProcessed),
    };
  }
  async execute(sql: string, cap: bigint, signal: AbortSignal): Promise<Execution> {
    signal.throwIfAborted();
    const [job] = await this.client.createQueryJob({
      query: sql,
      useLegacySql: false,
      location: "US",
      maximumBytesBilled: cap.toString(),
      jobTimeoutMs: limits.deadlineMs,
    });
    let cancellation: Promise<void> | undefined;
    const cancel = async () => {
      try {
        await job.cancel();
      } catch {
        console.error(JSON.stringify({ event: "query_cancel_failed", jobId: job.id }));
      }
    };
    const aborted = Promise.withResolvers<never>();
    const onAbort = () => {
      cancellation = cancel();
      aborted.reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
    }
    try {
      const rawResponse: unknown = await Promise.race([
        job.getQueryResults({
          autoPaginate: false,
          maxResults: limits.rows + 1,
          wrapIntegers: true,
        }),
        aborted.promise,
      ]);
      const response = z
        .tuple([
          z.unknown(),
          z.unknown(),
          z
            .object({ totalRows: bytes, schema: z.object({ fields: z.array(fieldSchema) }) })
            .passthrough(),
        ])
        .parse(rawResponse);
      const rawMetadata: unknown = await job.getMetadata();
      const metadata = z.tuple([metadataSchema]).rest(z.unknown()).parse(rawMetadata)[0];
      signal.throwIfAborted();
      const query = metadata.statistics.query;
      const jobId = metadata.jobReference?.jobId ?? job.id;
      if (!jobId) {
        throw new Error("Warehouse did not return a job ID");
      }
      return {
        jobId,
        bytesProcessed: query.totalBytesProcessed,
        bytesBilled: query.totalBytesBilled ?? null,
        data: boundResult(response[2].schema.fields, response[0], response[2].totalRows),
      };
    } finally {
      signal.removeEventListener("abort", onAbort);
      if (cancellation) {
        await cancellation;
      }
    }
  }
}
export async function runQuery(
  warehouse: Warehouse,
  budget: QueryBudget,
  input: { sql: string; purpose: string },
  signal: AbortSignal,
): Promise<QueryResult> {
  const sql = guardSql(input.sql);
  let inspection: Inspection;
  try {
    inspection = await warehouse.inspect(sql, signal);
  } catch (error) {
    const apiError = z.object({ code: z.literal(400), message: z.string() }).safeParse(error);
    if (apiError.success) {
      throw new ToolError(apiError.data.message);
    }
    throw error;
  }
  checkDryRun(inspection);
  const cap = budget.reserve(inspection.estimatedBytes);
  let executed: Execution;
  try {
    executed = await warehouse.execute(sql, cap, signal);
  } catch (error) {
    const apiError = z.object({ code: z.literal(400), message: z.string() }).safeParse(error);
    if (apiError.success) {
      throw new ToolError(apiError.data.message);
    }
    throw error;
  }
  if (executed.bytesBilled !== null) {
    budget.settle(cap, BigInt(executed.bytesBilled));
  }
  console.info(
    JSON.stringify({
      event: "query_complete",
      jobId: executed.jobId,
      estimatedBytes: inspection.estimatedBytes.toString(),
      bytesBilled: executed.bytesBilled,
    }),
  );
  return queryResultSchema.parse({
    ref: randomUUID(),
    sql,
    purpose: input.purpose,
    ...executed.data,
    jobId: executed.jobId,
    bytesProcessed: executed.bytesProcessed,
    bytesBilled: executed.bytesBilled,
  });
}
