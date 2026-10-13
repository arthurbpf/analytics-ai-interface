# Engineering principles

Optimize for correct, minimal, maintainable code. Fewer lines that clearly solve
the problem beat more lines that almost do.

- Think before coding. State assumptions that would be expensive to unwind.
  Ask when different interpretations lead to materially different work.
  If something is unclear, stop and name exactly what is confusing.
  Push back before implementing when a simpler approach exists.
- Write only what the task requires. No speculative features, configurability,
  single-use abstractions, premature generalization, or handling impossible errors.
- Extract shared helpers when a change introduces near-duplicate logic, but do
  not force reuse across layer boundaries or import heavy module graphs just to
  share a small function. Explain correctly layered duplication when necessary.
- Make surgical changes. Match surrounding style. Remove orphans created by the
  change; leave pre-existing dead code alone and mention it.
- Turn tasks into verifiable outcomes. Reproduce bugs before fixing them. For
  multi-step work, explain the steps and their checks; skip plans for single edits.
  Confirm tests before and after refactors. Use meaningful tests for validation
  and bugs. Report failed or skipped checks honestly; never claim an unrun check
  passed.
- Base library behavior claims on official documentation, not dependency
  internals. If documentation is silent, report the behavior as unsupported.
- TypeScript: no `any`, `as unknown as`, `as never`, or type hacks. Use try/catch,
  never `.catch(() => …)`. Use native Date or date-fns, never moment.
- Delete removed code cleanly, without tombstone comments. Put rationale in the
  commit message.
- Prefer caution when speed and caution conflict, with judgment for trivial work.
  Before finishing, simplify anything a senior engineer would call overcomplicated.
- Document every named function, method, and class with TSDoc: a summary line,
  `@param name - description` for each parameter, and `@returns` when a value is
  returned. Add `@throws` only for deliberate throws. Do not add `{type}` tags
  (TypeScript signatures carry types) or document inline callbacks. This is
  enforced by `jsdoc-js/require-jsdoc`; keep written docs complete
  (`jsdoc/require-param`, `jsdoc/require-returns`).
- Respect the complexity gate in `.oxlintrc.json`: cyclomatic complexity, nesting
  depth, parameter count, statement count, function length, and file length. A few
  cohesive core files (agent loop, query executor, catalog builder, LLM client, app
  wiring, chat controller, and chat page) carry explicit per-file overrides so their
  documented budgets do not fail; all other code must meet the strict defaults, and
  new code should be split rather than added to the override list.

# Project context

The baseline design is in `../architecture.md`: a chat application analyzing
the GA4 web ecommerce demo dataset in BigQuery, with narratives, visualizations,
and multi-turn follow-ups. The decisions below supersede conflicting baseline
proposals. The implementation status below distinguishes completed backend work
from remaining product and deployment work.

- Hand-roll the agent loop; no LangChain, LlamaIndex, or other agent framework.
- Baseline stack: TypeScript, Node/Express, React/Vite with plain CSS and no UI
  component library. The original brief's interpretation of React remains an
  open question. Visualization libraries are allowed.
- Keep one analyst with eight tools and one bounded reviewer before publication.
  No coordinator, specialist workers, or general multi-agent orchestration.

# Agreed architecture decisions

## Model and SQL

- OpenRouter is the LLM vendor. Start with one configured model and a small
  adapter; do not build a generic provider framework.
- Prefer `run_metric` for catalog requests: server-built parameterized SQL with
  explicit metric definitions. Keep guarded ad-hoc `run_sql` for clear computable
  requests outside the catalog, with a required purpose and justification.
- Material ambiguity completes the turn through `request_clarification`; the
  answer starts a normal new turn. Keep one analyst; investigation delegation is deferred.
- The entire available history is November 1, 2020 through January 31, 2021.
  Observed sessions and customer frequency must not imply lifetime behavior.
- The executor owns access checks and all execution limits. Prompt instructions
  and semantic examples do not enforce correctness or spending limits.
- Keep concrete, typed boundaries between the LLM adapter, semantic layer, query
  executor, agent loop, and session store. Leave room for extension without a
  plugin system or speculative abstractions.

## Query and context budgets

- Dry-run queries for estimates and useful rejection feedback, then enforce
  `maximumBytesBilled` on actual execution under BigQuery on-demand pricing.
