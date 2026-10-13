# Google login and chat privacy audit

Audited the local source and real-PostgreSQL HTTP tests on 2026-10-12.
This is an application audit, not a production penetration test.

## Finding: production database TLS skips certificate verification

Severity: medium, conditional on an attacker being able to intercept the
application-to-database connection.

`apps/api/src/config.ts:72` appends `sslmode=no-verify` to production database
URLs without an explicit SSL option. The node-postgres connection-string
[documentation](https://github.com/brianc/node-postgres/tree/master/packages/pg-connection-string#readme)
defines this as `rejectUnauthorized: false`. Encryption therefore does not
authenticate the database server. An interceptor could impersonate the server,
obtain database credentials, and read or alter chat and authentication records.
This is not an HTTP ownership bypass.

Reproduced by calling `readConfig` with synthetic production settings and a
database URL without SSL options. It returned
`postgresql://example.invalid/analytics?sslmode=no-verify`.

Recommendation: require certificate and hostname verification using the database
provider's trusted CA configuration. Explicit insecure URL options also currently
pass through unchanged. No configuration change was made during this audit.

Remediation implemented after the audit: the API and migrations now share an
explicit TLS configuration with `rejectUnauthorized: true` in production.
Insecure URL TLS overrides are rejected; an optional `DATABASE_SSL_CA` PEM
certificate supports a private CA. Real TCP/TLS tests confirm trusted matching
certificates connect, while untrusted certificates, hostname mismatches, and
plaintext-only servers fail before PostgreSQL startup. Deployment still requires
verification of the actual server certificate, hostname, and private networking;
see [deployment instructions](deployment.md#notes).

## Google login

No authentication bypass found in the inspected flow:

- Authorization code flow uses PKCE S256, random state, and random nonce.
- Callback requires a matching opaque HttpOnly cookie, matching state, and an
  unexpired attempt. Attempts are atomically deleted before code exchange.
- ID-token verification uses Google's library with the configured audience,
  followed by an explicit nonce and subject check.
- Accounts are keyed by Google subject, not email, consistent with
  [Google's OpenID Connect guidance](https://developers.google.com/identity/openid-connect/openid-connect).
- Guest transfer requires the same active guest credential, locks it, transfers
  chats transactionally, and revokes all credentials belonging to that guest.
- Credentials are random 256-bit tokens stored as SHA-256 hashes, with expiration
  and revocation checks. Production cookies are Secure, HttpOnly, and SameSite=Lax.
- Mutating API requests require the configured application Origin.

## Chat access

No cross-user HTTP access found in the inspected endpoints:

- Session lists are filtered by authenticated owner.
- History, saved results, and streamed turns require authentication and ownership.
  Other owners receive 404; unauthenticated requests receive 401.
- Result lookup also scopes references to the requested session.
- Turn creation rechecks ownership and active credentials within its transaction.
- Legacy chats without an owner are inaccessible through the HTTP API.
- API responses use Cache-Control: no-store. Browser persistent storage contains
  preferences, not transcripts; identity changes clear in-memory chat state.
- Logout revokes the presented credential and aborts its registered streams.

## Verification

Passed:

```text
pnpm --filter @analytics/api test src/auth.test.ts
1 file, 3 tests passed

pnpm --filter @analytics/api test:integration tests/integration/auth.test.ts
1 file, 11 tests passed
```

These cover unauthorized chat endpoints; guest and Google account isolation;
same-email Google subjects; state mismatch; expired attempts; replay; guest
credential mismatch; guest transfer; legacy chats; cookie attributes; invalid
Origins; expired/revoked credentials; and logout during streaming. External Google,
model, and warehouse services are scripted; the database and HTTP server are real.
The Google adapter unit tests mock token exchange and token verification, so they
verify delegation and nonce handling rather than Google's cryptography.

Not verified: a live Google consent/code exchange, OAuth console configuration,
deployed cookies/HTTPS/proxy behavior, database network exposure and TLS trust,
backups, or multi-process stream revocation. Existing authenticated requests can
finish across a concurrent logout; streams are checked at admission rather than
continuously reauthenticated. These checks do not establish protection against
stolen session cookies, privileged database access, or compromised infrastructure.
