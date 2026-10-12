import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { z } from "zod";
import { historySchema, sessionSchema, streamEventSchema } from "@analytics/contracts";

test.beforeEach(async ({ request, page }) => {
  expect((await request.post("/api/auth/guest")).status()).toBe(201);
  await page.context().addCookies((await request.storageState()).cookies);
});

test("API rejects invalid requests before opening a stream", async ({ request }) => {
  const sessionResponse = await request.post("/api/sessions");
  const raw: unknown = await sessionResponse.json();
  const session = sessionSchema.parse(raw);
  expect(sessionResponse.status()).toBe(201);
  const invalid = await request.post(`/api/sessions/${session.id}/turns`, {
    data: { message: "", clientTurnId: randomUUID() },
  });
  expect(invalid.status()).toBe(400);
  expect(invalid.headers()["content-type"]).toContain("application/json");
  expect((await request.get(`/api/sessions/${randomUUID()}`)).status()).toBe(404);
  expect(
    (
      await request.post(`/api/sessions/${randomUUID()}/turns`, {
        data: { message: "Hello", clientTurnId: randomUUID() },
      })
    ).status(),
  ).toBe(404);
});
test("browser interrupts review and reloads without candidate output or paid replay", async ({
  page,
  request,
}) => {
  const raw: unknown = await (await request.post("/api/sessions")).json();
  const session = sessionSchema.parse(raw);
  await page.goto("/");
  const modulePath = new URL("../fixtures/browser.ts", import.meta.url).pathname;
  const clientTurnId = randomUUID();
  const rawEvents: unknown = await page.evaluate(
    async ({ path, sessionId, requestId }) => {
      const browserModule: unknown = await import(`/@fs${path}`);
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- Playwright serializes this callback and its helper together.
      function isHelper(
        value: unknown,
      ): value is (sessionId: string, requestId: string) => Promise<unknown> {
        return typeof value === "function";
      }
      // Browser-side import stays outside production UI; narrow its exported function.
      if (
        typeof browserModule !== "object" ||
        browserModule === null ||
        !("interruptReview" in browserModule) ||
        !isHelper(browserModule.interruptReview)
      ) {
        throw new Error("Missing browser test helper");
      }
      const output: unknown = await browserModule.interruptReview(sessionId, requestId);
      return output;
    },
    { path: modulePath, sessionId: session.id, requestId: clientTurnId },
  );
  const events = z.array(streamEventSchema).parse(rawEvents);
  expect(events.some((event) => event.type === "chart_ready")).toBe(false);
  expect(events.some((event) => event.type === "analysis_ready")).toBe(false);
  await expect
    .poll(async () => {
      const data: unknown = await (await request.get(`/api/sessions/${session.id}`)).json();
      return historySchema.parse(data).turns[0]?.status;
    })
    .toBe("interrupted");
  await page.reload();
  const historyRaw: unknown = await (await request.get(`/api/sessions/${session.id}`)).json();
  const history = historySchema.parse(historyRaw);
  expect(history.messages.map((message) => message.content.kind)).toEqual(["user"]);
  const retry = await request.post(`/api/sessions/${session.id}/turns`, {
    data: { message: "Retry", clientTurnId },
  });
  expect(retry.status()).toBe(409);
});
