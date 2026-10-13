import { expect, it, vi } from "vitest";
import { ApiFailure, chatApi } from "./api.ts";
import { history, sessionId, turnId } from "./test-fixtures.ts";
it("uses the shared route and runtime-validates JSON history", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      new Response(JSON.stringify(history()), { headers: { "Content-Type": "application/json" } }),
    );
  expect(await chatApi.history(sessionId)).toEqual(history());
  expect(fetch.mock.calls[0]?.[0]).toBe(`/api/sessions/${sessionId}`);
  fetch.mockResolvedValue(
    new Response('{"session":{}}', { headers: { "Content-Type": "application/json" } }),
  );
  await expect(chatApi.history(sessionId)).rejects.toThrow();
});
it.each([400, 404, 409, 500])("does not retry HTTP %s turn failures", async (status) => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      new Response(JSON.stringify({ code: "failed", message: "Failed safely" }), { status }),
    );
  await expect(async () => {
    for await (const event of chatApi.turn(
      { params: { id: sessionId }, body: { message: "hello", clientTurnId: turnId } },
      new AbortController().signal,
    )) {
      expect(event).toBeDefined();
    }
  }).rejects.toThrow("Failed safely");
  expect(fetch).toHaveBeenCalledTimes(1);
});
async function consume() {
  for await (const event of chatApi.turn(
    { params: { id: sessionId }, body: { message: "hello", clientTurnId: turnId } },
    new AbortController().signal,
  )) {
    expect(event).toBeDefined();
  }
}
it("preserves the HTTP status when a turn error body is not JSON", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("<html>Bad gateway</html>", { status: 502 }),
  );
  let caught: unknown;
  try {
    await consume();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ApiFailure);
  expect(caught).toMatchObject({ status: 502, code: "request_failed" });
});
it("rejects missing streams, wrong content types, and malformed events", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { headers: { "Content-Type": "text/event-stream" } }));

  await expect(consume()).rejects.toThrow("Missing response stream");
  fetch.mockResolvedValue(new Response("{}"));
  await expect(consume()).rejects.toThrow("Missing response stream");
  fetch.mockResolvedValue(
    new Response('data: {"type":"unknown"}\n\n', {
      headers: { "Content-Type": "text/event-stream" },
    }),
  );
  await expect(consume()).rejects.toThrow();
});
