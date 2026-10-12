import { setTimeout } from "node:timers/promises";
import { createApp } from "../../src/app.ts";
import { testStore } from "./database.ts";
import { fixtureModel, fixtureWarehouse } from "./analysis.ts";

const store = await testStore();
await store.recover();
const model = fixtureModel(async (signal) => { await setTimeout(60000, undefined, { signal }); });
const backend = createApp({ store, model, warehouse: fixtureWarehouse(), queryBytes: 100n, turnBytes: 500n });
const server = backend.app.listen(3101, "127.0.0.1");
const finish = async () => { server.close(); await backend.shutdown(); await store.pool.end(); server.closeAllConnections(); };
const stop = () => {
  const task = finish(); task.then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; });
};
process.once("SIGTERM", stop); process.once("SIGINT", stop);
