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
  type PublishedChart,
  type TerminalStatus,
} from "@analytics/contracts";
import * as schema from "./schema.ts";

/**
 * Error carrying an HTTP status and machine code for API responses.
 */
export class RequestError extends Error {
  readonly status: number;
  readonly code: string;

  /**
   * Creates a request error.
   *
   * @param status - HTTP status code to return.
   * @param code - Stable machine-readable error code.
   * @param message - Human-readable message.
   */
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
/**
 * PostgreSQL-backed store for sessions, turns, messages, and query results.
 */
export class Store {
  readonly pool: Pool;
  readonly db;

  /**
   * Creates a store over a connection pool.
   *
   * @param url - PostgreSQL connection string.
   */
  constructor(url: string) {
    this.pool = new Pool({ connectionString: url, max: 5 });
    this.db = drizzle({ client: this.pool, schema });
  }

  /**
   * Creates a new session, optionally bound to a credential.
   *
   * @param ownerId - Owner to assign, if any.
   * @param tokenHash - Credential hash to validate before creating.
   * @returns The created session.
   */
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
  /**
   * Validates that a credential is active, rejecting revoked or expired tokens.
   *
   * @param tx - Transaction used for the lookup.
   * @param tokenHash - Hash of the presented credential token.
   * @throws When the credential is missing, revoked, or expired.
   */
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
  /**
   * Asserts that a session belongs to the given owner.
   *
   * @param sessionId - Session to check.
   * @param ownerId - Owner the session must belong to.
   * @throws When the session does not exist for this owner.
   */
  async assertOwner(sessionId: string, ownerId: string) {
    const [session] = await this.db
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.ownerId, ownerId)));
    if (!session) {
      throw new RequestError(404, "not_found", "Session not found");
    }
  }
  /**
   * Lists a user's sessions, newest first, with a running-turn flag.
   *
   * @param ownerId - Owner whose sessions to list.
   * @returns The owner's sessions.
   */
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
  /**
   * Returns display-safe history for a session.
   *
   * @param sessionId - Session to load.
   * @returns History containing only messages safe to display.
   */
  async history(sessionId: string) {
    return historySchema.parse(displayHistory(await this.agentHistory(sessionId)));
  }
  /**
   * Loads full stored history, including backend-only protocol and review records.
   *
   * @param sessionId - Session to load.
   * @returns The session, its turns, and its stored messages.
   * @throws When the session does not exist.
   */
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
  /**
   * Starts a new turn, enforcing credential, ownership, and one-active-turn rules.
   *
   * Records the user message and schedules a title attempt on the first and third prompts.
   *
   * @param sessionId - Session receiving the turn.
   * @param clientTurnId - Client-supplied idempotency key for the turn.
   * @param message - User prompt text.
   * @param ownerId - Owner that must own the session, if enforced.
   * @param tokenHash - Credential hash to validate, if presented.
   * @returns The created turn and any scheduled title attempt.
   * @throws When the credential, session, or turn state is invalid.
   */
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
  /**
   * Appends a stored message to a turn.
   *
   * @param sessionId - Owning session.
   * @param turnId - Turn the message belongs to.
   * @param content - Stored message content.
   */
  async append(sessionId: string, turnId: string, content: StoredMessageContent) {
    await this.db.insert(schema.messages).values({ sessionId, turnId, content });
  }
  /**
   * Persists a query result under its opaque reference.
   *
   * @param sessionId - Owning session.
   * @param turnId - Turn that produced the result.
   * @param data - Query result to save.
   */
  async saveResult(sessionId: string, turnId: string, data: QueryResult) {
    await this.db.insert(schema.queryResults).values({ ref: data.ref, sessionId, turnId, data });
  }
  /**
   * Loads a saved query result scoped to its owning session.
   *
   * @param sessionId - Session that must own the result.
   * @param ref - Opaque result reference.
   * @returns The stored query result.
   * @throws When the result does not exist for this session.
   */
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
  /**
   * Loads summaries of the ten most recent results for a session.
   *
   * @param sessionId - Session to inspect.
   * @returns Recent result summaries, newest first.
   */
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
  /**
   * Marks a running turn terminal with its status, error, and usage.
   *
   * @param turnId - Turn to finish.
   * @param status - Terminal status to record.
   * @param error - Error to store, or null on success.
   * @param usage - Accumulated usage to store.
   */
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
  /**
   * Atomically completes a running turn and stores its answer and charts.
   *
   * @param sessionId - Owning session.
   * @param turnId - Turn to complete.
   * @param content - Final analysis or clarification content.
   * @param usage - Accumulated usage to store.
   * @param charts - Charts to persist alongside the answer.
   * @throws When the turn is no longer running.
   */
  async complete(
    sessionId: string,
    turnId: string,
    content: Extract<StoredMessageContent, { kind: "analysis" | "clarification" }>,
    usage: typeof schema.turns.$inferInsert.usage,
    charts: PublishedChart[] = [],
  ) {
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(schema.turns)
        .set({ status: "completed", finishedAt: new Date(), usage })
        .where(
          and(
            eq(schema.turns.id, turnId),
            eq(schema.turns.sessionId, sessionId),
            eq(schema.turns.status, "running"),
          ),
        )
        .returning({ id: schema.turns.id });
      if (!updated.length) {
        throw new RequestError(409, "turn_finished", "Turn is no longer running");
      }
      for (const chart of charts) {
        await tx.insert(schema.messages).values({
          sessionId,
          turnId,
          content: { kind: "chart", chart },
        });
      }
      await tx.insert(schema.messages).values({ sessionId, turnId, content });
      await tx
        .update(schema.sessions)
        .set({ updatedAt: new Date() })
        .where(eq(schema.sessions.id, sessionId));
    });
  }
  /**
   * Resolves a pending title attempt, storing the title when generation succeeded.
   *
   * @param sessionId - Owning session.
   * @param revision - Title revision the attempt belongs to.
   * @param title - Generated title, or null when generation failed.
   * @param usage - Title-model usage to store.
   * @returns The updated session, or null when the attempt was already resolved.
   */
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
  /**
   * Recovers from a restart by failing pending title work and interrupting running turns.
   *
   * Paid work is never replayed automatically; interrupted turns are marked as such.
   */
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
        error: {
          code: "server_restart",
          message: "Server restarted; paid work was not replayed.",
        },
      })
      .where(eq(schema.turns.status, "running"));
  }
}
export type AgentStore = Pick<
  Store,
  "agentHistory" | "append" | "saveResult" | "result" | "recentResults" | "finish" | "complete"
>;
