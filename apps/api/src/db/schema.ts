import type { StoredMessageContent } from "./history.ts";
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { ApiError, QueryResult } from "@analytics/contracts";

export const sessions = pgTable("sessions", {
  id: uuid().primaryKey().defaultRandom(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
export const turns = pgTable(
  "turns",
  {
    id: uuid().primaryKey().defaultRandom(),
    sessionId: uuid()
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    clientTurnId: uuid().notNull(),
    status: text({ enum: ["running", "completed", "failed", "interrupted"] })
      .notNull()
      .default("running"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
    error: jsonb().$type<ApiError>(),
    usage: jsonb().$type<{
      modelCalls: number;
      inputTokens: number | null;
      outputTokens: number | null;
      cost: number | null;
    }>(),
  },
  (table) => [
    uniqueIndex("turn_request_unique").on(table.sessionId, table.clientTurnId),
    uniqueIndex("one_running_turn")
      .on(table.sessionId)
      .where(sql`${table.status} = 'running'`),
  ],
);
export const messages = pgTable(
  "messages",
  {
    id: uuid().primaryKey().defaultRandom(),
    sequence: bigserial({ mode: "bigint" }).notNull(),
    sessionId: uuid()
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    turnId: uuid()
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    content: jsonb().$type<StoredMessageContent>().notNull(),
  },
  (table) => [index("message_history").on(table.sessionId, table.sequence)],
);
export const queryResults = pgTable(
  "query_results",
  {
    ref: uuid().primaryKey(),
    sessionId: uuid()
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    turnId: uuid()
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    data: jsonb().$type<QueryResult>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    sequence: bigint({ mode: "bigint" }).notNull().generatedAlwaysAsIdentity(),
  },
  (table) => [index("result_history").on(table.sessionId, table.sequence)],
);
