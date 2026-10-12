# Data Analytics

React + Vite + TanStack Router frontend and Node.js + Express backend, managed
with pnpm workspaces and Turborepo. The backend implements durable analytics
conversations and streamed chart/analysis artifacts. The frontend provides a
chat page with shadcn/ui Lyra components, saved sessions, and charts. JSON API
requests use ts-rest contracts; narrative drafts and charts stream over SSE.

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

- `apps/api/src/agent`: sequential tool loop, bounded context, validated presentation.
- `apps/api/src/analytics`: definitions, SQL guardrails, budgets, BigQuery execution.
- `apps/api/src/llm`: OpenRouter adapter.
- `apps/api/src/db` and `apps/api/drizzle`: PostgreSQL store and migrations.
- `apps/api/src/http`: SSE cancellation and backpressure.
- `packages/contracts`: shared Zod schemas, TypeScript types, and stream reader.

Create a session with `POST /api/sessions`. Submit
`{ "clientTurnId": "<uuid>", "message": "<question>" }` to
`POST /api/sessions/:id/turns` and consume SSE with the shared `readEvents` helper.
`chart_ready` contains chart mappings and saved rows; `analysis_ready` contains
structured final narrative. Retrieve history with `GET /api/sessions/:id` and
results with `GET /api/sessions/:id/results/:ref`.

Only one turn may run per session. Duplicate client turn IDs return 409.
Disconnects cancel work while preserving saved artifacts; startup marks abandoned
turns interrupted. Retention/deletion policy is not implemented yet.

Default caps: 1 GiB/query, 5 GiB/turn, 5 SQL executions, 8 model calls, 4 charts,
120 seconds, 4,096 output tokens/call, 128 KiB model input, and 500 rows,
32 columns, and 64 KiB per result. Byte caps are provisional and configurable in
`.env`; live dataset calibration remains pending. Incomplete results cannot
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
unverified. Railway is the hosting target; deployment, backups, authentication,
and vector retrieval remain unimplemented. The current API
binds to loopback and does not serve the built frontend.
