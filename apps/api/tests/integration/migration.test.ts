import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { z } from "zod";
import { expect, it } from "vitest";
import { Store } from "../../src/db/store.ts";
import { testStore } from "../fixtures/database.ts";
import { result } from "../fixtures/analysis.ts";
import { AuthStore } from "../../src/auth.ts";

it("migrates pre-auth chats without assigning an owner or losing content", async () => {
  const admin = await testStore();
  const name = `migration_${randomUUID().replaceAll("-", "")}_test`;
  const url = new URL(
    process.env["TEST_DATABASE_URL"] ?? "postgresql://localhost:5432/analytics_test",
  );
  url.pathname = `/${name}`;
  const folder = await mkdtemp(join(tmpdir(), "analytics-migrations-"));
  let store: Store | undefined;
  let created = false;
  try {
    await admin.pool.query(`CREATE DATABASE "${name}"`);
    created = true;
    store = new Store(url.toString());
    const migrations = new URL("../../drizzle/", import.meta.url).pathname;
    await mkdir(join(folder, "meta"));
    const raw: unknown = JSON.parse(await readFile(join(migrations, "meta/_journal.json"), "utf8"));
    const journal = z
      .object({
        version: z.string(),
        dialect: z.string(),
        entries: z.array(
          z.object({
            idx: z.number(),
            version: z.string(),
            when: z.number(),
            tag: z.string(),
            breakpoints: z.boolean(),
          }),
        ),
      })
      .parse(raw);
    await writeFile(
      join(folder, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, 1) }),
    );
    await cp(
      join(migrations, "0000_violet_gamma_corps.sql"),
      join(folder, "0000_violet_gamma_corps.sql"),
    );
    await migrate(store.db, { migrationsFolder: folder });
    const sessionId = randomUUID();
    const turnId = randomUUID();
    const messageId = randomUUID();
    await store.pool.query("INSERT INTO sessions (id) VALUES ($1)", [sessionId]);
    await store.pool.query(
      'INSERT INTO turns (id, "sessionId", "clientTurnId", status) VALUES ($1, $2, $3, $4)',
      [turnId, sessionId, randomUUID(), "failed"],
    );
    await store.pool.query(
      'INSERT INTO messages (id, "sessionId", "turnId", content) VALUES ($1, $2, $3, $4)',
      [
        messageId,
        sessionId,
        turnId,
        JSON.stringify({
          kind: "model",
          message: { role: "user", content: "Legacy private prompt" },
        }),
      ],
    );
    const savedResult = { ...result, ref: randomUUID() };
    await store.pool.query(
      'INSERT INTO query_results (ref, "sessionId", "turnId", data) VALUES ($1, $2, $3, $4)',
      [savedResult.ref, sessionId, turnId, JSON.stringify(savedResult)],
    );
    await migrate(store.db, { migrationsFolder: migrations });
    const guest = await new AuthStore(store).guest();
    expect(await store.listSessions(guest.identity.id)).toEqual([]);
    await expect(store.assertOwner(sessionId, guest.identity.id)).rejects.toMatchObject({
      status: 404,
    });
    const history = await store.history(sessionId);
    expect(history.messages[0]).toMatchObject({
      id: messageId,
      turnId,
      content: { kind: "user", text: "Legacy private prompt" },
    });
    expect(history.turns[0]?.id).toBe(turnId);
    expect(history.session.id).toBe(sessionId);
    expect(await store.result(sessionId, savedResult.ref)).toEqual(savedResult);
  } finally {
    if (store) {
      await store.pool.end();
    }
    if (created) {
      await admin.pool.query(`DROP DATABASE "${name}"`);
    }
    await admin.pool.end();
    await rm(folder, { recursive: true, force: true });
  }
});
