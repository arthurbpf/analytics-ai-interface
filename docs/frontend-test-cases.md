# Frontend verification

The frontend uses the shared schemas in `packages/contracts` and a ts-rest
client for JSON endpoints. The turn endpoint uses native fetch and the shared
SSE reader so incremental events arrive immediately. There is no OpenAPI
specification or generated client to keep in sync.

The single chat page uses shadcn/ui's Lyra preset with Base UI primitives.
Session discovery and sidebar preferences live in browser local storage;
conversation contents and chart results remain in PostgreSQL. One stream stays
active while navigating between sessions. Reload retrieves saved history and
polls an existing running turn without replaying paid work.

Narrative drafts stream from `present_analysis` arguments. Drafts are provisional:
failed validation removes them, and only validated presentations become saved
answers. Tool arguments and internal model exchanges are not displayed.

## Automated coverage

- Frontend units cover typed API validation and errors, browser storage recovery,
  submission limits, duplicate prevention, background navigation, cancellation,
  premature EOF, stale history, missing sessions, conflicts, retained charts when
  history retrieval fails, and session creation during navigation.
- Chart tests cover all five chart types, safe text, nulls, zero and negative
  values, dates, empty data, stacked series alignment, duplicate stacked mappings,
  accessible tables, caveats, and truncation warnings.
- API units cover fragmented and interleaved model streaming, usage reporting,
  bounded input, malformed or interrupted streams, cancellation, draft rejection
  and repair, and persisted presentation validation.
- PostgreSQL integration tests verify persistence and API behavior against a real
  database.
- Twelve Chromium tests run the production frontend against a scripted model and
  real PostgreSQL. They cover incremental draft/chart display, persisted reload
  and follow-ups, background sessions, Stop, rejected drafts, model failure,
  all chart types, mobile sidebar, keyboard submission, input limits, escaped
  content, invalid URLs, and missing local sessions.

## Commands

Build contracts before direct API commands:

```sh
pnpm --filter @analytics/contracts build
pnpm --filter @analytics/web test
pnpm --filter @analytics/api test
pnpm --filter @analytics/api test:integration
pnpm --filter @analytics/api test:e2e
pnpm exec turbo run typecheck build
```

E2E tests require PostgreSQL and the Chromium executable configured by devenv
through `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. External services are scripted; these
tests do not establish live model quality, live analytics correctness, or hosted
streaming behavior. Those deployment and calibration checks remain pending.

The ts-rest prerelease supports Zod 4 and Express 5. Dependency declarations
still require `skipLibCheck`; application and test sources remain strict.