- Enforce both per-query and cumulative per-turn warehouse budgets. Start with
  sequential SQL execution; reserve budget before execution and reconcile with
  actual billed bytes afterward. Calibrate thresholds using representative
  dataset queries rather than inventing defaults.
- Restrict execution to a single read-only query over the allowed GA4 dataset.
  Reject scripts, writes, exports, and external execution. Credential permissions
  are a backstop; regex checks alone are not a security boundary.
- Bound rows, columns, serialized result size, total model context, model calls,
  SQL executions, output tokens, and elapsed time. Warehouse and LLM spending
  need separate accounting.
- A SQL LIMIT controls returned rows, not scan cost. Timeouts/cancellation are
  not a guaranteed cost ceiling.
- Prefer complete bounded aggregate results. Oversized results must be clearly
  marked as truncated, with schema/preview and guidance to narrow or aggregate.
  Never present a preview as complete evidence.

## Durable conversation state

- Start with PostgreSQL, superseding the earlier in-memory and SQLite proposals.
- Persist sessions, ordered messages (including tool calls/results), and bounded
  query results. Store narrative, chart configuration, caveats, and result
  references in structured assistant messages rather than a separate answers table.
- Query records retain SQL, purpose, columns, rows, execution/billing metadata,
  and an opaque reference scoped to the owning session.
- Charts render the saved result; do not rerun a paid query just to draw a chart.
- Save completed messages and tool results as a turn progresses. Mark interrupted
  turns interrupted; do not automatically replay potentially paid work.
- Saved history and model context are separate. Preserve history for display,
  while constructing bounded context for each model call.
- Provide a `get_result` tool when older results are omitted from model context.
  A reference alone does not let the model inspect stored rows. New breakdowns
  generally require new SQL, informed by prior SQL and metric choices.
- Allow one active turn per session initially. Bound stored results and define
  retention coherently so retained answers do not silently lose chart data.

## Hosting and future vector retrieval

- Target Railway with one Node app service and a separate PostgreSQL service in
  the same project. Express serves the built frontend and chat/SSE API.
- Keep OpenRouter and Google credentials server-side in environment variables.
  Use a Dockerfile and environment configuration to keep deployment portable.
- Use a pgvector-capable PostgreSQL image/template from the start, but do not
  implement embeddings or vector indexes without a concrete retrieval use case.
- Exact conversation/result retrieval uses relational tables. Future vectors may
  support searching prior analyses, large metric catalogs, or business documents.
- Configure database backups and verify hosted streaming and reload/follow-up
  behavior before declaring deployment complete.
- Fly.io is a viable alternative with more explicit machine configuration and a
  Managed Postgres offering. Railway was selected to minimize deployment work.

# Architecture review learnings

- The baseline loop returns on detecting `present_analysis` before executing it.
  Execute and validate presentation first; complete only on success, otherwise
  feed errors back so the model can repair the answer.
- Require structured presentation for successful completion rather than also
  accepting a plain `end_turn` response as a completed analysis.
- A digest of ten rows plus a result reference is insufficient for comprehensive
  analysis without full bounded results or an explicit retrieval tool.
- Define metric grain, denominators, attribution, and null handling. Canonical
  SQL examples improve guidance but do not prove generated SQL is correct.
- Prefer a small application-owned chart specification (type, result reference,
  column mappings) that the frontend translates into the chosen library's format.
  Validate mappings against actual saved columns. Chart library remains undecided.
- Start with bounded history; add summarization only when needed. Summaries can
  lose filters and metric choices necessary for follow-ups.
- Successful SQL execution is not sufficient analytics validation. Check a small
  representative set against known values or invariants, alongside loop and
  guardrail tests.
- Cost/access controls do not ensure analytical correctness. Preserve definitions
  used, executed SQL, and result references so answers are reviewable.

# Local environment

`.envrc` uses the official devenv/direnv integration:

```bash
eval "$(devenv direnvrc)"
use devenv
```

