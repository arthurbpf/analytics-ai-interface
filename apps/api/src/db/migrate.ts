import { migrate } from "drizzle-orm/node-postgres/migrator";
import { z } from "zod";
import { Store } from "./store.ts";
const url = z.string().min(1).parse(process.env["DATABASE_URL"]);
const store = new Store(url);
try {
  await migrate(store.db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
} finally {
  await store.pool.end();
}
