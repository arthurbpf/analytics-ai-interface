import { z } from "zod";
import { databaseConnection } from "./db/connection.ts";

const positiveInteger = z.coerce.number().int().positive();
export const limits = {
  modelCalls: 8,
  repairCalls: 2,
  reviewCalls: 2,
  totalModelCalls: 12,
  sqlCalls: 5,
  deadlineMs: 120000,
  outputTokens: 4096,
  contextBytes: 128 * 1024,
  rows: 500,
  columns: 32,
  resultBytes: 64 * 1024,
  charts: 4,
};
const envSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_MODEL: z.string().min(1),
  OPENROUTER_REVIEW_MODEL: z.string().min(1).optional(),
  OPENROUTER_TITLE_MODEL: z.string().min(1).default("anthropic/claude-haiku-4.5"),
  APP_ORIGIN: z.url().optional(),
  RAILWAY_PUBLIC_DOMAIN: z.string().min(1).optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  NODE_ENV: z.string().optional(),
  GOOGLE_CLOUD_PROJECT: z.string().min(1),
  HOST: z.string().min(1).default("127.0.0.1"),
  STATIC_DIR: z.string().optional(),
  PORT: positiveInteger.max(65535).default(3001),
  CATALOG_QUERY_MAX_BYTES: z.string().regex(/^\d+$/).default("2147483648"),
  QUERY_MAX_BYTES: z.string().regex(/^\d+$/).default("1073741824"),
  TURN_MAX_BYTES: z.string().regex(/^\d+$/).default("5368709120"),
});
/**
 * Parses and validates runtime configuration from the process environment.
 *
 * Fails fast on missing credentials, inconsistent byte budgets, or production settings
 * that would run without HTTPS or verified database TLS, so misconfiguration
 * surfaces at startup.
 *
 * @param env - Process environment to read.
 * @returns Validated configuration with parsed byte budgets and derived values.
 */
export function readConfig(env: NodeJS.ProcessEnv) {
  const value = envSchema.parse(env);
  const catalogQueryBytes = BigInt(value.CATALOG_QUERY_MAX_BYTES);
  const queryBytes = BigInt(value.QUERY_MAX_BYTES);
  const turnBytes = BigInt(value.TURN_MAX_BYTES);
  if (
    queryBytes <= 0n ||
    catalogQueryBytes <= 0n ||
    turnBytes < queryBytes ||
    turnBytes < catalogQueryBytes
  ) {
    throw new Error("Byte budgets must be positive; turn cap must be >= query cap");
  }
  const originValue =
    value.APP_ORIGIN ??
    (value.NODE_ENV === "production" && value.RAILWAY_PUBLIC_DOMAIN
      ? `https://${value.RAILWAY_PUBLIC_DOMAIN}`
      : "http://localhost:5173");
  const origin = new URL(originValue).origin;
  if (value.NODE_ENV === "production" && !origin.startsWith("https://")) {
    throw new Error("Production APP_ORIGIN must be configured with HTTPS");
  }
  if (Boolean(value.GOOGLE_CLIENT_ID) !== Boolean(value.GOOGLE_CLIENT_SECRET)) {
    throw new Error("Configure both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET");
  }
  return {
    origin,
    secureCookies: value.NODE_ENV === "production",
    googleClientId: value.GOOGLE_CLIENT_ID,
    googleClientSecret: value.GOOGLE_CLIENT_SECRET,
    titleModel: value.OPENROUTER_TITLE_MODEL,
    ...databaseConnection(env),
    apiKey: value.OPENROUTER_API_KEY,
    model: value.OPENROUTER_MODEL,
    reviewModel: value.OPENROUTER_REVIEW_MODEL ?? value.OPENROUTER_MODEL,
    projectId: value.GOOGLE_CLOUD_PROJECT,
    host: value.HOST,
    staticDir: value.STATIC_DIR,
    port: value.PORT,
    queryBytes,
    catalogQueryBytes,
    turnBytes,
  };
}
