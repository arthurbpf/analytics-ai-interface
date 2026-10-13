import { migrate } from "drizzle-orm/node-postgres/migrator";
import { databaseConnection } from "./connection.ts";
import { Store } from "./store.ts";
const config = databaseConnection(process.env);
const store = new Store(config.databaseUrl, config.databaseSsl);
try {
  await migrate(store.db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
} finally {
  await store.pool.end();
}
