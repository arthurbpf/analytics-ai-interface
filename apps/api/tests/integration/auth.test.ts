import { setTimeout } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { identitySchema, sessionSchema, historySchema } from "@analytics/contracts";
import { createApp } from "../../src/app.ts";
import { AuthStore, hashToken, type GoogleLogin } from "../../src/auth.ts";
import { authSessions, oauthAttempts, sessions, users } from "../../src/db/schema.ts";
import type { Store } from "../../src/db/store.ts";
import { testStore } from "../fixtures/database.ts";
import { fixtureModel, fixtureReviewer, fixtureWarehouse, result } from "../fixtures/analysis.ts";

let store: Store;
let backend: ReturnType<typeof createApp>;
let server: ReturnType<typeof backend.app.listen>;
let base: string;
const origin = "http://localhost:5173";
const userIds = new Set<string>();
const legacyIds: string[] = [];
const attempts = new Set<string>();
const verifiers = new Map<string, string>();
const subject = randomUUID();
const otherSubject = randomUUID();
let releaseTitle: (() => void) | undefined;
const delayedTitle = new Promise<void>((resolve) => {
  releaseTitle = resolve;
});
const titles = {
  complete: vi.fn(async (prompts: string[]) => {
    if (prompts[0] === "Delayed title") {
      await delayedTitle;
    }
    return { title: "Generated summary", usage: { inputTokens: 2, outputTokens: 3, cost: 0.001 } };
  }),
};
const google: GoogleLogin = {
  authorization: vi.fn(async (state: string, nonce: string) => {
    const verifier = randomUUID();
    verifiers.set(verifier, nonce);
    return { url: `https://accounts.example.test/?state=${state}`, verifier };
  }),
  verify: vi.fn(async (code: string, verifier: string, nonce: string) => {
    if (!["valid", "valid-other"].includes(code) || verifiers.get(verifier) !== nonce) {
      throw new Error("Invalid ID token");
    }
    return {
      subject: code === "valid-other" ? otherSubject : subject,
      name: "Test Person",
      email: "test@example.test",
    };
  }),
};
class Browser {
  readonly cookies = new Map<string, string>();
  async request(
    path: string,
    method = "GET",
    body?: unknown,
    requestOrigin: string | null = origin,
  ) {
    const headers: Record<string, string> = {
      Cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "),
    };
    if (requestOrigin) {
      headers["Origin"] = requestOrigin;
    }
    if (body) {
      headers["Content-Type"] = "application/json";
    }
    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      redirect: "manual",
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0];
      const index = pair?.indexOf("=") ?? -1;
      if (pair && index >= 0) {
        const name = pair.slice(0, index);
        const value = pair.slice(index + 1);
        if (value) {
          this.cookies.set(name, value);
        } else {
          this.cookies.delete(name);
        }
        if (name === "analytics_oauth" && value) {
          attempts.add(hashToken(value));
        }
      }
    }
    return response;
  }
  async guest() {
    const response = await this.request("/api/auth/guest", "POST");
    expect(response.status).toBe(201);
    const raw: unknown = await response.json();
    const identity = identitySchema.parse(raw);
    userIds.add(identity.id);
    return identity;
  }
  async create() {
    const response = await this.request("/api/sessions", "POST");
    expect(response.status).toBe(201);
    const raw: unknown = await response.json();
    return sessionSchema.parse(raw);
  }
  async login(code = "valid", overrideState?: string) {
    const begin = await this.request("/api/auth/google");
    expect(begin.status).toBe(302);
    const state = new URL(begin.headers.get("location") ?? "").searchParams.get("state");
    const response = await this.request(
      `/api/auth/google/callback?code=${code}&state=${overrideState ?? state}`,
    );
    const current: unknown = await (await this.request("/api/auth/me")).json();
    const parsed = identitySchema
      .nullable()
      .parse(
        typeof current === "object" && current !== null && "identity" in current
          ? current.identity
          : null,
      );
    if (parsed) {
      userIds.add(parsed.id);
    }
    return { response, identity: parsed };
  }
}
beforeAll(async () => {
  store = await testStore();
  backend = createApp({
    reviewer: fixtureReviewer(),
    store,
    google,
    origin,
    secureCookies: true,
    titles,
    model: {
      complete: async (...args) => {
        if (
          args[1].some((message) => message.role === "user" && message.content === "Pause logout")
        ) {
          await setTimeout(60000, undefined, { signal: args[3] });
        }
        return fixtureModel().complete(...args);
      },
    },
    warehouse: fixtureWarehouse(),
    queryBytes: 100n,
    turnBytes: 500n,
  });
  server = backend.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Missing server address");
  }
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  if (backend) {
    await backend.shutdown();
  }
  if (server) {
    server.close();
    server.closeAllConnections();
  }
  if (store) {
    if (legacyIds.length) {
      await store.db.delete(sessions).where(inArray(sessions.id, legacyIds));
    }
    if (userIds.size) {
      await store.db.delete(sessions).where(inArray(sessions.ownerId, [...userIds]));
      await store.db.delete(authSessions).where(inArray(authSessions.userId, [...userIds]));
      await store.db.delete(users).where(inArray(users.id, [...userIds]));
    }
    if (attempts.size) {
      await store.db.delete(oauthAttempts).where(inArray(oauthAttempts.tokenHash, [...attempts]));
    }
    await store.pool.end();
  }
});
it("requires authentication on every chat endpoint", async () => {
  const browser = new Browser();
  const id = randomUUID();
  for (const [path, method, body] of [
    ["/api/sessions", "GET", undefined],
    ["/api/sessions", "POST", undefined],
    [`/api/sessions/${id}`, "GET", undefined],
    [`/api/sessions/${id}/results/${randomUUID()}`, "GET", undefined],
    [`/api/sessions/${id}/turns`, "POST", { message: "Private", clientTurnId: randomUUID() }],
  ] satisfies [string, string, unknown][]) {
    expect((await browser.request(path, method, body)).status).toBe(401);
  }
});
it("keeps guest chats private across cookies and rejects all cross-identity access", async () => {
  const owner = new Browser();
  const other = new Browser();
  await owner.guest();
  await other.guest();
  const session = await owner.create();
  const turn = await store.startTurn(session.id, randomUUID(), "Private prompt");
  const data = { ...result, ref: randomUUID() };
  await store.saveResult(session.id, turn.id, data);
  await store.finish(turn.id, "failed", null);
  expect((await owner.request(`/api/sessions/${session.id}`)).status).toBe(200);
  expect((await owner.request(`/api/sessions/${session.id}/results/${data.ref}`)).status).toBe(200);
  for (const [path, method, body] of [
    [`/api/sessions/${session.id}`, "GET", undefined],
    [`/api/sessions/${session.id}/results/${data.ref}`, "GET", undefined],
    [
      `/api/sessions/${session.id}/turns`,
      "POST",
      { message: "Intrusion", clientTurnId: randomUUID() },
    ],
  ] satisfies [string, string, unknown][]) {
    const response = await other.request(path, method, body);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("Private prompt");
  }
  expect(await (await other.request("/api/sessions")).json()).toEqual([]);
  const reopened = new Browser();
  reopened.cookies.set("analytics_auth", owner.cookies.get("analytics_auth") ?? "");
  const listed: unknown = await (await reopened.request("/api/sessions")).json();
  expect(
    sessionSchema
      .array()
      .parse(listed)
      .map((entry) => entry.id),
  ).toEqual([session.id]);
  const stored = await store.db
    .select()
    .from(authSessions)
    .where(eq(authSessions.tokenHash, hashToken(owner.cookies.get("analytics_auth") ?? "")));
  expect(stored[0]?.tokenHash).not.toBe(owner.cookies.get("analytics_auth"));
});
it("enforces same-origin mutation checks and persistent secure cookie attributes", async () => {
  const browser = new Browser();
  expect(
    (await browser.request("/api/auth/guest", "POST", undefined, "https://evil.test")).status,
  ).toBe(403);
  expect((await browser.request("/api/auth/guest", "POST", undefined, null)).status).toBe(403);
  const response = await browser.request("/api/auth/guest", "POST");
  const raw: unknown = await response.json();
  userIds.add(identitySchema.parse(raw).id);
  expect(response.headers.get("set-cookie")).toContain("Secure");
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
  expect(response.headers.get("set-cookie")).toContain("Max-Age=2592000");
  expect(
    (await browser.request("/api/sessions", "POST", undefined, "https://evil.test")).status,
  ).toBe(403);
});
it("rejects expired and revoked credentials, and logout clears the cookie", async () => {
  const expired = new Browser();
  await expired.guest();
  await store.db
    .update(authSessions)
    .set({ expiresAt: new Date(Date.now() - 1) })
    .where(eq(authSessions.tokenHash, hashToken(expired.cookies.get("analytics_auth") ?? "")));
  expect((await expired.request("/api/sessions")).status).toBe(401);
  const browser = new Browser();
  await browser.guest();
  const token = browser.cookies.get("analytics_auth");
  expect((await browser.request("/api/auth/logout", "POST")).status).toBe(200);
  expect(browser.cookies.has("analytics_auth")).toBe(false);
  browser.cookies.set("analytics_auth", token ?? "");
  expect((await browser.request("/api/sessions")).status).toBe(401);
});
it("preserves guest access on failed callbacks, state mismatch, expired attempts and callback replay", async () => {
  const browser = new Browser();
  const guest = await browser.guest();
  const session = await browser.create();
  for (const [code, state] of [
    ["invalid", undefined],
    ["valid", "wrong-state"],
  ]) {
    const outcome = await browser.login(code, state);
    expect(outcome.response.headers.get("location")).toContain("login=failed");
    expect(outcome.identity?.id).toBe(guest.id);
    expect((await browser.request(`/api/sessions/${session.id}`)).status).toBe(200);
  }
  const begin = await browser.request("/api/auth/google");
  const state = new URL(begin.headers.get("location") ?? "").searchParams.get("state");
  await store.db
    .update(oauthAttempts)
    .set({ expiresAt: new Date(Date.now() - 1) })
    .where(eq(oauthAttempts.tokenHash, hashToken(browser.cookies.get("analytics_oauth") ?? "")));
  const path = `/api/auth/google/callback?code=valid&state=${state}`;
  expect((await browser.request(path)).headers.get("location")).toContain("login=failed");
  expect((await browser.request(path)).headers.get("location")).toContain("login=failed");
  expect((await browser.request(`/api/sessions/${session.id}`)).status).toBe(200);
});
it("transfers all guest artifacts into a new or existing Google account and revokes guest credentials", async () => {
  const first = new Browser();
  const guest = await first.guest();
  const session = await first.create();
  const turn = await store.startTurn(session.id, randomUUID(), "Keep my analysis");
  const data = { ...result, ref: randomUUID() };
  await store.saveResult(session.id, turn.id, data);
  await store.finishTitle(session.id, 1, "Saved title", {
    inputTokens: 2,
    outputTokens: 3,
    cost: 0.001,
  });
  await store.finish(turn.id, "failed", null);
  const oldToken = first.cookies.get("analytics_auth");
  const extra = new AuthStore(store);
  // Multiple credentials belonging to the guest must all be revoked.
  const secondGuestToken = randomUUID();
  await store.db.insert(authSessions).values({
    tokenHash: hashToken(secondGuestToken),
    userId: guest.id,
    expiresAt: new Date(Date.now() + 100000),
  });
  const account = await first.login();
  expect(account.identity?.kind).toBe("google");
  expect(account.identity?.id).not.toBe(guest.id);
  expect(await extra.authenticate(oldToken)).toBeNull();
  expect(await extra.authenticate(secondGuestToken)).toBeNull();
  const raw: unknown = await (await first.request(`/api/sessions/${session.id}`)).json();
  const history = historySchema.parse(raw);
  expect(history.session.title).toBe("Saved title");
  expect(history.messages[0]?.content).toEqual({ kind: "user", text: "Keep my analysis" });
  expect((await first.request(`/api/sessions/${session.id}/results/${data.ref}`)).status).toBe(200);
  const second = new Browser();
  await second.guest();
  const another = await second.create();
  const existing = await second.login();
  expect(existing.identity?.id).toBe(account.identity?.id);
  const listed: unknown = await (await second.request("/api/sessions")).json();
  expect(
    sessionSchema
      .array()
      .parse(listed)
      .map((entry) => entry.id),
  ).toEqual(expect.arrayContaining([session.id, another.id]));
  expect(sessionSchema.array().parse(listed)).toHaveLength(2);
  // Both authenticated browsers see the same account list.
  expect(await (await first.request("/api/sessions")).json()).toEqual(listed);
});
it("keeps legacy unowned chats inaccessible without destroying their contents", async () => {
  const legacy = await store.createSession();
  legacyIds.push(legacy.id);
  const turn = await store.startTurn(legacy.id, randomUUID(), "Legacy confidential data");
  await store.finish(turn.id, "failed", null);
  const browser = new Browser();
  await browser.guest();
  expect((await browser.request(`/api/sessions/${legacy.id}`)).status).toBe(404);
  expect(await (await browser.request("/api/sessions")).json()).toEqual([]);
  const history = await store.history(legacy.id);
  expect(history.messages[0]?.content).toEqual({ kind: "user", text: "Legacy confidential data" });
});

