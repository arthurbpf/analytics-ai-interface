# Backend acceptance tests

Defined before feature implementation. Automated tests use Vitest and Playwright,
scripted OpenRouter/warehouse fixtures, and real PostgreSQL in a dedicated test database.
Live checks are explicit, paid-service checks and do not run in the default suite.

| Area      | Cases and assertions                                                                                                                                                                                                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contracts | All event variants and chart types parse; malformed payloads fail.                                                                                                                                                                                                                                                                               |
| Charts    | Bar, line, stacked bar, table, KPI validate against saved columns; missing columns, wrong types, missing series, missing KPI cell, cross-session references, and incomplete results fail; empty table succeeds.                                                                                                                                  |
| SQL       | Canonical GA4 UNNEST, wildcard, CTE, join, and aggregation queries pass; prohibited references in nested queries, scripts, writes, exports, routines, external functions, malformed/unsupported syntax fail before execution; dry-run resources are checked independently.                                                                       |
| Cost      | Reject estimates above cap; LIMIT does not bypass scan cap; cumulative reservations bound execution; confirmed billing releases unused reservations; unknown billing does not; billed-byte rejection feeds back to the model.                                                                                                                    |
| Results   | Complete bounded rows survive save/load unchanged; rows, columns, and byte overflow are marked incomplete; dates/nulls/numbers normalize without silently losing precision; chart rendering and retrieval do not rerun SQL.                                                                                                                      |
| Loop      | Query → chart → analysis completes; SQL/chart errors allow correction; presentation executes before completion; plain text is not completion; unknown/malformed tools fail safely; multiple calls execute sequentially; every work budget is enforced; vendor failures terminate honestly.                                                       |
| State     | Reload/restart preserves ordered history and charts; follow-ups inherit definitions/filters and query afresh; omitted results remain retrievable; context preserves active tool pairs; concurrent turns conflict; duplicate request IDs never replay paid work; stale running turns become interrupted; failed persistence never emits success.  |
| HTTP/SSE  | Create/read sessions; bad requests fail before streaming; chart arrives while final answer is pending; browser parser handles fragmented UTF-8 frames; abort propagates to model and warehouse; failures emit terminal states; partial charts survive reload; completed answers stay completed after close; slow consumers respect backpressure. |

## Live checks

1. Totals: users, purchase-event count, USD revenue, and AOV versus reviewed canonical SQL.
2. Daily revenue: values/date buckets versus canonical SQL and streamed chart rows.
3. First-user source/medium revenue: verify attribution and totals.
4. Device session conversion: verify session grain and denominator.
5. Follow-up “show that weekly”: retain filters and metric; change aggregation.
6. Broad request: verify byte-budget rejection/narrowing; record dry-run and billed bytes.

Acceptance: all deterministic suites and workspace checks pass. Record live results
when credentials are available; otherwise explicitly mark them unverified. Successful
SQL execution alone does not prove analytical correctness.

## Verification status

On 2026-10-12, 54 Vitest unit tests, 5 PostgreSQL integration tests, and
2 Playwright tests passed. API/contracts/web lint and API test type checking also
passed. These results do not establish dedicated coverage of every acceptance
case above or that the complete workspace check has passed.

The browser suite checks invalid requests and actual browser SSE consumption:
a chart precedes final narrative, disconnect interrupts the turn, saved
history/result references survive reload, and duplicate IDs return 409.
The production frontend is still a placeholder.

All six live checks remain unverified. Budget defaults are not calibrated against
real BigQuery scans. Deployment and backup checks have not run.
