import { afterEach, expect, it, vi } from "vitest";
import { OpenRouterTitles, validTitle } from "./titles.ts";
afterEach(() => vi.restoreAllMocks());
it.each([null, "", "   ", "x".repeat(61), "Two\nlines", "<title>", "`title`"])(
  "rejects invalid title %s",
  (value) => {
    expect(validTitle(value)).toBeNull();
  },
);
it("requests bounded plain text with 100 tokens and records separate usage", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "  Compras por dispositivo  " }, finish_reason: "stop" }],
        usage: { prompt_tokens: 15, completion_tokens: 8, cost: 0.002 },
      }),
    ),
  );
  const client = new OpenRouterTitles("key", "haiku");
  const result = await client.complete(["x".repeat(8000)], new AbortController().signal);
  expect(result).toEqual({
    title: "Compras por dispositivo",
    usage: { inputTokens: 15, outputTokens: 8, cost: 0.002 },
  });
  const serialized = fetch.mock.calls[0]?.[1]?.body;
  if (typeof serialized !== "string") {
    throw new Error("Expected JSON request");
  }
  const body: unknown = JSON.parse(serialized);
  expect(body).toMatchObject({ model: "haiku", max_tokens: 100 });
  expect(JSON.stringify(body).length).toBeLessThan(3000);
  expect(body).not.toHaveProperty("tool_choice");
});
it("retains usage on invalid or truncated output", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "x".repeat(61) }, finish_reason: "stop" }],
        usage: { completion_tokens: 100 },
      }),
    ),
  );
  const client = new OpenRouterTitles("key", "haiku");
  expect(await client.complete(["Prompt"], new AbortController().signal)).toMatchObject({
    title: null,
    usage: { outputTokens: 100 },
  });
  fetch.mockResolvedValue(
    new Response(
      JSON.stringify({ choices: [{ message: { content: "Partial" }, finish_reason: "length" }] }),
    ),
  );
  expect(await client.complete(["Prompt"], new AbortController().signal)).toMatchObject({
    title: null,
  });
});
it("rejects failed and oversized responses", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("{}", { status: 503 }));
  const client = new OpenRouterTitles("key", "haiku");
  await expect(client.complete(["Prompt"], new AbortController().signal)).rejects.toThrow("503");
  fetch.mockResolvedValue(new Response("x".repeat(17000)));
  await expect(client.complete(["Prompt"], new AbortController().signal)).rejects.toThrow("limit");
});
