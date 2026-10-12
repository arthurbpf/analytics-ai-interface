import { createHash, randomBytes } from "node:crypto";
import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import { and, eq, gt, isNull } from "drizzle-orm";
import { identitySchema, type Identity } from "@analytics/contracts";
import { RequestError, type Store } from "./db/store.ts";
import { authSessions, oauthAttempts, sessions, users } from "./db/schema.ts";

export const authLifetimeMs = 30 * 24 * 60 * 60 * 1000;
export const randomToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export type Authenticated = { identity: Identity; tokenHash: string };
export interface GoogleLogin {
  authorization(state: string, nonce: string): Promise<{ url: string; verifier: string }>;
  verify(
    code: string,
    verifier: string,
    nonce: string,
  ): Promise<{ subject: string; name: string | null; email: string | null }>;
}
export class GoogleOAuth implements GoogleLogin {
  private readonly client: OAuth2Client;
  private readonly clientId: string;
  constructor(clientId: string, secret: string, redirectUri: string) {
    this.clientId = clientId;
    this.client = new OAuth2Client({ clientId, clientSecret: secret, redirectUri });
  }
  async authorization(state: string, nonce: string) {
    const codes = await this.client.generateCodeVerifierAsync();
    return {
      verifier: codes.codeVerifier,
      url: this.client.generateAuthUrl({
        scope: ["openid", "email", "profile"],
        state,
        nonce,
        ...(codes.codeChallenge ? { code_challenge: codes.codeChallenge } : {}),
        code_challenge_method: CodeChallengeMethod.S256,
      }),
    };
  }
  async verify(code: string, verifier: string, nonce: string) {
    const { tokens } = await this.client.getToken({ code, codeVerifier: verifier });
    if (!tokens.id_token) {
      throw new Error("Google did not return an ID token");
    }
    const ticket = await this.client.verifyIdToken({
      idToken: tokens.id_token,
      audience: this.clientId,
    });
    const payload = ticket.getPayload();
    if (!payload || payload.nonce !== nonce || !payload.sub) {
      throw new Error("Invalid Google identity");
    }
    return { subject: payload.sub, name: payload.name ?? null, email: payload.email ?? null };
  }
}
export class AuthStore {
  private readonly store: Store;
  constructor(store: Store) {
    this.store = store;
  }
  async authenticate(token: string | undefined): Promise<Authenticated | null> {
    if (!token) {
      return null;
    }
    const tokenHash = hashToken(token);
    const [row] = await this.store.db
      .select({ user: users })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .where(
        and(
          eq(authSessions.tokenHash, tokenHash),
          isNull(authSessions.revokedAt),
          gt(authSessions.expiresAt, new Date()),
        ),
      );
    return row ? { identity: identitySchema.parse(row.user), tokenHash } : null;
  }
  async guest() {
    const token = randomToken();
    const identity = await this.store.db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({ kind: "guest" }).returning();
      if (!user) {
        throw new Error("Guest insert failed");
      }
      await tx.insert(authSessions).values({
        tokenHash: hashToken(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + authLifetimeMs),
      });
      return identitySchema.parse(user);
    });
    return { token, identity };
  }
  async revoke(tokenHash: string) {
    await this.store.db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(eq(authSessions.tokenHash, tokenHash));
  }
  async begin(google: GoogleLogin, current: Authenticated | null) {
    const token = randomToken();
    const state = randomToken();
    const nonce = randomToken();
    const { url, verifier } = await google.authorization(state, nonce);
    await this.store.db.insert(oauthAttempts).values({
      tokenHash: hashToken(token),
      stateHash: hashToken(state),
      nonce,
      verifier,
      guestTokenHash: current?.identity.kind === "guest" ? current.tokenHash : null,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    return { token, url };
  }
  async login(
    google: GoogleLogin,
    attemptToken: string | undefined,
    state: string,
    code: string,
    current: Authenticated | null,
  ) {
    if (!attemptToken) {
      throw new RequestError(400, "login_failed", "Google login could not be verified");
    }
    // Consume before exchanging the code: callbacks cannot replay paid or identity work.
    const [attempt] = await this.store.db
      .delete(oauthAttempts)
      .where(eq(oauthAttempts.tokenHash, hashToken(attemptToken)))
      .returning();
    if (
      !attempt ||
      attempt.expiresAt <= new Date() ||
      attempt.stateHash !== hashToken(state) ||
      (attempt.guestTokenHash !== null && attempt.guestTokenHash !== current?.tokenHash)
    ) {
      throw new RequestError(400, "login_failed", "Google login could not be verified");
    }
    const profile = await google.verify(code, attempt.verifier, attempt.nonce);
    const token = randomToken();
    const identity = await this.store.db.transaction(async (tx) => {
      // Lock the guest credential before transferring; mutations lock the same credential.
      let guestId: string | null = null;
      if (attempt.guestTokenHash) {
        const [guest] = await tx
          .select()
          .from(authSessions)
          .where(
            and(
              eq(authSessions.tokenHash, attempt.guestTokenHash),
              isNull(authSessions.revokedAt),
              gt(authSessions.expiresAt, new Date()),
            ),
          )
          .for("update");
        if (!guest || guest.userId !== current?.identity.id || current.identity.kind !== "guest") {
          throw new RequestError(400, "login_failed", "Guest session expired during login");
        }
        guestId = guest.userId;
      }
      const [user] = await tx
        .insert(users)
        .values({
          kind: "google",
          googleSubject: profile.subject,
          name: profile.name,
          email: profile.email,
        })
        .onConflictDoUpdate({
          target: users.googleSubject,
          set: { name: profile.name, email: profile.email },
        })
        .returning();
      if (!user) {
        throw new Error("Account insert failed");
      }
      if (guestId) {
        await tx.update(sessions).set({ ownerId: user.id }).where(eq(sessions.ownerId, guestId));
        await tx
          .update(authSessions)
          .set({ revokedAt: new Date() })
          .where(eq(authSessions.userId, guestId));
      }
      await tx.insert(authSessions).values({
        tokenHash: hashToken(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + authLifetimeMs),
      });
      return identitySchema.parse(user);
    });
    return { token, identity };
  }
}
