import type { ConnectionOptions } from "node:tls";
import { z } from "zod";

const databaseEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL_CA: z.string().min(1).optional(),
  NODE_ENV: z.string().optional(),
});

/**
 * Configures verified database TLS for production and optional local TLS.
 *
 * @param env - Environment containing the database URL and optional PEM CA.
 * @returns The connection URL and TLS options shared by the API and migrations.
 * @throws When URL TLS options could override certificate verification.
 */
export function databaseConnection(env: NodeJS.ProcessEnv): {
  databaseUrl: string;
  databaseSsl: ConnectionOptions | undefined;
} {
  const value = databaseEnvSchema.parse(env);
  if (value.NODE_ENV !== "production" && !value.DATABASE_SSL_CA) {
    return { databaseUrl: value.DATABASE_URL, databaseSsl: undefined };
  }
  const url = new URL(value.DATABASE_URL);
  for (const [key, option] of url.searchParams) {
    if (key.startsWith("ssl") && !(key === "sslmode" && option === "verify-full")) {
      throw new Error("Remove DATABASE_URL TLS options; use DATABASE_SSL_CA for a trusted PEM CA");
    }
  }
  // URL SSL options replace pg's explicit TLS configuration, including its CA.
  url.searchParams.delete("sslmode");
  return {
    databaseUrl: url.toString(),
    databaseSsl: {
      rejectUnauthorized: true,
      ...(value.DATABASE_SSL_CA ? { ca: value.DATABASE_SSL_CA } : {}),
    },
  };
}
