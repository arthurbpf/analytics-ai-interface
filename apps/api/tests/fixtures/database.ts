import { z } from "zod";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Store } from "../../src/db/store.ts";

export async function testStore() {
  const url = z.string().url().parse(process.env["TEST_DATABASE_URL"] ?? "postgresql://localhost:5432/analytics_test");
  if (!new URL(url).pathname.endsWith("_test")) { throw new Error("TEST_DATABASE_URL must name a database ending in _test"); }
  const store = new Store(url);
  try { await migrate(store.db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname }); }
  catch (error) { await store.pool.end(); throw error; }
  return store;
}
