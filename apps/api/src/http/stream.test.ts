import { randomUUID } from "node:crypto";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { openStream } from "./stream.ts";
import { expect, it, vi } from "vitest";
import { readEvents, type StreamEvent } from "@analytics/contracts";
it("reconstructs fragmented UTF-8 SSE frames and ignores heartbeats", async () => {
  const event: StreamEvent = {
    type: "progress",
    turnId: randomUUID(),
    stage: "thinking",
    message: "Análise 📊",
  };
  const data = new TextEncoder().encode(`: heartbeat\n\ndata: ${JSON.stringify(event)}\n\n`);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of data) {
        controller.enqueue(Uint8Array.of(byte));
      }
      controller.close();
    },
  });
  const events: StreamEvent[] = [];
  for await (const parsed of readEvents(stream)) {
    events.push(parsed);
  }
  expect(events).toEqual([event]);
});
it("rejects incomplete frames instead of silently dropping them", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"type":'));
      controller.close();
    },
  });
  await expect(async () => {
    for await (const event of readEvents(stream)) {
      expect(event).toBeDefined();
    }
  }).rejects.toThrow("Incomplete");
});
it("waits for slow consumers and cleans up listeners when aborted", async () => {
  const response = new ServerResponse(new IncomingMessage(new Socket()));
  vi.spyOn(response, "flushHeaders").mockImplementation(() => {});
  vi.spyOn(response, "write").mockReturnValue(false);
  const controller = new AbortController();
  const stream = openStream(response, controller.signal);
  const event: StreamEvent = { type: "turn_started", turnId: randomUUID() };
  let sent = false;
  const pending = stream.send(event).then(() => {
    sent = true;
  });
  await Promise.resolve();
  expect(sent).toBe(false);
  response.emit("drain");
  await pending;
  expect(sent).toBe(true);
  const interrupted = stream.send(event);
  controller.abort(new Error("Disconnected"));
  await expect(interrupted).rejects.toThrow("Disconnected");
  expect(response.listenerCount("drain")).toBe(0);
  stream.close();
});
