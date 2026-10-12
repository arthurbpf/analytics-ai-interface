# Shared API contracts

This package defines the data exchanged between the API and the browser.
Zod schemas validate runtime data; TypeScript types are inferred from those schemas.
Import both from `@analytics/contracts`.

- `api.ts`: ts-rest endpoint definitions consumed directly by server and client.
- `results.ts`: saved query data, SQL, result references, and warehouse metadata.
- `charts.ts`: chart specifications, charts with saved data, and final analyses.
- `sessions.ts`: session creation, turn requests/status, errors, and display history.
- `stream.ts`: turn events and the `readEvents` reader for the API's SSE stream.

A turn is one user prompt and the work performed to answer it. During a turn,
`analysis_started`, `analysis_delta`, and `analysis_discarded` describe provisional
narrative drafts, which must not be persisted as completed answers.
`chart_ready` publishes a chart with its saved data. `analysis_ready` publishes
the final narrative and references its evidence (`resultRefs`) and already
published charts (`chartIds`). `turn_finished` reports the terminal status.
Reloading a session returns user prompts, charts, and analyses in saved order.
Internal model messages and tool exchanges remain in the API's session store.

`QueryResult.ref` is an opaque reference scoped to a session. `complete: false`
means the rows are a preview; they cannot support final evidence. Counts and byte
sizes are decimal strings because JSON numbers cannot represent every large integer.

Build with `pnpm --filter @analytics/contracts build` before running the API directly.
