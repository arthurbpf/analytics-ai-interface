import { GoogleOAuth } from "./auth.ts";
import { OpenRouterTitles } from "./llm/titles.ts";
import { createApp } from "./app.ts";
import { readConfig } from "./config.ts";
import { Store } from "./db/store.ts";
import { OpenRouter } from "./llm/openrouter.ts";
import { BigQueryWarehouse } from "./analytics/bigquery.ts";

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
});
const server = app.listen(config.port, "127.0.0.1", () => {
  console.info(`API listening at http://127.0.0.1:${config.port}`);
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
