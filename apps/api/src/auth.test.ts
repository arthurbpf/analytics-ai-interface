import { createHash } from "node:crypto";
import { OAuth2Client, LoginTicket, type TokenPayload } from "google-auth-library";
import { afterEach, expect, it, vi } from "vitest";
import { GoogleOAuth } from "./auth.ts";
afterEach(() => vi.restoreAllMocks());
// Narrow the SDK's overloaded methods to the promise signatures used by the adapter.
const promiseClient: {
  getToken(options: {
    code: string;
    codeVerifier?: string;
  }): Promise<{ tokens: { id_token?: string | null } }>;
  verifyIdToken(options: { idToken: string; audience: string }): Promise<LoginTicket>;
} = OAuth2Client.prototype;
const payload: TokenPayload = {
  iss: "https://accounts.google.com",
  aud: "client",
  sub: "stable-subject",
  iat: 100,
  exp: 200,
  nonce: "nonce",
  name: "Person",
  email: "person@example.test",
};
it("uses PKCE S256, state and nonce on Google's authorization URL", async () => {
  const google = new GoogleOAuth("client", "secret", "http://localhost/callback");
  const result = await google.authorization("state", "nonce");
  const url = new URL(result.url);
  expect(url.searchParams.get("state")).toBe("state");
  expect(url.searchParams.get("nonce")).toBe("nonce");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("code_challenge")).toBe(
    createHash("sha256").update(result.verifier).digest("base64url"),
  );
});
it("exchanges with the verifier and verifies the ID token for the configured audience", async () => {
  const exchange = vi
    .spyOn(promiseClient, "getToken")
    .mockResolvedValue({ tokens: { id_token: "signed-token" } });
  const verify = vi
    .spyOn(promiseClient, "verifyIdToken")
    .mockResolvedValue(new LoginTicket("header", payload));
  const google = new GoogleOAuth("client", "secret", "http://localhost/callback");
  expect(await google.verify("code", "verifier", "nonce")).toEqual({
    subject: "stable-subject",
    name: "Person",
    email: "person@example.test",
  });
  expect(exchange).toHaveBeenCalledWith({ code: "code", codeVerifier: "verifier" });
  expect(verify).toHaveBeenCalledWith({ idToken: "signed-token", audience: "client" });
});
it("rejects nonce mismatch, missing tokens, and ID-token validation failures", async () => {
  const exchange = vi
    .spyOn(promiseClient, "getToken")
    .mockResolvedValue({ tokens: { id_token: "token" } });
  const verify = vi
    .spyOn(promiseClient, "verifyIdToken")
    .mockResolvedValue(new LoginTicket("header", payload));
  const google = new GoogleOAuth("client", "secret", "http://localhost/callback");
  await expect(google.verify("code", "verifier", "wrong")).rejects.toThrow(
    "Invalid Google identity",
  );
  verify.mockRejectedValue(new Error("Invalid signature or expired token"));
  await expect(google.verify("code", "verifier", "nonce")).rejects.toThrow("Invalid signature");
  exchange.mockResolvedValue({ tokens: {} });
  await expect(google.verify("code", "verifier", "nonce")).rejects.toThrow("ID token");
});
