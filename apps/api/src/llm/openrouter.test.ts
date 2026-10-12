import { afterEach, expect, it, vi } from "vitest";
import { OpenRouter } from "./openrouter.ts";
import { limits } from "../config.ts";

afterEach(() => {
  vi.restoreAllMocks();
});
it("maps protocol exchanges and validates a tool completion and usage", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      ": heartbeat\n\ndata: " +
        JSON.stringify({
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, id: "c1", function: { name: "get_schema", arguments: "{}" } },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.01 },
        }) +
        "\n\ndata: [DONE]\n\n",
      { headers: { "Content-Type": "text/event-stream" } },
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

function vendorStream(frames: unknown[], done = true, fragmented = false) {
  const bytes = new TextEncoder().encode(
    ": processing\n\n" +
      frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") +
      (done ? "data: [DONE]\n\n" : ""),
  );
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (fragmented) {
        for (const byte of bytes) {
          controller.enqueue(Uint8Array.of(byte));
        }
      } else {
        controller.enqueue(bytes);
      }
      controller.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}
it("assembles fragmented tool calls and UTF-8, awaits updates, and reads final usage once", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    vendorStream(
      [
        {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "a",
                    function: { name: "present_", arguments: '{"narrative":"Análise ' },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: 0, function: { name: "analysis", arguments: '📊"}' } }],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
        {
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
          usage: { prompt_tokens: 9, completion_tokens: 7, cost: 0.02 },
        },
      ],
      true,
      true,
    ),
  );
  const updates: string[] = [];
  const response = await new OpenRouter("key", "model").complete(
    "system",
    [],
    [],
    new AbortController().signal,
    async (update) => {
      await Promise.resolve();
      updates.push(update.name);
    },
  );
  expect(updates).toEqual(["present_", "present_analysis"]);
  expect(response.message.toolCalls).toEqual([
    { id: "a", name: "present_analysis", arguments: '{"narrative":"Análise 📊"}' },
  ]);
  expect(response.usage).toEqual({ inputTokens: 9, outputTokens: 7, cost: 0.02 });
});
it("keeps interleaved tool calls in index order and unknown usage null", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    vendorStream([
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 1, id: "b", function: { name: "get_metrics", arguments: "{}" } },
                { index: 0, id: "a", function: { name: "get_schema", arguments: "{}" } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    ]),
  );
  const response = await new OpenRouter("key", "model").complete(
    "system",
    [],
    [],
    new AbortController().signal,
  );
  expect(response.message.toolCalls.map((call) => call.id)).toEqual(["a", "b"]);
  expect(response.usage).toEqual({ inputTokens: null, outputTokens: null, cost: null });
});
it.each([
  [vendorStream([], false), "before [DONE]"],
  [vendorStream([{ error: { message: "Provider offline" } }]), "Provider offline"],
  [vendorStream([{ choices: [{ index: 0, delta: {}, finish_reason: "length" }] }]), "length"],
  [vendorStream([]), "no finished completion"],
  [
    vendorStream([
      {
        choices: [
          {
            index: 0,
            delta: { content: "x".repeat(limits.contextBytes + 1) },
            finish_reason: "stop",
          },
        ],
      },
    ]),
    "output budget",
  ],
])("rejects incomplete, failed, and oversized vendor streams", async (response, message) => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
  await expect(
    new OpenRouter("key", "model").complete("system", [], [], new AbortController().signal),
  ).rejects.toThrow(message);
});
it("propagates cancellation while awaiting a streaming update", async () => {
  const controller = new AbortController();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    vendorStream([
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: "a", function: { name: "get_schema", arguments: "{}" } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    ]),
  );
  await expect(
    new OpenRouter("key", "model").complete("system", [], [], controller.signal, async () => {
      controller.abort(new Error("Stopped"));
      controller.signal.throwIfAborted();
    }),
  ).rejects.toThrow("Stopped");
});
