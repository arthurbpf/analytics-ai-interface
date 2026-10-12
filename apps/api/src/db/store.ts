import { and, asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { historySchema, queryResultSchema, sessionSchema, turnSchema, type ApiError, type MessageContent, type QueryResult, type TerminalStatus } from "@analytics/contracts";
import * as schema from "./schema.ts";

export class RequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
export class Store {
  readonly pool: Pool;
  readonly db;
  constructor(url: string) {
    this.pool = new Pool({ connectionString: url, max: 5 });
    this.db = drizzle({ client: this.pool, schema });
  }
  async createSession() {
    const [session] = await this.db.insert(schema.sessions).values({}).returning();
    if (!session) { throw new Error("Session insert failed"); }
    return sessionSchema.parse({ ...session, createdAt: session.createdAt.toISOString(), updatedAt: session.updatedAt.toISOString() });
  }
  async history(sessionId: string) {
    const [session] = await this.db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId));
    if (!session) { throw new RequestError(404, "not_found", "Session not found"); }
    const turnRows = await this.db.select().from(schema.turns).where(eq(schema.turns.sessionId, sessionId)).orderBy(asc(schema.turns.createdAt), asc(schema.turns.id));
    const messageRows = await this.db.select().from(schema.messages).where(eq(schema.messages.sessionId, sessionId)).orderBy(asc(schema.messages.sequence));
    return historySchema.parse({
      session: { ...session, createdAt: session.createdAt.toISOString(), updatedAt: session.updatedAt.toISOString() },
      turns: turnRows.map((turn) => ({ ...turn, createdAt: turn.createdAt.toISOString(), finishedAt: turn.finishedAt?.toISOString() ?? null })),
      messages: messageRows.map((message) => ({ id: message.id, turnId: message.turnId, content: message.content })),
    });
  }
  async startTurn(sessionId: string, clientTurnId: string, message: string) {
    return this.db.transaction(async (tx) => {
      const [session] = await tx.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).for("update");
      if (!session) { throw new RequestError(404, "not_found", "Session not found"); }
      const [existing] = await tx.select().from(schema.turns).where(and(eq(schema.turns.sessionId, sessionId), eq(schema.turns.clientTurnId, clientTurnId)));
      if (existing) { throw new RequestError(409, "duplicate_turn", `Turn already exists: ${existing.id}. Retrieve session history.`); }
      const [running] = await tx.select().from(schema.turns).where(and(eq(schema.turns.sessionId, sessionId), eq(schema.turns.status, "running")));
      if (running) { throw new RequestError(409, "turn_running", "A turn is already running"); }
      const [turn] = await tx.insert(schema.turns).values({ sessionId, clientTurnId }).returning();
      if (!turn) { throw new Error("Turn insert failed"); }
      await tx.insert(schema.messages).values({ sessionId, turnId: turn.id, content: { kind: "model", message: { role: "user", content: message } } });
      await tx.update(schema.sessions).set({ updatedAt: new Date() }).where(eq(schema.sessions.id, sessionId));
      return turnSchema.parse({ ...turn, createdAt: turn.createdAt.toISOString(), finishedAt: null });
    });
  }
  async append(sessionId: string, turnId: string, content: MessageContent) {
    await this.db.insert(schema.messages).values({ sessionId, turnId, content });
  }
  async saveResult(sessionId: string, turnId: string, data: QueryResult) {
    await this.db.insert(schema.queryResults).values({ ref: data.ref, sessionId, turnId, data });
  }
  async result(sessionId: string, ref: string) {
    const [result] = await this.db.select().from(schema.queryResults).where(and(eq(schema.queryResults.sessionId, sessionId), eq(schema.queryResults.ref, ref)));
    if (!result) { throw new RequestError(404, "not_found", "Result not found"); }
    return queryResultSchema.parse(result.data);
  }
  async recentResults(sessionId: string) {
    const results = await this.db.select().from(schema.queryResults).where(eq(schema.queryResults.sessionId, sessionId)).orderBy(desc(schema.queryResults.sequence)).limit(10);
    return results.map(({ data }) => ({ ref: data.ref, purpose: data.purpose, columns: data.columns, complete: data.complete }));
  }
  async finish(turnId: string, status: TerminalStatus, error: ApiError | null, usage: typeof schema.turns.$inferInsert.usage = null) {
    await this.db.update(schema.turns).set({ status, error, usage, finishedAt: new Date() }).where(and(eq(schema.turns.id, turnId), eq(schema.turns.status, "running")));
  }
  async complete(sessionId: string, turnId: string, content: Extract<MessageContent, { kind: "analysis" }>, usage: typeof schema.turns.$inferInsert.usage) {
    await this.db.transaction(async (tx) => {
      await tx.insert(schema.messages).values({ sessionId, turnId, content });
      await tx.update(schema.turns).set({ status: "completed", finishedAt: new Date(), usage }).where(and(eq(schema.turns.id, turnId), eq(schema.turns.status, "running")));
      await tx.update(schema.sessions).set({ updatedAt: new Date() }).where(eq(schema.sessions.id, sessionId));
    });
  }
  async recover() {
    await this.db.update(schema.turns).set({ status: "interrupted", finishedAt: new Date(), error: { code: "server_restart", message: "Server restarted; paid work was not replayed." } }).where(eq(schema.turns.status, "running"));
  }
}
export type AgentStore = Pick<Store, "history" | "append" | "saveResult" | "result" | "recentResults" | "finish" | "complete">;
