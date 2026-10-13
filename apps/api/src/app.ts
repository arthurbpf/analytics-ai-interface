import path from "node:path";
import express, { type Request, type ErrorRequestHandler } from "express";
import { z } from "zod";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { jsonContract, turnContract } from "@analytics/contracts";
import { AuthStore, authLifetimeMs, type Authenticated, type GoogleLogin } from "./auth.ts";
import { generateTitle, type TitleClient } from "./llm/titles.ts";
import { limits } from "./config.ts";
import { RequestError, type Store } from "./db/store.ts";
import { runAgent, type AgentDependencies } from "./agent/loop.ts";
import type { Reviewer } from "./agent/review.ts";
import { openStream } from "./http/stream.ts";

/**
 * Reads a named cookie from an incoming request.
 *
 * @param request - Express request carrying the cookie header.
 * @param name - Cookie name to read.
 * @returns The cookie value, or undefined when absent.
 */
const cookie = (request: Request, name: string) => {
  const part = request.headers.cookie
    ?.split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`));
  return part?.slice(name.length + 1);
};

/**
 * Builds the Express application with auth, chat endpoints, and static serving.
 *
 * @param deps - Store, model clients, warehouse, budgets, and optional integrations.
 * @returns The configured app and a shutdown handler that drains in-flight work.
 */
export function createApp(
  deps: AgentDependencies & {
    store: Store;
    reviewer: Reviewer;
    origin?: string;
    secureCookies?: boolean;
    google?: GoogleLogin | undefined;
    titles?: TitleClient;
    staticDir?: string | undefined;
  },
) {
  const app = express();
  const active = new Map<AbortController, { task: Promise<void>; tokenHash: string }>();
  const titleTasks = new Set<Promise<void>>();
  const auth = new AuthStore(deps.store);
  const identities = new WeakMap<Request, Authenticated | null>();
  const origin = deps.origin ?? "http://localhost:5173";
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: deps.secureCookies ?? false,
    path: "/",
    maxAge: authLifetimeMs,
  };
  /**
   * Returns the authenticated identity for a request, or rejects when absent.
   *
   * @param request - Express request to resolve.
   * @returns The authenticated identity.
   * @throws When the request has no identity.
   */
  const requireIdentity = (request: Request) => {
    const current = identities.get(request);
    if (!current) {
      throw new RequestError(401, "unauthenticated", "Please sign in or continue as guest");
    }
    return current;
  };
  /**
   * Aborts any in-flight streams owned by a credential.
   *
   * @param tokenHash - Credential whose streams should be stopped.
   */
  const stopStreams = (tokenHash: string) => {
    for (const [controller, work] of active) {
      if (work.tokenHash === tokenHash) {
        controller.abort(new Error("Authentication ended"));
      }
    }
  };
  app.use("/api", async (request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.origin !== origin) {
      throw new RequestError(
        403,
        "invalid_origin",
        "Request must come from the application origin",
      );
    }
    identities.set(request, await auth.authenticate(cookie(request, "analytics_auth")));
    if (request.path.startsWith("/sessions")) {
      requireIdentity(request);
    }
    next();
  });
  app.get("/api/auth/google", async (request, response) => {
    if (!deps.google) {
      throw new RequestError(400, "login_unavailable", "Google login is not configured");
    }
    const attempt = await auth.begin(deps.google, identities.get(request) ?? null);
    response.cookie("analytics_oauth", attempt.token, {
      ...cookieOptions,
      path: "/api/auth",
      maxAge: 10 * 60 * 1000,
    });
    response.redirect(attempt.url);
  });
  app.get("/api/auth/google/callback", async (request, response) => {
    response.clearCookie("analytics_oauth", {
      ...cookieOptions,
      maxAge: undefined,
      path: "/api/auth",
    });
    try {
      if (!deps.google) {
        throw new Error("Google login unavailable");
      }
      const { state, code } = z
        .object({ state: z.string().min(1), code: z.string().min(1) })
        .parse(request.query);
      const current = identities.get(request) ?? null;
      const login = await auth.login(
        deps.google,
        cookie(request, "analytics_oauth"),
        state,
        code,
        current,
      );
      if (current) {
        stopStreams(current.tokenHash);
      }
      response.cookie("analytics_auth", login.token, cookieOptions);
      response.redirect(`${origin}/`);
    } catch {
      response.redirect(`${origin}/?login=failed`);
    }
  });
  app.use(express.json({ limit: "64kb" }));
  const server = initServer();
  createExpressEndpoints(
    jsonContract,
    server.router(jsonContract, {
      health: async () => ({ status: 200, body: { status: "ok" } }),
      identity: async ({ req }) => ({
        status: 200,
        body: { identity: identities.get(req)?.identity ?? null },
      }),
      guest: async ({ req, res }) => {
        const current = identities.get(req);
        if (current) {
          return { status: 201, body: current.identity };
        }
        const guest = await auth.guest();
        res.cookie("analytics_auth", guest.token, cookieOptions);
        return { status: 201, body: guest.identity };
      },
      logout: async ({ req, res }) => {
        const current = requireIdentity(req);
        await auth.revoke(current.tokenHash);
        stopStreams(current.tokenHash);
        res.clearCookie("analytics_auth", {
          ...cookieOptions,
          maxAge: undefined,
        });
        return { status: 200, body: { ok: true } };
      },
      listSessions: async ({ req }) => ({
        status: 200,
        body: await deps.store.listSessions(requireIdentity(req).identity.id),
      }),
      createSession: async ({ req }) => {
        const current = requireIdentity(req);
        return {
          status: 201,
          body: await deps.store.createSession(current.identity.id, current.tokenHash),
        };
      },
      history: async ({ params, req }) => {
        await deps.store.assertOwner(params.id, requireIdentity(req).identity.id);
        return { status: 200, body: await deps.store.history(params.id) };
      },
      result: async ({ params, req }) => {
        await deps.store.assertOwner(params.id, requireIdentity(req).identity.id);
        return {
          status: 200,
          body: await deps.store.result(params.id, params.ref),
        };
      },
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
    const current = requireIdentity(request);
    await deps.store.assertOwner(sessionId, current.identity.id);
    const controller = new AbortController();
    /**
     * Aborts the turn when the browser disconnects.
     */
    const onClose = () => {
      controller.abort(new Error("Browser disconnected"));
    };
    const turn = await deps.store.startTurn(
      sessionId,
      input.clientTurnId,
      input.message,
      current.identity.id,
      current.tokenHash,
    );
    response.once("close", onClose);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(limits.deadlineMs)]);
    const stream = openStream(response, signal);
    /**
     * Runs the agent turn, streams its events, and finalizes the stream.
     */
    const work = async () => {
      let started = false;
      const titleAttempt = turn.titleAttempt;
      if (titleAttempt) {
        /**
         * Generates a title and streams the updated session when the turn has started.
         */
        const titleTask = async () => {
          try {
            const session = await generateTitle(deps.store, deps.titles, sessionId, titleAttempt);
            if (
              started &&
              session &&
              !response.writableEnded &&
              !response.destroyed &&
              !signal.aborted
            ) {
              await stream.send({
                type: "session_updated",
                turnId: turn.id,
                session,
              });
            }
          } catch (error) {
            console.error(
              JSON.stringify({
                event: "title_persistence_failed",
                reason: error instanceof Error ? error.message : "Unknown failure",
              }),
            );
          }
        };
        const task = titleTask();
        titleTasks.add(task);
        task.then(
          () => titleTasks.delete(task),
          () => titleTasks.delete(task),
        );
      }
      try {
        await stream.send({ type: "turn_started", turnId: turn.id });
        started = true;
        const outcome = await runAgent(deps, sessionId, turn.id, signal, stream.send);
        if (!response.destroyed && !signal.aborted) {
          await stream.send({
            type: "turn_finished",
            turnId: turn.id,
            ...outcome,
          });
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
    active.set(controller, { task, tokenHash: current.tokenHash });
    await task;
  });
  if (deps.staticDir) {
    const staticDir = path.resolve(deps.staticDir);
    app.use(express.static(staticDir));
    app.get(/^\/(?!api(?:\/|$)).*/, (_request, response) => {
      response.sendFile(path.join(staticDir, "index.html"));
    });
  }
  app.use(errors);
  return {
    app,
    shutdown: async () => {
      for (const controller of active.keys()) {
        controller.abort(new Error("Server shutdown"));
      }
      await Promise.allSettled([...active.values()].map((work) => work.task));
      await Promise.allSettled(titleTasks);
    },
  };
}

/**
 * Terminal error handler that maps known errors to HTTP responses.
 *
 * @param error - Error thrown by an earlier handler.
 * @param _request - Unused Express request.
 * @param response - Express response to write.
 * @param _next - Unused Express next callback.
 */
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
