import { ToolError } from "../errors.ts";
import sqlParser from "node-sql-parser";
import { z } from "zod";

export const dataset = "bigquery-public-data.ga4_obfuscated_sample_ecommerce";
const parser = new sqlParser.Parser();
const nodeSchema = z.record(z.string(), z.unknown());
const tableSchema = z.object({
  db: z.string().nullable().optional(),
  table: z.string().nullable().optional(),
});
const builtins = new Set([
  "COUNT",
  "COUNTIF",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "SAFE_DIVIDE",
  "ROUND",
  "COALESCE",
  "IFNULL",
  "NULLIF",
  "IF",
  "CONCAT",
  "CAST",
  "SAFE_CAST",
  "DATE",
  "PARSE_DATE",
  "FORMAT_DATE",
  "DATE_TRUNC",
  "EXTRACT",
  "TIMESTAMP_MICROS",
  "TIMESTAMP_SECONDS",
  "DATE_DIFF",
  "DATE_ADD",
  "DATE_SUB",
  "LOWER",
  "UPPER",
  "TRIM",
  "REGEXP_EXTRACT",
  "ROW_NUMBER",
  "RANK",
  "DENSE_RANK",
  "LAG",
  "LEAD",
  "UNNEST",
  "ARRAY_AGG",
  "STRING_AGG",
  "ANY_VALUE",
  "APPROX_COUNT_DISTINCT",
  "ABS",
  "FLOOR",
  "CEIL",
  "STARTS_WITH",
  "ENDS_WITH",
  "REPLACE",
  "SUBSTR",
  "LENGTH",
]);

export function guardSql(sql: string): string {
  const source = sql.trim().replace(/;\s*$/, "");
  if (!source || source.length > 20000) {
    throw new ToolError("SQL must contain one bounded SELECT statement");
  }
  let parsed: unknown;
  try {
    parsed = parser.astify(source, { database: "BigQuery" });
  } catch {
    throw new ToolError(
      "Unsupported SQL syntax. Use a single BigQuery SELECT with canonical UNNEST patterns.",
    );
  }
  const statements = Array.isArray(parsed) ? parsed : [parsed];
  if (statements.length !== 1) {
    throw new ToolError("Only one SELECT statement is allowed");
  }
  const root = nodeSchema.parse(statements[0]);
  if (root["type"] !== "select") {
    throw new ToolError("Only SELECT statements are allowed");
  }
  const ctes = new Set<string>();
  const collectCtes = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(collectCtes);
      return;
    }
    const node = nodeSchema.safeParse(value);
    if (!node.success) {
      return;
    }
    const withNodes = node.data["with"];
    if (Array.isArray(withNodes)) {
      for (const entry of withNodes) {
        const cte = nodeSchema.parse(entry);
        const name = cte["name"];
        if (typeof name === "string") {
          ctes.add(name);
        } else {
          const named = nodeSchema.safeParse(name);
          if (named.success && typeof named.data["value"] === "string") {
            ctes.add(named.data["value"]);
          }
        }
      }
    }
    Object.values(node.data).forEach(collectCtes);
  };
  collectCtes(root);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = nodeSchema.safeParse(value);
    if (!node.success) {
      return;
    }
    const type = node.data["type"];
    if (
      typeof type === "string" &&
      ["insert", "update", "delete", "create", "drop", "alter", "call"].includes(type)
    ) {
      throw new ToolError("Only read-only SQL is allowed");
    }
    if (type === "function" || type === "aggr_func") {
      const name = node.data["name"];
      const parts: string[] = [];
      const collectNames = (v: unknown): void => {
        if (typeof v === "string") {
          parts.push(v);
        } else if (Array.isArray(v)) {
          v.forEach(collectNames);
        } else {
          const p = nodeSchema.safeParse(v);
          if (p.success) {
            for (const [key, part] of Object.entries(p.data)) {
              if (key !== "type") {
                collectNames(part);
              }
            }
          }
        }
      };
      collectNames(name);
      if (parts.length !== 1 || !builtins.has((parts[0] ?? "").toUpperCase())) {
        throw new ToolError("Only supported built-in SQL functions are allowed");
      }
    }
    if (
      "db" in node.data &&
      "table" in node.data &&
      typeof node.data["table"] === "string" &&
      type !== "column_ref"
    ) {
      const table = tableSchema.parse(node.data);
      const fullName = table.db ? `${table.db}.${table.table}` : table.table;
      if (
        typeof fullName !== "string" ||
        (!ctes.has(fullName) &&
          !new RegExp(
            `^bigquery-public-data\\.ga4_obfuscated_sample_ecommerce\\.events_(\\d{8}|\\*)$`,
          ).test(fullName))
      ) {
        throw new ToolError(`Only ${dataset}.events_* tables are allowed`);
      }
    }
    Object.values(node.data).forEach(visit);
  };
  visit(root);
  return source;
}
export interface DryRunAccess {
  statementType: string;
  tables: { projectId?: string; datasetId?: string; tableId?: string }[];
  routines: unknown[];
}
export function checkDryRun(metadata: DryRunAccess) {
  if (metadata.statementType !== "SELECT" || metadata.routines.length) {
    throw new ToolError("Dry run must be a SELECT without persistent routines");
  }
  for (const table of metadata.tables) {
    if (
      table.projectId !== "bigquery-public-data" ||
      table.datasetId !== "ga4_obfuscated_sample_ecommerce" ||
      !/^events_(\d{8}|\*)$/.test(table.tableId ?? "")
    ) {
      throw new ToolError("Dry run referenced a prohibited table");
    }
  }
}
