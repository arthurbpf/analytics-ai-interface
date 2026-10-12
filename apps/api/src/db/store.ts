import { displayHistory, type AgentHistory, type StoredMessageContent } from "./history.ts";
import { and, asc, desc, eq, gt, isNull, sql, getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  historySchema,
  queryResultSchema,
  sessionSchema,
  turnSchema,
  type ApiError,
  type QueryResult,
  type TerminalStatus,
} from "@analytics/contracts";
import * as schema from "./schema.ts";

export class RequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export class Store {
  readonly pool: Pool;
  readonly db;
  constructor(url: string) {
    this.pool = new Pool({ connectionString: url, max: 5 });
    this.db = drizzle({ client: this.pool, schema });
  }
  async createSession(ownerId?: string, tokenHash?: string) {
    const [session] = await this.db.transaction(async (tx) => {
      if (tokenHash) {
        await this.checkCredential(tx, tokenHash);
      }
      return tx.insert(schema.sessions).values({ ownerId }).returning();
    });
    if (!session) {
      throw new Error("Session insert failed");
    }
    return sessionSchema.parse({
      ...session,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    });
  }
  private async checkCredential(
    tx: Parameters<Parameters<typeof this.db.transaction>[0]>[0],
    tokenHash: string,
  ) {
    const [credential] = await tx
      .select()
      .from(schema.authSessions)
      .where(
        and(
          eq(schema.authSessions.tokenHash, tokenHash),
          isNull(schema.authSessions.revokedAt),
          gt(schema.authSessions.expiresAt, new Date()),
        ),
      )
      .for("share");
    if (!credential) {
      throw new RequestError(401, "unauthenticated", "Please sign in or continue as guest");
    }
  }
  async assertOwner(sessionId: string, ownerId: string) {
    const [session] = await this.db
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.ownerId, ownerId)));
    if (!session) {
      throw new RequestError(404, "not_found", "Session not found");
    }
  }
  async listSessions(ownerId: string) {
    const rows = await this.db
      .select({
        ...getTableColumns(schema.sessions),
        runningTurn: sql<boolean>`exists (select 1 from turns where turns."sessionId" = sessions.id and turns.status = 'running')`,
      })
      .from(schema.sessions)
      .where(eq(schema.sessions.ownerId, ownerId))
      .orderBy(desc(schema.sessions.updatedAt), desc(schema.sessions.id));
    return rows.map((row) =>
      sessionSchema.parse({
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }),
    );
  }
  async history(sessionId: string) {
    return historySchema.parse(displayHistory(await this.agentHistory(sessionId)));
  }
  async agentHistory(sessionId: string): Promise<AgentHistory> {
    const [session] = await this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId));
    if (!session) {
      throw new RequestError(404, "not_found", "Session not found");
    }
    const turnRows = await this.db
      .select()
      .from(schema.turns)
      .where(eq(schema.turns.sessionId, sessionId))
      .orderBy(asc(schema.turns.createdAt), asc(schema.turns.id));
    const messageRows = await this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.sessionId, sessionId))
      .orderBy(asc(schema.messages.sequence));
    return {
      session: sessionSchema.parse({
        ...session,
        runningTurn: turnRows.some((turn) => turn.status === "running"),
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
      }),
      turns: turnRows.map((turn) =>
        turnSchema.parse({
          ...turn,
          createdAt: turn.createdAt.toISOString(),
          finishedAt: turn.finishedAt?.toISOString() ?? null,
        }),
      ),
      messages: messageRows.map((message) => ({
        id: message.id,
        turnId: message.turnId,
        content: message.content,
      })),
    };
  }
  async startTurn(
    sessionId: string,
    clientTurnId: string,
    message: string,
    ownerId?: string,
    tokenHash?: string,
  ) {
    return this.db.transaction(async (tx) => {
      if (tokenHash) {
        await this.checkCredential(tx, tokenHash);
      }
      const [session] = await tx
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .for("update");
      if (!session || (ownerId && session.ownerId !== ownerId)) {
        throw new RequestError(404, "not_found", "Session not found");
      }
      const [existing] = await tx
        .select()
        .from(schema.turns)
        .where(
          and(eq(schema.turns.sessionId, sessionId), eq(schema.turns.clientTurnId, clientTurnId)),
        );
      if (existing) {
        throw new RequestError(
          409,
          "duplicate_turn",
          `Turn already exists: ${existing.id}. Retrieve session history.`,
        );
      }
      const [running] = await tx
        .select()
        .from(schema.turns)
        .where(and(eq(schema.turns.sessionId, sessionId), eq(schema.turns.status, "running")));
      if (running) {
        throw new RequestError(409, "turn_running", "A turn is already running");
      }
      const [turn] = await tx.insert(schema.turns).values({ sessionId, clientTurnId }).returning();
      if (!turn) {
        throw new Error("Turn insert failed");
      }
      await tx.insert(schema.messages).values({
        sessionId,
        turnId: turn.id,
        content: { kind: "model", message: { role: "user", content: message } },
      });
      const count = session.userMessageCount + 1;
      const revision = count === 1 || count === 3 ? count : null;
      let titleAttempt: { revision: number; prompts: string[] } | null = null;
      if (revision) {
        const rows = await tx
          .select()
          .from(schema.messages)
          .where(eq(schema.messages.sessionId, sessionId))
          .orderBy(asc(schema.messages.sequence));
        const prompts = rows.flatMap(({ content }) =>
          content.kind === "model" && content.message.role === "user"
            ? [content.message.content]
            : [],
        );
        titleAttempt = { revision, prompts: prompts.slice(0, 3) };
        await tx.insert(schema.titleAttempts).values({ sessionId, revision, status: "pending" });
      }
      await tx
        .update(schema.sessions)
        .set({
          updatedAt: new Date(),
          userMessageCount: count,
          ...(revision ? { titleStatus: "pending" as const, titleRevision: revision } : {}),
          ...(count === 1 ? { title: message.replace(/\s+/g, " ").slice(0, 60) } : {}),
        })
        .where(eq(schema.sessions.id, sessionId));
      return {
        ...turnSchema.parse({
          ...turn,
          createdAt: turn.createdAt.toISOString(),
          finishedAt: null,
        }),
        titleAttempt,
      };
    });
  }
  async append(sessionId: string, turnId: string, content: StoredMessageContent) {
    await this.db.insert(schema.messages).values({ sessionId, turnId, content });
  }
  async saveResult(sessionId: string, turnId: string, data: QueryResult) {
    await this.db.insert(schema.queryResults).values({ ref: data.ref, sessionId, turnId, data });
  }
  async result(sessionId: string, ref: string) {
    const [result] = await this.db
      .select()
      .from(schema.queryResults)
      .where(and(eq(schema.queryResults.sessionId, sessionId), eq(schema.queryResults.ref, ref)));
    if (!result) {
      throw new RequestError(404, "not_found", "Result not found");
    }
    return queryResultSchema.parse(result.data);
  }
  async recentResults(sessionId: string) {
    const results = await this.db
      .select()
      .from(schema.queryResults)
      .where(eq(schema.queryResults.sessionId, sessionId))
      .orderBy(desc(schema.queryResults.sequence))
      .limit(10);
    return results.map(({ data }) => ({
      ref: data.ref,
      purpose: data.purpose,
      columns: data.columns,
      complete: data.complete,
    }));
  }
  async finish(
    turnId: string,
    status: TerminalStatus,
    error: ApiError | null,
    usage: typeof schema.turns.$inferInsert.usage = null,
  ) {
    await this.db
      .update(schema.turns)
      .set({ status, error, usage, finishedAt: new Date() })
      .where(and(eq(schema.turns.id, turnId), eq(schema.turns.status, "running")));
  }
  async complete(
    sessionId: string,
    turnId: string,
    content: Extract<StoredMessageContent, { kind: "analysis" }>,
    usage: typeof schema.turns.$inferInsert.usage,
  ) {
    await this.db.transaction(async (tx) => {
      await tx.insert(schema.messages).values({ sessionId, turnId, content });
      await tx
        .update(schema.turns)
        .set({ status: "completed", finishedAt: new Date(), usage })
        .where(and(eq(schema.turns.id, turnId), eq(schema.turns.status, "running")));
      await tx
        .update(schema.sessions)
        .set({ updatedAt: new Date() })
        .where(eq(schema.sessions.id, sessionId));
    });
  }
  async finishTitle(
    sessionId: string,
    revision: number,
    title: string | null,
    usage: typeof schema.titleAttempts.$inferInsert.usage,
  ) {
    return this.db.transaction(async (tx) => {
      const status = title ? "succeeded" : "failed";
      const attempts = await tx
        .update(schema.titleAttempts)
        .set({ status, usage })
        .where(
          and(
            eq(schema.titleAttempts.sessionId, sessionId),
            eq(schema.titleAttempts.revision, revision),
            eq(schema.titleAttempts.status, "pending"),
          ),
        )
        .returning();
      if (!attempts.length) {
        return null;
      }
      const [row] = await tx
        .update(schema.sessions)
        .set({ titleStatus: status, ...(title ? { title } : {}) })
        .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.titleRevision, revision)))
        .returning();
      return row
        ? sessionSchema.parse({
            ...row,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          })
        : null;
    });
  }
  async recover() {
    await this.db
      .update(schema.titleAttempts)
      .set({ status: "failed" })
      .where(eq(schema.titleAttempts.status, "pending"));
    await this.db
      .update(schema.sessions)
      .set({ titleStatus: "failed" })
      .where(eq(schema.sessions.titleStatus, "pending"));
    await this.db
      .update(schema.turns)
      .set({
        status: "interrupted",
        finishedAt: new Date(),
        error: { code: "server_restart", message: "Server restarted; paid work was not replayed." },
      })
      .where(eq(schema.turns.status, "running"));
  }
}
export type AgentStore = Pick<
  Store,
  "agentHistory" | "append" | "saveResult" | "result" | "recentResults" | "finish" | "complete"
>;
