import type { ServerResponse } from "node:http";
import type { StreamEvent } from "@analytics/contracts";

/**
 * Opens a Server-Sent Events stream with heartbeats and abort handling.
 *
 * @param response - Server response to write the stream to.
 * @param signal - Abort signal that closes the stream.
 * @returns Handlers to send events and to close the stream.
 */
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
  /**
   * Writes one stream event, waiting for drain when the buffer is full.
   *
   * @param event - Event to serialize and send.
   */
  const send = async (event: StreamEvent) => {
    signal.throwIfAborted();
    if (response.destroyed || response.writableEnded) {
      throw new Error("Stream closed");
    }
    if (!response.write(`data: ${JSON.stringify(event)}\n\n`)) {
      await new Promise<void>((resolve, reject) => {
        /**
         * Detaches the drain, close, and abort listeners.
         */
        const cleanup = () => {
          response.off("drain", onDrain);
          response.off("close", onClose);
          signal.removeEventListener("abort", onAbort);
        };
        /**
         * Resolves once the response buffer drains.
         */
        const onDrain = () => {
          cleanup();
          resolve();
        };
        /**
         * Rejects when the connection closes before draining.
         */
        const onClose = () => {
          cleanup();
          reject(new Error("Stream closed"));
        };
        /**
         * Rejects when the request is aborted before draining.
         */
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
  /**
   * Stops the heartbeat and ends the response when it is still open.
   */
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
