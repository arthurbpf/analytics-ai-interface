import express, { type ErrorRequestHandler } from "express";
import { z } from "zod";
import { idSchema, turnRequestSchema } from "@analytics/contracts";
import { limits } from "./config.ts";
import { RequestError, type Store } from "./db/store.ts";
import { runAgent, type AgentDependencies } from "./agent/loop.ts";
import { openStream } from "./http/stream.ts";

export function createApp(deps: AgentDependencies & { store: Store }) {
  const app = express();
  const active = new Map<AbortController, Promise<void>>();
  app.use(express.json({ limit: "64kb" }));
  app.get("/api/health", (_request, response) => { response.json({ status: "ok" }); });
  app.post("/api/sessions", async (_request, response) => { response.status(201).json(await deps.store.createSession()); });
  app.get("/api/sessions/:id", async (request, response) => { response.json(await deps.store.history(idSchema.parse(request.params["id"]))); });
  app.get("/api/sessions/:id/results/:ref", async (request, response) => {
    response.json(await deps.store.result(idSchema.parse(request.params["id"]), idSchema.parse(request.params["ref"])));
  });
  app.post("/api/sessions/:id/turns", async (request, response) => {
    const sessionId = idSchema.parse(request.params["id"]);
    const input = turnRequestSchema.parse(request.body);
    const controller = new AbortController();
    const onClose = () => { controller.abort(new Error("Browser disconnected")); };
    response.once("close", onClose);
    const turn = await deps.store.startTurn(sessionId, input.clientTurnId, input.message);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(limits.deadlineMs)]);
    const stream = openStream(response, signal);
    const work = async () => {
      try {
        await stream.send({ type: "turn_started", turnId: turn.id });
        const outcome = await runAgent(deps, sessionId, turn.id, signal, stream.send);
        if (!response.destroyed && !signal.aborted) { await stream.send({ type: "turn_finished", turnId: turn.id, ...outcome }); }
      } catch (error) {
        await deps.store.finish(turn.id, signal.aborted ? "interrupted" : "failed", { code: "stream_failed", message: "Turn stopped; reload saved history." });
        console.error(JSON.stringify({ event: "stream_failed", turnId: turn.id, reason: error instanceof Error ? error.message : "Unknown failure" }));
      } finally {
        stream.close(); response.off("close", onClose); active.delete(controller);
      }
    };
    const task = work();
    active.set(controller, task);
    await task;
  });
  app.use(errors);
  return { app, shutdown: async () => {
    for (const controller of active.keys()) { controller.abort(new Error("Server shutdown")); }
    await Promise.allSettled(active.values());
  } };
}

const errors: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (response.headersSent) { response.end(); return; }
    if (error instanceof RequestError) { response.status(error.status).json({ code: error.code, message: error.message }); return; }
    if (error instanceof z.ZodError || error instanceof SyntaxError) { response.status(400).json({ code: "invalid_request", message: "Invalid request data" }); return; }
    console.error(JSON.stringify({ event: "http_failed", reason: error instanceof Error ? error.message : "Unknown failure" }));
    response.status(500).json({ code: "internal_error", message: "Request could not complete" });
  };
