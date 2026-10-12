# Data Analytics

React + Vite + TanStack Router frontend and Node.js + Express backend, managed
with pnpm workspaces and Turborepo. The backend implements durable analytics
conversations and streamed chart/analysis artifacts. The frontend provides a
chat page with shadcn/ui Lyra components, private sessions, Markdown, and charts. JSON API
requests use ts-rest contracts; progress and approved answers/charts arrive over SSE.

## Development

Install Nix, devenv, and direnv, with the direnv hook enabled in your shell.
From this directory:

```sh
direnv allow
pnpm install
pnpm --filter @analytics/contracts build
cp .env.example .env
devenv up postgres
```

Entering the devenv shell installs a pre-commit hook that runs `pnpm format:check`.
If it fails, run `pnpm format`, review and stage the changes, then commit again.

Leave PostgreSQL running. In another shell, populate `.env` with OpenRouter
credentials, a tool-capable model, and a Google Cloud billing project. Configure
Google Application Default Credentials or a service-account file as described
in [.env.example](.env.example), then run:

```sh
pnpm --filter @analytics/api db:migrate
pnpm dev
```

Alternatively, enter `devenv shell` before running the pnpm commands.
The shell provides Node.js 24 LTS, pnpm, Git, nixfmt, and ShellCheck. JavaScript
tooling comes from workspace dependencies, keeping CLI and editor versions
aligned. The shell also supplies Chromium and sets
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` for Playwright; no browser download is needed.
PostgreSQL 16 includes pgvector and initializes `analytics` and `analytics_test`.
Both apps use TypeScript 7.0.2 through the shared pnpm catalog and override.

The frontend runs at http://localhost:5173. The backend listens at
http://127.0.0.1:3001/api/health; Vite proxies `/api` requests to it during development.

## Google login and private conversations

Set `APP_ORIGIN` to the browser's exact origin (local default:
`http://localhost:5173`). In the [Google Cloud console](https://console.cloud.google.com/apis/credentials),
configure an OAuth consent screen and a **Web application** OAuth client. For open
signup, allow external users and publish the consent screen; a consent screen in
testing mode only permits configured test users. Register the exact authorized
redirect URI `http://localhost:5173/api/auth/google/callback` for local development,
or `<APP_ORIGIN>/api/auth/google/callback` for the deployed application. Set
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the server environment. Keep
those credentials separate from BigQuery credentials. Leaving both blank enables
guest-only local use.