it("isolates two Google accounts even when their emails match", async () => {
  const owner = new Browser();
  const other = new Browser();
  const one = await owner.login();
  const two = await other.login("valid-other");
  expect(one.identity?.id).not.toBe(two.identity?.id);
  const session = await owner.create();
  const turn = await store.startTurn(session.id, randomUUID(), "Account private prompt");
  const data = { ...result, ref: randomUUID() };
  await store.saveResult(session.id, turn.id, data);
  await store.finish(turn.id, "failed", null);
  const list: unknown = await (await other.request("/api/sessions")).json();
  expect(
    sessionSchema
      .array()
      .parse(list)
      .some((entry) => entry.id === session.id),
  ).toBe(false);
  expect((await other.request(`/api/sessions/${session.id}`)).status).toBe(404);
  expect((await other.request(`/api/sessions/${session.id}/results/${data.ref}`)).status).toBe(404);
  expect(
    (
      await other.request(`/api/sessions/${session.id}/turns`, "POST", {
        message: "Intrusion",
        clientTurnId: randomUUID(),
      })
    ).status,
  ).toBe(404);
});
it("rejects a callback bound to a different guest's credential", async () => {
  const owner = new Browser();
  const other = new Browser();
  await owner.guest();
  const otherIdentity = await other.guest();
  const session = await owner.create();
  const begin = await owner.request("/api/auth/google");
  const state = new URL(begin.headers.get("location") ?? "").searchParams.get("state");
  other.cookies.set("analytics_oauth", owner.cookies.get("analytics_oauth") ?? "");
  const callback = await other.request(`/api/auth/google/callback?code=valid&state=${state}`);
  expect(callback.headers.get("location")).toContain("login=failed");
  const current: unknown = await (await other.request("/api/auth/me")).json();
  expect(current).toMatchObject({ identity: otherIdentity });
  expect((await owner.request(`/api/sessions/${session.id}`)).status).toBe(200);
  expect((await other.request(`/api/sessions/${session.id}`)).status).toBe(404);
});
it("generates titles independently of analytics, with exactly two calls at prompts 1 and 3", async () => {
  const browser = new Browser();
  await browser.guest();
  const session = await browser.create();
  const before = titles.complete.mock.calls.length;
  const firstId = randomUUID();
  const first = await browser.request(`/api/sessions/${session.id}/turns`, "POST", {
    message: "Delayed title",
    clientTurnId: firstId,
  });
  expect(first.status).toBe(200);
  expect(await first.text()).toContain('"type":"turn_finished"');
  expect((await store.history(session.id)).session.titleStatus).toBe("pending");
  expect(
    (
      await browser.request(`/api/sessions/${session.id}/turns`, "POST", {
        message: "Retry",
        clientTurnId: firstId,
      })
    ).status,
  ).toBe(409);
  releaseTitle?.();
  await vi.waitFor(async () =>
    expect((await store.history(session.id)).session.title).toBe("Generated summary"),
  );
  for (const message of ["Second", "Third"]) {
    const response = await browser.request(`/api/sessions/${session.id}/turns`, "POST", {
      message,
      clientTurnId: randomUUID(),
    });
    expect(response.status).toBe(200);
    await response.text();
  }
  await vi.waitFor(() => expect(titles.complete.mock.calls.length - before).toBe(2));
  expect(titles.complete.mock.calls.at(-1)?.[0]).toEqual(["Delayed title", "Second", "Third"]);
});
it("logout interrupts that credential's stream and preserves saved prompts", async () => {
  const browser = new Browser();
  await browser.guest();
  const session = await browser.create();
  const response = await browser.request(`/api/sessions/${session.id}/turns`, "POST", {
    message: "Pause logout",
    clientTurnId: randomUUID(),
  });
  if (!response.body) {
    throw new Error("Missing stream");
  }
  const reader = response.body.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain("turn_started");
  expect((await browser.request("/api/auth/logout", "POST")).status).toBe(200);
  while (!(await reader.read()).done) {
    /* Drain the closed stream. */
  }
  reader.releaseLock();
  expect((await store.history(session.id)).turns[0]?.status).toBe("interrupted");
  expect((await browser.request(`/api/sessions/${session.id}`)).status).toBe(401);
});
