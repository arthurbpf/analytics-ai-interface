import express, { type ErrorRequestHandler } from "express";
import { z } from "zod";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { jsonContract, turnContract } from "@analytics/contracts";
import { limits } from "./config.ts";
import { RequestError, type Store } from "./db/store.ts";
import { runAgent, type AgentDependencies } from "./agent/loop.ts";
import { openStream } from "./http/stream.ts";

export function createApp(deps: AgentDependencies & { store: Store }) {
  const app = express();
  const active = new Map<AbortController, Promise<void>>();
  app.use(express.json({ limit: "64kb" }));
  const server = initServer();
  createExpressEndpoints(
    jsonContract,
    server.router(jsonContract, {
      health: async () => ({ status: 200, body: { status: "ok" } }),
      createSession: async () => ({ status: 201, body: await deps.store.createSession() }),
      history: async ({ params }) => ({ status: 200, body: await deps.store.history(params.id) }),
      result: async ({ params }) => ({
        status: 200,
        body: await deps.store.result(params.id, params.ref),
      }),
    }),
    app,
    {
      responseValidation: true,
      logInitialization: false,
      requestValidationErrorHandler: (_error, _request, response) => {
        response.status(400).json({ code: "invalid_request", message: "Invalid request data" });
      },
    },
  );
  app.post(turnContract.path, async (request, response) => {
    const { id: sessionId } = turnContract.pathParams.parse(request.params);
    const input = turnContract.body.parse(request.body);
    const controller = new AbortController();
    const onClose = () => {
      controller.abort(new Error("Browser disconnected"));
    };
    response.once("close", onClose);
    const turn = await deps.store.startTurn(sessionId, input.clientTurnId, input.message);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(limits.deadlineMs)]);
    const stream = openStream(response, signal);
    const work = async () => {
      try {
        await stream.send({ type: "turn_started", turnId: turn.id });
        const outcome = await runAgent(deps, sessionId, turn.id, signal, stream.send);
        if (!response.destroyed && !signal.aborted) {
          await stream.send({ type: "turn_finished", turnId: turn.id, ...outcome });
        }
      } catch (error) {
        await deps.store.finish(turn.id, signal.aborted ? "interrupted" : "failed", {
          code: "stream_failed",
          message: "Turn stopped; reload saved history.",
        });
        console.error(
          JSON.stringify({
            event: "stream_failed",
            turnId: turn.id,
            reason: error instanceof Error ? error.message : "Unknown failure",
          }),
        );
      } finally {
        stream.close();
        response.off("close", onClose);
        active.delete(controller);
      }
    };
    const task = work();
    active.set(controller, task);
    await task;
  });
  app.use(errors);
  return {
    app,
    shutdown: async () => {
      for (const controller of active.keys()) {
        controller.abort(new Error("Server shutdown"));
      }
      await Promise.allSettled(active.values());
    },
  };
}

const errors: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if (response.headersSent) {
    response.end();
    return;
  }
  if (error instanceof RequestError) {
    response.status(error.status).json({ code: error.code, message: error.message });
    return;
  }
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    response.status(400).json({ code: "invalid_request", message: "Invalid request data" });
    return;
  }
  console.error(
    JSON.stringify({
      event: "http_failed",
      reason: error instanceof Error ? error.message : "Unknown failure",
    }),
  );
  response.status(500).json({ code: "internal_error", message: "Request could not complete" });
};
