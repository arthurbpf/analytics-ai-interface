import { z } from "zod";

const positiveInteger = z.coerce.number().int().positive();
export const limits = {
  modelCalls: 8, sqlCalls: 5, deadlineMs: 120000, outputTokens: 4096,
  contextBytes: 128 * 1024, rows: 500, columns: 32, resultBytes: 64 * 1024, charts: 4,
};
const envSchema = z.object({
  DATABASE_URL: z.string().min(1), OPENROUTER_API_KEY: z.string().min(1), OPENROUTER_MODEL: z.string().min(1),
  GOOGLE_CLOUD_PROJECT: z.string().min(1), PORT: positiveInteger.max(65535).default(3001),
  QUERY_MAX_BYTES: z.string().regex(/^\d+$/).default("1073741824"),
  TURN_MAX_BYTES: z.string().regex(/^\d+$/).default("5368709120"),
});
export function readConfig(env: NodeJS.ProcessEnv) {
  const value = envSchema.parse(env);
  const queryBytes = BigInt(value.QUERY_MAX_BYTES);
  const turnBytes = BigInt(value.TURN_MAX_BYTES);
  if (queryBytes <= 0n || turnBytes < queryBytes) { throw new Error("Byte budgets must be positive; turn cap must be >= query cap"); }
  return { databaseUrl: value.DATABASE_URL, apiKey: value.OPENROUTER_API_KEY, model: value.OPENROUTER_MODEL,
    projectId: value.GOOGLE_CLOUD_PROJECT, port: value.PORT, queryBytes, turnBytes };
}