`devenv.nix`, `devenv.yaml`, and `devenv.lock` configure Node 24, pnpm,
PostgreSQL 16 with pgvector, and Chromium. The shell sets
`PLAYWRIGHT_CHROMIUM_EXECUTABLE`; Playwright's configuration consumes it.
Keep the test runner in pnpm dependencies; Nix supplies the browser.
Run `direnv allow` to authorize loading in an interactive shell.
Start PostgreSQL with `devenv up postgres`, populate `.env` using `.env.example`,
and run the migration before starting the app. Tests use a separate database
whose name ends in `_test`.

# Implementation status and learnings

- Implemented: eight-tool single-agent sequential loop, OpenRouter adapter, semantic
  definitions, SQL/resource checks, BigQuery dry-run and execution caps,
  PostgreSQL session/result storage, structured presentation, and SSE.
- Shared API schemas, types, and stream reader live in `packages/contracts`, split
  into results, charts, sessions, and stream modules. Browser history contains user
  prompts and published output; model/tool exchanges remain backend-only. Build
  that package before direct API commands. Source imports use `.ts`; the compiler
  rewrites them for emitted JavaScript.
- Charts are persisted privately as candidates. Risky analyses pass deterministic
  validation and a separate analytical review before the selected charts
  and answer publish atomically. Drafts stay private; clarification bypasses review.
  Rejection allows two analyst repair calls and one final review, using the same
  warehouse budget. Eight initial analyst calls plus two repair and two review calls
  share the two-minute deadline. Incomplete results cannot support final evidence.
- Reviewer model defaults to the analyst model; `OPENROUTER_REVIEW_MODEL` overrides
  it. Review records and usage breakdowns remain backend-only. Review failure or a
  second rejection withholds output; saved artifacts survive without paid replay.
- Disconnects preserve saved artifacts; duplicate client IDs do not replay work.
  Startup recovery assumes one API process. Revisit turn ownership/recovery
  before scaling to multiple instances.
- Byte caps default to 2 GiB/catalog query, 1 GiB/ad-hoc query and one 5 GiB/turn
  ledger. Representative live scan estimates are saved in
  `docs/live-catalog-results.json`; narrowing dates does not reduce full-history
  session scans. Top-N limits output groups after aggregation, not scanned bytes.
  Model usage is recorded separately; call/context/output limits are not a
  dollar-denominated LLM spending cap.
- Vitest units, real PostgreSQL integration, and Playwright browser tests use
  scripted external services. See `docs/backend-test-cases.md` for verified
  coverage and pending live checks. Browser tests verify transport/persistence,
  not production chat/chart rendering.
- Implemented: Google authorization-code login with PKCE/state/nonce, persistent
  guest/account credentials, HTTP ownership checks, and transactional guest chat
  transfer. Legacy unowned chats remain inaccessible. The frontend supports concurrent
  chat streams, identity-scoped preferences, persisted Haiku titles after prompts 1/3,
  and safe Markdown narratives/drafts/caveats. Title usage is separate from analytics.
  Live Haiku title samples are recorded in `docs/live-title-results.json`; live Google
  login still needs configured OAuth client credentials.
- Implemented: parameterized 18-metric catalog, result provenance and quality
  counts, deterministic top-N scope, persisted chart limitations, and clarification
  completion/SSE/reload/follow-up. Legacy results default to ad-hoc and unspecified
  scope. Numerical claims still require evaluation beyond reference validation.
- Remaining: broader live analytics/model evaluations,
  Railway deployment/static serving, backups, retention policy.
  No embeddings or vector indexes are implemented.
- Express 5 handles rejected async handlers; the obsolete
  `oxc/no-async-endpoint-handlers` lint rule is disabled. API `skipLibCheck` skips
  incompatible dependency declarations; application/test source remains strict.

# Documentation references

- BigQuery cost controls: https://docs.cloud.google.com/bigquery/docs/best-practices-costs
- BigQuery timeout behavior: https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/Job
- Railway PostgreSQL: https://docs.railway.com/databases/postgresql
- Railway pgvector: https://docs.railway.com/guides/embeddings-pipeline
- Railway backups: https://docs.railway.com/guides/postgres-backups-restores
- Fly Managed Postgres: https://fly.io/docs/mpg/
- devenv direnv integration: https://devenv.sh/integrations/direnv/

Hosting capabilities and pricing change; verify current official documentation
when implementing deployment. The local backend is implemented; deployment
has not been performed.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
