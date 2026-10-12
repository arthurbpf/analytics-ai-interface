import type { ServerResponse } from "node:http";
import type { StreamEvent } from "@analytics/contracts";

export function openStream(response: ServerResponse, signal: AbortSignal) {
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders();
  const heartbeat = setInterval(() => {
    if (!response.destroyed && !response.writableEnded && !response.writableNeedDrain) {
      response.write(": heartbeat\n\n");
    }
  }, 15000);
  const send = async (event: StreamEvent) => {
    signal.throwIfAborted();
    if (response.destroyed || response.writableEnded) {
      throw new Error("Stream closed");
    }
    if (!response.write(`data: ${JSON.stringify(event)}\n\n`)) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          response.off("drain", onDrain);
          response.off("close", onClose);
          signal.removeEventListener("abort", onAbort);
        };
        const onDrain = () => {
          cleanup();
          resolve();
        };
        const onClose = () => {
          cleanup();
          reject(new Error("Stream closed"));
        };
        const onAbort = () => {
          cleanup();
          reject(signal.reason);
        };
        response.once("drain", onDrain);
        response.once("close", onClose);
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) {
          onAbort();
        }
      });
    }
  };
  const close = () => {
    clearInterval(heartbeat);
    if (!response.destroyed && !response.writableEnded) {
      response.end();
    }
  };
  response.once("close", () => {
    clearInterval(heartbeat);
  });
  return { send, close };
}