The login routes are `GET /api/auth/google` and `GET /api/auth/google/callback`.
Login uses an authorization code, PKCE S256, state, nonce, and server-verified ID
tokens; Google's stable subject identifies the account. See the
[official Google OAuth library](https://github.com/googleapis/google-auth-library-nodejs)
and [Google's OpenID Connect setup guide](https://developers.google.com/identity/openid-connect/openid-connect).
`GET /api/auth/me` returns the current identity, and `POST /api/auth/logout`
revokes its credential. Guests use the full analytics pipeline and existing budgets.

Random authentication cookies are HttpOnly, SameSite=Lax, and persist for a fixed
30 days; PostgreSQL stores only their hashes. In production, set
`NODE_ENV=production` and an explicit HTTPS `APP_ORIGIN` to enable Secure cookies.
Logout clears the cookie, stops that browser's streams, and clears cached chats.
Signing in transfers the current guest's conversations into the Google account
transactionally and revokes the guest's credentials. Failed login preserves guest
access. Guest chats cannot be recovered after their cookie expires or is lost.

Every chat endpoint requires an identity and checks ownership. Missing credentials
receive 401, and another person's chat or result receives 404. Sidebar discovery
comes from PostgreSQL. localStorage stores only identity-scoped selection and sidebar
preferences; previous unscoped browser indexes are discarded. Existing chats migrated
without an owner retain their contents but are inaccessible through the chat API.

Titles use `OPENROUTER_TITLE_MODEL` (default:
[`anthropic/claude-haiku-4.5`](https://openrouter.ai/anthropic/claude-haiku-4.5)) with
the existing OpenRouter key. Requests run independently after persisted prompts 1 and
3, using at most 100 output tokens and 10 seconds. The first prompt supplies an
immediate excerpt; failures retain that excerpt or the previous title. Attempt status,
revision, and title model usage are recorded separately from analytics. Duplicate
submissions and restarts do not retry title requests. Pending titles are refreshed
every two seconds, including after the analysis stream closes.

Assistant narratives and caveats share a Markdown renderer with
GFM tables and fenced code. Raw HTML and embedded images are disabled, safe URL
handling remains enabled, and wide tables/code scroll horizontally. User prompts
remain literal text.

## Analytical review

Risky analyses are checked by a separate reviewer before publication.
The reviewer runs for custom SQL, multiple results, charts, time series, filters,
ranked results, multi-dimension results, and rate/comparison-style catalog metrics.
It skips explanations without query evidence and a simple single-result catalog
aggregate with at most one dimension. `OPENROUTER_REVIEW_MODEL` selects the reviewer
model (configured locally as `openai/gpt-5.6-terra`); otherwise it uses
`OPENROUTER_MODEL`. The reviewer reads the request/context, saved SQL and complete
referenced evidence, metric definitions, and chart specifications. It returns
approval or concrete analytical issues without execution tools.

A rejection permits two analyst calls to repair the answer, including queries
within the remaining warehouse budget, then one final review. Eight initial analyst
calls, two repair calls, and two reviews share the two-minute deadline. Clarification
turns bypass review. Review failure or a second rejection publishes no answer.
Progress remains visible, while narrative drafts and candidate charts stay private.
Approved answers and their selected charts publish in one database transaction.
Review records and analyst/reviewer usage are saved for diagnosis and evaluation;
interrupted work is never automatically replayed. No new database migration is needed.

Review is an additional fallible check, not proof of analytical correctness. Live
comparison commands write separate baseline and reviewed artifacts:

```sh
pnpm --filter @analytics/api test:evaluation
ANALYTICS_EVALUATION_MODE=baseline pnpm --filter @analytics/api test:evaluation tests/evaluation/routing.test.ts
```

The review-specific evaluation uses controlled synthetic evidence, scripted
candidates/repairs, and a live reviewer. The routing evaluation uses live analyst,
reviewer, and BigQuery calls. Both require configured credentials and incur service
costs. Run PostgreSQL integration and browser suites sequentially: they share the
test database, and startup recovery interrupts running turns.

## Checks

```sh
pnpm check           # Formatting, lint, type checks, and builds
pnpm lint:fix       # Safe lint fixes
pnpm format         # Format supported files with Oxfmt
nixfmt --check devenv.nix
shellcheck .envrc
pnpm --filter @analytics/api test
pnpm --filter @analytics/web test
pnpm --filter @analytics/api test:integration
pnpm --filter @analytics/api test:e2e
```

Oxlint enables correctness and suspicious rules as errors, plus explicit rules
for unsafe TypeScript, unchecked promises, exhaustive switches, import cycles,
React hooks, and accessibility. Type-aware rules use `oxlint-tsgolint`; ordinary
type checks use the pinned TypeScript compiler. Type assertions and explicit
`any` are prohibited; use narrowing, annotations, or `satisfies` instead.
Formatting belongs to Oxfmt. The original exercise and architecture documents
are excluded to preserve the supplied references.

Builds and checks are cached by Turborepo. Development servers and lint fixes
are never cached. Add shared packages under `packages/` when there is code to share.

The dependency and devenv lockfiles are included. CI installs should use
`pnpm install --frozen-lockfile`.

## Backend

- `apps/api/src/agent`: sequential analyst loop, bounded review, validated presentation.
- `apps/api/src/analytics`: definitions, SQL guardrails, budgets, BigQuery execution.
- `apps/api/src/llm`: OpenRouter adapter.
- `apps/api/src/db` and `apps/api/drizzle`: PostgreSQL store and migrations.
- `apps/api/src/http`: SSE cancellation and backpressure.
- `packages/contracts`: shared Zod schemas, TypeScript types, and stream reader.

Authenticate with Google or start a guest identity with `POST /api/auth/guest`.
State-changing requests must include an `Origin` header matching `APP_ORIGIN`,
and chat requests must carry the authentication cookie. List your chats with
`GET /api/sessions` and create a session with `POST /api/sessions`. Submit
`{ "clientTurnId": "<uuid>", "message": "<question>" }` to
`POST /api/sessions/:id/turns` and consume SSE with the shared `readEvents` helper.
`chart_ready` contains chart mappings and saved rows; `analysis_ready` contains
structured final narrative. Retrieve history with `GET /api/sessions/:id` and
results with `GET /api/sessions/:id/results/:ref`.

Multiple sessions may run simultaneously; each session permits only one running
turn. Duplicate client turn IDs return 409.
Disconnects cancel work while preserving saved artifacts; startup marks abandoned
turns interrupted. Retention/deletion policy is not implemented yet.

Default caps: 2 GiB/catalog query, 1 GiB/ad-hoc query, one 5 GiB/turn ledger, 5 SQL executions, 8 model calls, 4 charts,
120 seconds, 4,096 output tokens/call, 128 KiB model input, and 500 rows,
32 columns, and 64 KiB per result. Byte caps are provisional and configurable in
`.env`. Representative scan estimates and live verification are recorded in
`docs/live-catalog-results.json`. Full-history session construction scans the
whole available history even for a narrower reporting period. Incomplete results cannot
support charts or final presentation. Model usage is recorded separately;
there is no dollar-denominated LLM spending cap.

Integration and browser tests require PostgreSQL and use `TEST_DATABASE_URL`,
whose database name must end in `_test`. External services are scripted fixtures;
these suites make no paid API calls. Outside devenv, install Chromium with
`pnpm --filter @analytics/api exec playwright install chromium`, or set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

See [docs/frontend-test-cases.md](docs/frontend-test-cases.md) for frontend coverage
and [docs/backend-test-cases.md](docs/backend-test-cases.md) for acceptance cases
and verification status. Live analytics accuracy and cost calibration remain
unverified. Railway is the hosting target; see [docs/deployment.md](docs/deployment.md)
for the deployment runbook. Backups, retention, and vector retrieval remain
open work.
