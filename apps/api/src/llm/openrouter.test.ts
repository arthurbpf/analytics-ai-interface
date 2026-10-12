import { afterEach, expect, it, vi } from "vitest";
import { OpenRouter } from "./openrouter.ts";
import { limits } from "../config.ts";

afterEach(() => {
  vi.restoreAllMocks();
});
it("maps protocol exchanges and validates a tool completion and usage", async () => {
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  { id: "c1", type: "function", function: { name: "get_schema", arguments: "{}" } },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.01 },
        }),
      ),
    );
  const signal = new AbortController().signal;
  const response = await new OpenRouter("test-key", "test-model").complete(
    "Instructions",
    [
      { role: "user", content: "Question" },
      {
        role: "assistant",
        content: null,
        toolCalls: [{ id: "old", name: "get_schema", arguments: "{}" }],
      },
      { role: "tool", toolCallId: "old", content: "{}" },
    ],
    [],
    signal,
  );
  expect(response.message.toolCalls[0]?.name).toBe("get_schema");
  expect(response.usage.cost).toBe(0.01);
  const [url, options] = fetchMock.mock.calls[0] ?? [];
  expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
  expect(options?.signal).toBe(signal);
  expect(options?.method).toBe("POST");
  expect(options?.body).toContain('"tool_call_id":"old"');
  expect(options?.body).not.toContain("parallel_tool_calls");
});
it("bounds model inputs before sending a paid request", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  await expect(
    new OpenRouter("key", "model").complete(
      "x".repeat(limits.contextBytes),
      [],
      [],
      new AbortController().signal,
    ),
  ).rejects.toThrow("context budget");
  expect(fetchMock).not.toHaveBeenCalled();
});
it("fails vendor HTTP errors without retry and rejects malformed responses", async () => {
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("Unavailable", { status: 503 }));
  const model = new OpenRouter("key", "model");
  await expect(
    model.complete("Instructions", [], [], new AbortController().signal),
  ).rejects.toThrow("503");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock.mockResolvedValue(new Response('{"choices":[]}'));
  await expect(
    model.complete("Instructions", [], [], new AbortController().signal),
  ).rejects.toThrow();
});
