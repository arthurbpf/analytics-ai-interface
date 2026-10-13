import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoogleOAuth } from "./auth.ts";
import { OpenRouterTitles } from "./llm/titles.ts";
import { createApp } from "./app.ts";
import { readConfig } from "./config.ts";
import { Store } from "./db/store.ts";
import { OpenRouter } from "./llm/openrouter.ts";
import { BigQueryWarehouse } from "./analytics/bigquery.ts";

// Railway cannot mount a secret as a file, so the GCP service-account JSON is
// provided as an environment variable and materialized here before the BigQuery
// client reads GOOGLE_APPLICATION_CREDENTIALS.
const serviceAccountJson = process.env["GOOGLE_APPLICATION_CREDENTIALS_JSON"];
if (serviceAccountJson && !process.env["GOOGLE_APPLICATION_CREDENTIALS"]) {
  const credentialsPath = join(tmpdir(), "gcp-service-account.json");
  writeFileSync(credentialsPath, serviceAccountJson, { mode: 0o600 });
  process.env["GOOGLE_APPLICATION_CREDENTIALS"] = credentialsPath;
}

const config = readConfig(process.env);
const store = new Store(config.databaseUrl);
await store.recover();
const { app, shutdown } = createApp({
  store,
  origin: config.origin,
  secureCookies: config.secureCookies,
  google:
    config.googleClientId && config.googleClientSecret
      ? new GoogleOAuth(
          config.googleClientId,
          config.googleClientSecret,
          `${config.origin}/api/auth/google/callback`,
        )
      : undefined,
  titles: new OpenRouterTitles(config.apiKey, config.titleModel),
  model: new OpenRouter(config.apiKey, config.model),
  reviewer: {
    model: new OpenRouter(config.apiKey, config.reviewModel),
    modelName: config.reviewModel,
  },
  warehouse: new BigQueryWarehouse(config.projectId),
  queryBytes: config.queryBytes,
  catalogQueryBytes: config.catalogQueryBytes,
  turnBytes: config.turnBytes,
  staticDir: config.staticDir,
});
const server = app.listen(config.port, config.host, () => {
  console.info(`API listening at http://${config.host}:${config.port}`);
});
let closing = false;
const cleanup = async () => {
  server.close();
  await shutdown();
  await store.pool.end();
  server.closeAllConnections();
};
const stop = () => {
  if (closing) {
    return;
  }
  closing = true;
  const task = cleanup();
  task.then(
    () => {
      process.exitCode = 0;
    },
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
