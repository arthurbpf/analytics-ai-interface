import { expect, it } from "vitest";
import { readConfig } from "./config.ts";

const env = {
  DATABASE_URL: "postgresql://user:password@database.example/analytics?application_name=api",
  OPENROUTER_API_KEY: "test",
  OPENROUTER_MODEL: "test",
  GOOGLE_CLOUD_PROJECT: "test",
  NODE_ENV: "production",
  APP_ORIGIN: "https://app.example",
};

it("requires verified TLS in production and preserves other connection settings", () => {
  const config = readConfig(env);
  expect(config.databaseUrl).toBe(env.DATABASE_URL);
  expect(config.databaseSsl).toEqual({ rejectUnauthorized: true });
});

it("uses the configured PEM CA without disabling hostname verification", () => {
  const config = readConfig({ ...env, DATABASE_SSL_CA: "trusted PEM certificate" });
  expect(config.databaseSsl).toEqual({ rejectUnauthorized: true, ca: "trusted PEM certificate" });
});

it.each([
  "sslmode=no-verify",
  "sslmode=disable",
  "sslmode=require",
  "sslmode=verify-ca",
  "ssl=false",
  "ssl=true",
  "ssl=%7B%22rejectUnauthorized%22%3Afalse%7D",
  "sslrootcert=/tmp/ca.pem",
  "sslcert=/tmp/client.pem",
  "sslkey=/tmp/client.key",
  "sslmode=verify-full&sslmode=no-verify",
])("rejects production URL TLS overrides: %s", (query) => {
  expect(() => readConfig({ ...env, DATABASE_URL: `${env.DATABASE_URL}&${query}` })).toThrow(
    "DATABASE_SSL_CA",
  );
});

it("accepts verify-full and removes it so it cannot override the configured CA", () => {
  const config = readConfig({
    ...env,
    DATABASE_URL: `${env.DATABASE_URL}&sslmode=verify-full`,
    DATABASE_SSL_CA: "trusted PEM certificate",
  });
  expect(config.databaseUrl).toBe(env.DATABASE_URL);
  expect(config.databaseSsl).toEqual({ rejectUnauthorized: true, ca: "trusted PEM certificate" });
});

it("keeps local development connections unchanged", () => {
  const config = readConfig({ ...env, NODE_ENV: "development" });
  expect(config.databaseUrl).toBe(env.DATABASE_URL);
  expect(config.databaseSsl).toBeUndefined();
});

it("enables verified TLS locally when a CA is configured", () => {
  const config = readConfig({
    ...env,
    NODE_ENV: "development",
    DATABASE_SSL_CA: "trusted PEM certificate",
  });
  expect(config.databaseSsl).toEqual({ rejectUnauthorized: true, ca: "trusted PEM certificate" });
});
