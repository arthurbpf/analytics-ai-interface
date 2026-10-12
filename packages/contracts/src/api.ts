import { initContract } from "@ts-rest/core";
import { z } from "zod";
import {
  apiErrorSchema,
  historySchema,
  idSchema,
  sessionSchema,
  identitySchema,
  turnRequestSchema,
} from "./sessions.ts";
import { queryResultSchema } from "./results.ts";

const c = initContract();
const errors = {
  400: apiErrorSchema,
  401: apiErrorSchema,
  403: apiErrorSchema,
  500: apiErrorSchema,
};
const sessionParams = z.object({ id: idSchema });

export const jsonContract = c.router({
  health: {
    method: "GET",
    path: "/api/health",
    responses: { 200: z.object({ status: z.literal("ok") }), 500: apiErrorSchema },
  },
  identity: {
    method: "GET",
    path: "/api/auth/me",
    responses: { 200: z.object({ identity: identitySchema.nullable() }), ...errors },
  },
  guest: {
    method: "POST",
    path: "/api/auth/guest",
    body: c.noBody(),
    responses: { 201: identitySchema, ...errors },
  },
  logout: {
    method: "POST",
    path: "/api/auth/logout",
    body: c.noBody(),
    responses: { 200: z.object({ ok: z.literal(true) }), ...errors },
  },
  listSessions: {
    method: "GET",
    path: "/api/sessions",
    responses: { 200: z.array(sessionSchema), ...errors },
  },
  createSession: {
    method: "POST",
    path: "/api/sessions",
    body: c.noBody(),
    responses: { 201: sessionSchema, ...errors },
  },
  history: {
    method: "GET",
    path: "/api/sessions/:id",
    pathParams: sessionParams,
    responses: { 200: historySchema, 404: apiErrorSchema, ...errors },
  },
  result: {
    method: "GET",
    path: "/api/sessions/:id/results/:ref",
    pathParams: sessionParams.extend({ ref: idSchema }),
    responses: { 200: queryResultSchema, 404: apiErrorSchema, ...errors },
  },
});

export const turnContract = c.mutation({
  method: "POST",
  path: "/api/sessions/:id/turns",
  pathParams: sessionParams,
  body: turnRequestSchema,
  responses: {
    200: c.otherResponse({ contentType: "text/event-stream", body: z.string() }),
    404: apiErrorSchema,
    409: apiErrorSchema,
    ...errors,
  },
});

export const apiContract = c.router({ ...jsonContract, turn: turnContract });
