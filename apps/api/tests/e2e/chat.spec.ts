import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { historySchema } from "@analytics/contracts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page.getByLabel("Ask an analytics question")).toBeVisible();
});

const narrative = "Desktop has 12 purchase events; mobile has 3.";
test("chat publishes approved charts and answer, reloads, and follows up", async ({ page }) => {
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
  await expect(page.getByText(narrative, { exact: true })).toBeVisible();
  await expect(page.getByTestId("narrative-draft")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  const sessionId = new URL(page.url()).searchParams.get("session");
  expect(sessionId).toBeTruthy();
  const raw: unknown = await (await page.request.get(`/api/sessions/${sessionId}`)).json();
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
test("session switching permits a second response and Stop keeps candidates private", async ({
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
  await expect(page.getByText("Checking the analysis", { exact: true })).toBeVisible();
  await expect(page.getByTestId("chart-bar")).toHaveCount(0);
  const sessionUrl = page.url();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.getByLabel("Ask an analytics question").fill("Another question");
  await expect(page.getByRole("button", { name: "Send question" })).toBeEnabled();
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByText(narrative, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Hold this analysis", exact: true }).click();
  await expect(page.getByText("Checking the analysis", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByTestId("narrative-draft")).toHaveCount(0);
  await expect(page.getByTestId("chart-bar")).toHaveCount(0);
  await expect(page.getByText(/Analysis interrupted; saved artifacts/)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("chart-bar")).toHaveCount(0);
  expect(page.url()).toBe(sessionUrl);
  expect(turns).toBe(2);
});
test("a rejected candidate stays private and a repaired presentation completes", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Ask an analytics question").fill("Repair this analysis");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByText(narrative, { exact: true })).toBeVisible();
  await expect(page.getByTestId("narrative-draft")).toHaveCount(0);
  await expect(page.getByText(/Rejected draft/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(narrative, { exact: true })).toBeVisible();
  await expect(page.getByText(/Rejected draft/)).toHaveCount(0);
});
test("failed generation keeps narrative and candidate charts private", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Ask an analytics question").fill("Fail this analysis");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /Analysis could not complete/ }),
  ).toBeVisible();
  await expect(page.getByTestId("narrative-draft")).toHaveCount(0);
  await expect(page.getByTestId("chart-bar")).toHaveCount(0);
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
      await expect(page.getByRole("columnheader", { name: "Device", exact: true })).toBeVisible();
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

test("logout removes private history and a new guest cannot open the old chat", async ({
  page,
}) => {
  await page.getByLabel("Ask an analytics question").fill("My private analysis");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByText(narrative, { exact: true })).toBeVisible();
  const url = page.url();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue as guest" })).toBeVisible();
  await expect(page.getByText(narrative, { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page.getByRole("heading", { name: "Explore your ecommerce data." })).toBeVisible();
  await page.goto(url);
  await expect(page.getByText("Session not found")).toBeVisible();
  await expect(page.getByText(narrative, { exact: true })).toHaveCount(0);
});
test("Markdown tables and code scroll on mobile while images and HTML stay disabled", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Ask an analytics question").fill("Markdown findings");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByRole("heading", { name: "Findings", exact: true })).toBeVisible();
  await expect(page.getByTestId("narrative-draft")).toHaveCount(0);
  expect(await page.locator(".markdown img, .markdown script").count()).toBe(0);
  expect(await page.getByText("unsafe", { exact: true }).getAttribute("href")).toBe("");
  expect(
    await page
      .locator(".markdown-table")
      .evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(true);
  expect(
    await page
      .locator(".markdown pre")
      .evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("clarification completes once, clears its draft, reloads and permits a follow-up", async ({
  page,
}) => {
  const composer = page.getByLabel("Ask an analytics question");
  await composer.fill("Clarify customer frequency");
  await composer.press("Enter");
  const question = page.getByText("Purchase events or purchasing sessions?", { exact: true });
  await expect(question).toHaveCount(1);
  await expect(page.getByTestId("narrative-draft")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(question).toHaveCount(1);
  await expect(page.getByText("Discarded clarification draft")).toHaveCount(0);
  await composer.fill("Purchasing sessions in January");
  await composer.press("Enter");
  await expect(page.getByText(narrative, { exact: true })).toBeVisible();
  await expect(question).toHaveCount(1);
});

test("shows activity before query execution and formats persisted revenue charts", async ({
  page,
}) => {
  await page.getByLabel("Ask an analytics question").fill("Format revenue with early activity");
  await page.getByRole("button", { name: "Send question" }).click();
  const activity = page.getByRole("list", { name: "Analysis activity" });
  await expect(activity.locator('[data-status="preparing"]')).toContainText(
    "Preparing a custom query",
  );
  await expect(page.getByTestId("chart-bar")).toHaveCount(0);
  const chart = page.getByTestId("chart-bar");
  await expect(chart).toBeVisible();
  await expect(
    page.getByText("Desktop recorded $1,234.56 in revenue.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("agent-activity")).toHaveCount(0);
  await expect(chart.getByRole("application")).toContainText("$");
  await chart.getByText("View chart data", { exact: true }).click();
  await expect(chart.getByRole("columnheader", { name: "Recorded revenue" })).toBeVisible();
  await expect(chart.getByRole("cell", { name: "$1,234.56" })).toBeVisible();
  await page.reload();
  await expect(chart).toBeVisible();
  await chart.getByText("View chart data", { exact: true }).click();
  await expect(chart.getByRole("cell", { name: "$1,234.56" })).toBeVisible();
  await expect(page.getByTestId("agent-activity")).toHaveCount(0);
});

test("holds answer and charts while review is pending, then publishes them", async ({ page }) => {
  await page.getByLabel("Ask an analytics question").fill("Review this analysis");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByText("Checking the analysis", { exact: true })).toBeVisible();
  await expect(page.getByTestId("narrative-draft")).toHaveCount(0);
  await expect(page.getByTestId("chart-bar")).toHaveCount(0);
  await expect(page.getByText(narrative, { exact: true })).toHaveCount(0);
  await expect(page.getByText(narrative, { exact: true })).toBeVisible();
  await expect(page.getByTestId("chart-bar")).toHaveCount(1);
});

test("a second review rejection publishes no answer or charts after reload", async ({ page }) => {
  await page.getByLabel("Ask an analytics question").fill("Reject this analysis");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /did not pass verification after repair/ }),
  ).toBeVisible();
  await expect(page.getByText(narrative, { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("chart-bar")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("status").filter({ hasText: /did not pass verification after repair/ }),
  ).toBeVisible();
  await expect(page.getByText(narrative, { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("chart-bar")).toHaveCount(0);
});
