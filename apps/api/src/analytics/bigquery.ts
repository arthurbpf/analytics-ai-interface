import { randomUUID } from "node:crypto";
import { BigQuery, BigQueryInt } from "@google-cloud/bigquery";
import { z } from "zod";
import {
  queryResultSchema,
  type QueryResult,
  type ResultData,
  type QueryParameters,
  type ColumnDisplay,
  columnLabel,
} from "@analytics/contracts";
import { catalogColumnDisplay, type BuiltMetric } from "./catalog.ts";
import { ToolError } from "../errors.ts";
import { limits } from "../config.ts";
import type { QueryBudget } from "./budget.ts";
import { guardSql, checkDryRun, type DryRunAccess } from "./guardrails.ts";

const bytes = z.string().regex(/^\d+$/);
const fieldSchema = z.object({
  name: z.string(),
  type: z.string(),
  mode: z.string().optional(),
});
const metadataSchema = z.object({
  jobReference: z.object({ jobId: z.string().optional() }).optional(),
  statistics: z.object({
    query: z.object({
      statementType: z.string().optional(),
      totalBytesProcessed: bytes.default("0"),
      totalBytesBilled: bytes.optional(),
      referencedTables: z
        .array(
          z.object({
            projectId: z.string(),
            datasetId: z.string(),
            tableId: z.string(),
          }),
        )
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
  inspect(
    this: void,
    sql: string,
    signal: AbortSignal,
    parameters?: QueryParameters,
  ): Promise<Inspection>;
  execute(
    this: void,
    sql: string,
    cap: bigint,
    signal: AbortSignal,
    parameters?: QueryParameters,
  ): Promise<Execution>;
}
const rawRowsSchema = z.array(z.record(z.string(), z.unknown()));
const wrappedValue = z.object({ value: z.string() });
/**
 * Reports whether a result fits within the serialized result byte limit.
 *
 * @param data - Candidate result data.
 * @returns True when the JSON-serialized result is within the byte budget.
 */
function fitsResult(data: ResultData): boolean {
  return Buffer.byteLength(JSON.stringify(data)) <= limits.resultBytes;
}
/**
 * Converts a raw BigQuery cell into a supported scalar.
 *
 * @param value - Raw cell value from the warehouse.
 * @returns The value as a string, number, boolean, or null.
 * @throws When the value is unsafe or nested.
 */
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
/**
 * Converts a raw query response into a bounded, JSON-safe result.
 *
 * Truncates columns and rows to the configured limits and marks the result incomplete
 * when anything was dropped or the row count was capped.
 *
 * @param fields - BigQuery schema fields for the query.
 * @param rawRows - Raw rows returned by the warehouse.
 * @param totalRows - Total row count reported by BigQuery as a decimal string.
 * @returns The bounded result data.
 */
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
    if (!fitsResult({ columns, rows, complete, totalRows })) {
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
/**
 * BigQuery-backed warehouse that dry-runs and executes queries within byte caps.
 */
export class BigQueryWarehouse implements Warehouse {
  private readonly client: BigQuery;

  /**
   * Creates a warehouse bound to a Google Cloud project.
   *
   * @param projectId - Google Cloud project that owns the billing and jobs.
   */
  constructor(projectId: string) {
    this.client = new BigQuery({ projectId });
  }

  /**
   * Dry-runs a query to estimate bytes and inspect its access plan.
   *
   * @param sql - SQL to inspect.
   * @param signal - Abort signal for cancellation.
   * @param parameters - Bound query parameters, if any.
   * @returns The dry-run inspection metadata.
   */
  async inspect(
    sql: string,
    signal: AbortSignal,
    parameters?: QueryParameters,
  ): Promise<Inspection> {
    signal.throwIfAborted();
    const [job] = await this.client.createQueryJob({
      query: sql,
      ...(parameters ? { params: parameters } : {}),
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
  /**
   * Executes a query under a byte cap, cancelling it if the signal aborts.
   *
   * @param sql - SQL to execute.
   * @param cap - Maximum bytes BigQuery may bill for the job.
   * @param signal - Abort signal that cancels the job.
   * @param parameters - Bound query parameters, if any.
   * @returns The execution metadata and bounded result data.
   */
  async execute(
    sql: string,
    cap: bigint,
    signal: AbortSignal,
    parameters?: QueryParameters,
  ): Promise<Execution> {
    signal.throwIfAborted();
    const [job] = await this.client.createQueryJob({
      query: sql,
      ...(parameters ? { params: parameters } : {}),
      useLegacySql: false,
      location: "US",
      maximumBytesBilled: cap.toString(),
      jobTimeoutMs: limits.deadlineMs,
    });
    let cancellation: Promise<void> | undefined;
    /**
     * Cancels the running BigQuery job, logging but not surfacing cancel failures.
     */
    const cancel = async () => {
      try {
        await job.cancel();
      } catch {
        console.error(JSON.stringify({ event: "query_cancel_failed", jobId: job.id }));
      }
    };
    const aborted = Promise.withResolvers<never>();
    /**
     * Cancels the job and rejects the race when the abort signal fires.
     */
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
            .object({
              totalRows: bytes,
              schema: z.object({ fields: z.array(fieldSchema) }),
            })
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
/**
 * Guards, budget-checks, executes, and post-processes a single query.
 *
 * Dry-runs for an estimate, reserves bytes, executes under the cap, reconciles billed
 * bytes, and attaches catalog scope, caveats, and display metadata to the result.
 *
 * @param warehouse - Warehouse used to inspect and execute the SQL.
 * @param budget - Turn byte budget that reserves and settles this query.
 * @param input - SQL, purpose, and optional catalog or display metadata.
 * @param signal - Abort signal for cancellation.
 * @param perQueryCap - Optional per-query byte cap.
 * @returns The final bounded query result.
 */
export async function runQuery(
  warehouse: Warehouse,
  budget: QueryBudget,
  input: {
    sql: string;
    purpose: string;
    justification?: string;
    catalog?: BuiltMetric;
    display?: Record<string, ColumnDisplay> | undefined;
  },
  signal: AbortSignal,
  perQueryCap?: bigint,
): Promise<QueryResult> {
  const sql = guardSql(input.sql);
  let inspection: Inspection;
  try {
    inspection = await warehouse.inspect(sql, signal, input.catalog?.parameters);
  } catch (error) {
    const apiError = z.object({ code: z.literal(400), message: z.string() }).safeParse(error);
    if (apiError.success) {
      throw new ToolError(apiError.data.message);
    }
    throw error;
  }
  checkDryRun(inspection);
  const cap = budget.reserve(inspection.estimatedBytes, perQueryCap);
  let executed: Execution;
  try {
    executed = await warehouse.execute(sql, cap, signal, input.catalog?.parameters);
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
  let data = executed.data;
  const dataQuality: QueryResult["dataQuality"] = {};
  let scope: QueryResult["scope"] = { kind: "unspecified", topN: null };
  const requiredCaveats = input.catalog
    ? [...input.catalog.requiredCaveats]
    : [
        "Custom SQL: analytical scope and definitions are not catalog-validated; successful execution does not certify analytical correctness.",
      ];
  if (input.catalog) {
    const first = data.rows[0];
    const groupCount = first?.["_group_count"];
    const rows = data.rows
      .filter((row) => row["_present"] === 1)
      .map((row) =>
        Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith("_"))),
      );
    data = {
      ...data,
      columns: data.columns.filter((column) => !column.name.startsWith("_")),
      rows,
    };
    if (!data.complete && (typeof groupCount !== "number" || !Number.isSafeInteger(groupCount))) {
      requiredCaveats.push(
        "Transport preview is incomplete; analytical scope metadata could not be fetched. Narrow or aggregate the query.",
      );
    } else {
      if (typeof groupCount !== "number" || !Number.isSafeInteger(groupCount) || groupCount < 0) {
        throw new Error("Catalog query did not return valid group metadata");
      }
      for (const [key, value] of Object.entries(first ?? {})) {
        if (
          key.startsWith("_quality_") &&
          (typeof value === "number" || typeof value === "string" || value === null)
        ) {
          dataQuality[key.slice(9)] = value;
        }
      }
      const topN = input.catalog.arguments.topN;
      const returnedCount = topN ? Math.min(groupCount, topN.count) : groupCount;
      data = {
        ...data,
        totalRows: String(returnedCount),
        complete: data.complete && rows.length === returnedCount,
      };
      scope = {
        kind: topN ? "top_n" : "full",
        topN: topN
          ? {
              by: topN.by,
              requestedCount: topN.count,
              returnedCount,
              groupCount: String(groupCount),
              omittedGroupCount: String(groupCount - returnedCount),
            }
          : null,
      };
      if (Object.keys(dataQuality).length) {
        requiredCaveats.push(
          `Data-quality counts across the full requested breakdown before ranking: ${Object.entries(
            dataQuality,
          )
            .map(
              ([name, value]) =>
                `${columnLabel(name, catalogColumnDisplay(name))}: ${value === null ? "unavailable" : typeof value === "number" ? value.toLocaleString("en-US") : value}`,
            )
            .join("; ")}.`,
        );
      }
      if (scope.topN) {
        requiredCaveats.push(
          `Returned ${returnedCount.toLocaleString("en-US")} of ${groupCount.toLocaleString("en-US")} groups; omitted ${(groupCount - returnedCount).toLocaleString("en-US")}.`,
        );
      }
    }
  }
  for (const [name, display] of Object.entries(input.display ?? {})) {
    const column = data.columns.find((item) => item.name === name);
    if (!column) {
      throw new ToolError(`Display metadata references unknown result column: ${name}`);
    }
    if (display.format && column.type !== "number") {
      throw new ToolError(`Numeric display format requires a numeric column: ${name}`);
    }
  }
  data = {
    ...data,
    columns: data.columns.map((column) => {
      const display = input.catalog
        ? catalogColumnDisplay(column.name)
        : input.display?.[column.name];
      return display ? { ...column, display } : column;
    }),
  };
  if (!fitsResult(data)) {
    data = { ...data, rows: [...data.rows], complete: false };
    while (data.rows.length && !fitsResult(data)) {
      data.rows.pop();
    }
  }
  return queryResultSchema.parse({
    origin: input.catalog ? "catalog" : "adhoc",
    catalog: input.catalog
      ? {
          arguments: input.catalog.arguments,
          definition: input.catalog.definition,
        }
      : null,
    parameters: input.catalog?.parameters ?? {},
    justification: input.justification ?? null,
    requiredCaveats,
    dataQuality,
    scope,
    ref: randomUUID(),
    sql,
    purpose: input.purpose,
    ...data,
    jobId: executed.jobId,
    bytesProcessed: executed.bytesProcessed,
    bytesBilled: executed.bytesBilled,
  });
}
