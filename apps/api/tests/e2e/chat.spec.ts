import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { historySchema } from "@analytics/contracts";

const narrative = "Desktop has 12 purchase events; mobile has 3.";
test("chat streams charts and draft text, replaces the draft, reloads, and follows up", async ({
  page,
  request,
}) => {
  let turnRequests = 0;
  let resultRequests = 0;
  page.on("request", (entry) => {
    if (entry.method() === "POST" && entry.url().endsWith("/turns")) {
      turnRequests++;
    }
    if (entry.url().includes("/results/")) {
      resultRequests++;
    }
  });
  await page.goto("/");
  const composer = page.getByLabel("Ask an analytics question");
  await composer.fill("Compare purchases by device");
  await composer.press("Enter");
  await expect(page.getByTestId("chart-bar")).toBeVisible();
  await expect(page.getByTestId("narrative-draft")).toContainText("Desktop");
  await expect(page.getByText(narrative, { exact: true })).toBeVisible();
  await expect(page.getByTestId("narrative-draft")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  const sessionId = new URL(page.url()).searchParams.get("session");
  expect(sessionId).toBeTruthy();
  const raw: unknown = await (await request.get(`/api/sessions/${sessionId}`)).json();
  expect(historySchema.parse(raw).turns[0]?.status).toBe("completed");
  await page.reload();
  await expect(page.getByText(narrative, { exact: true })).toBeVisible();
  await expect(page.getByTestId("chart-bar")).toHaveCount(1);
  await composer.fill("Show that weekly");
  await composer.press("Enter");
  await expect(page.getByTestId("chart-bar")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  expect(turnRequests).toBe(2);
  expect(resultRequests).toBe(0);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.getByRole("button", { name: "Compare purchases by device", exact: true }).click();
  await expect(page.getByTestId("chart-bar")).toHaveCount(2);
});
test("session switching keeps a response alive, blocks another send, and Stop retains charts", async ({
  page,
}) => {
  let turns = 0;
  page.on("request", (entry) => {
    if (entry.method() === "POST" && entry.url().endsWith("/turns")) {
      turns++;
    }
  });
  await page.goto("/");
  await page.getByLabel("Ask an analytics question").fill("Hold this analysis");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByTestId("narrative-draft")).toContainText("Desktop");
  const sessionUrl = page.url();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.getByLabel("Ask an analytics question").fill("Another question");
  await expect(page.getByRole("button", { name: "Send question" })).toBeDisabled();
  await page.getByRole("button", { name: "Hold this analysis", exact: true }).click();
  await expect(page.getByTestId("narrative-draft")).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByTestId("narrative-draft")).toHaveCount(0);
  await expect(page.getByTestId("chart-bar")).toBeVisible();
  await expect(page.getByText(/Analysis interrupted; saved artifacts/)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("chart-bar")).toBeVisible();
  expect(page.url()).toBe(sessionUrl);
  expect(turns).toBe(1);
});
test("a rejected draft is removed and a repaired presentation completes", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Ask an analytics question").fill("Repair this analysis");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByTestId("narrative-draft")).toContainText("Rejected draft");
  await expect(page.getByText(narrative, { exact: true })).toBeVisible();
  await expect(page.getByTestId("narrative-draft")).toHaveCount(0);
  await expect(page.getByText(/Rejected draft/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(narrative, { exact: true })).toBeVisible();
  await expect(page.getByText(/Rejected draft/)).toHaveCount(0);
});
test("failed generation clears draft text and preserves published charts", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Ask an analytics question").fill("Fail this analysis");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByTestId("narrative-draft")).toBeVisible();
  await expect(page.getByTestId("narrative-draft")).toHaveCount(0);
  await expect(page.getByTestId("chart-bar")).toBeVisible();
  await expect(page.getByText(narrative, { exact: true })).toHaveCount(0);
});
for (const [prompt, type] of [
  ["Show a line chart", "line"],
  ["Show a stacked chart", "stacked_bar"],
  ["Show a table", "table"],
  ["Show a KPI", "kpi"],
]) {
  test(`production UI renders ${type}`, async ({ page }) => {
    if (!prompt || !type) {
      throw new Error("Missing chart scenario");
    }
    await page.goto("/");
    await page.getByLabel("Ask an analytics question").fill(prompt);
    await page.getByRole("button", { name: "Send question" }).click();
    await expect(page.getByTestId(`chart-${type}`)).toBeVisible();
    await expect(page.getByText(narrative, { exact: true })).toBeVisible();
    await expect(page.getByTestId("narrative-draft")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
    if (type === "table") {
      await expect(page.getByRole("columnheader", { name: "device", exact: true })).toBeVisible();
    }
    if (type === "kpi") {
      await expect(page.getByTestId("chart-kpi")).toContainText("12");
    }
  });
}
test("mobile sidebar, keyboard composer, input limits, and safe text", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const composer = page.getByLabel("Ask an analytics question");
  await composer.fill("   ");
  await expect(page.getByRole("button", { name: "Send question" })).toBeDisabled();
  await composer.fill("x".repeat(8001));
  await expect(page.getByRole("button", { name: "Send question" })).toBeDisabled();
  await composer.fill('<img src=x onerror="alert(1)">');
  await composer.press("Shift+Enter");
  await expect(composer).toHaveValue('<img src=x onerror="alert(1)">\n');
  await composer.press("Enter");
  await expect(page.getByText(narrative, { exact: true })).toBeVisible();
  await expect(page.getByTestId("narrative-draft")).toHaveCount(0);
  expect(await page.locator("img").count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test("invalid URLs, missing sessions, and corrupt storage remain usable", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("analytics.sessions.v1", '{"version":9}');
  });
  await page.goto("/?session=invalid");
  await expect(page.getByRole("heading", { name: "Explore your ecommerce data." })).toBeVisible();
  await page.goto(`/?session=${randomUUID()}`);
  await expect(page.getByText("Session not found")).toBeVisible();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Explore your ecommerce data." })).toBeVisible();
});
