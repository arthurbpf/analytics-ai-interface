# Backend acceptance tests

Defined before feature implementation. Automated tests use Vitest and Playwright,
scripted OpenRouter/warehouse fixtures, and real PostgreSQL in a dedicated test database.
Live checks are explicit, paid-service checks and do not run in the default suite.

| Area      | Cases and assertions                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts | All event variants and chart types parse; malformed payloads fail.                                                                                                                                                                                                                                                                                                                                                              |
| Charts    | Bar, line, stacked bar, table, KPI validate against saved columns; missing columns, wrong types, missing series, missing KPI cell, cross-session references, and incomplete results fail; empty table succeeds.                                                                                                                                                                                                                 |
| SQL       | Canonical GA4 UNNEST, wildcard, CTE, join, and aggregation queries pass; prohibited references in nested queries, scripts, writes, exports, routines, external functions, malformed/unsupported syntax fail before execution; dry-run resources are checked independently.                                                                                                                                                      |
| Cost      | Reject estimates above cap; LIMIT does not bypass scan cap; cumulative reservations bound execution; confirmed billing releases unused reservations; unknown billing does not; billed-byte rejection feeds back to the model.                                                                                                                                                                                                   |
| Results   | Complete bounded rows survive save/load unchanged; rows, columns, and byte overflow are marked incomplete; dates/nulls/numbers normalize without silently losing precision; chart rendering and retrieval do not rerun SQL.                                                                                                                                                                                                     |
| Loop      | Query → chart → analysis completes; SQL/chart errors allow correction; presentation executes before completion; plain text is not completion; unknown/malformed tools fail safely; multiple calls execute sequentially; every work budget is enforced; vendor failures terminate honestly.                                                                                                                                      |
| State     | Reload/restart preserves ordered display history and charts, while internal model/tool exchanges remain available only to the agent; follow-ups inherit definitions/filters and query afresh; omitted results remain retrievable; context preserves active tool pairs; concurrent turns conflict; duplicate request IDs never replay paid work; stale running turns become interrupted; failed persistence never emits success. |
| HTTP/SSE  | Create/read sessions; bad requests fail before streaming; chart arrives while final answer is pending; browser parser handles fragmented UTF-8 frames; abort propagates to model and warehouse; failures emit terminal states; partial charts survive reload; completed answers stay completed after close; slow consumers respect backpressure.                                                                                |

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

## Identity, ownership, and titles

Automated tests script Google/OpenRouter and use real PostgreSQL for persistence.
The ownership suite checks missing credentials (401) and cross-identity access (404)
for listing, history, results, and submission. Two Google accounts with the same
email still remain separate because their subject IDs differ. Tests cover guest cookie
persistence, hashing/expiration/revocation, same-origin mutations, cookie attributes,
logout cancellation, state mismatch, expired/replayed callbacks, failed token
verification, guest-binding mismatch, and transfer into new/existing Google accounts.
The adapter unit tests verify PKCE S256, state/nonce, audience verification, missing
ID tokens, token verification errors, and nonce mismatch.

A migration test creates a disposable test database, inserts chat records under the
original schema, and applies the new migration. IDs and messages survive; the records
remain unowned and cannot be accessed by guests.

Title tests check accepted prompt counts 1 and 3, duplicate rejection, failed and
interrupted analyses, bounded model input/output, invalid/empty/truncated output,
timeouts, fallback/previous title preservation, separate usage, out-of-order writes,
and startup recovery without replay. HTTP tests verify analytics can finish while its
title remains pending and duplicates do not create extra title calls.

Live Haiku title verification is recorded in [live-title-results.json](live-title-results.json):
English and Portuguese first-prompt titles and a third-prompt revision were valid,
short, and reflected the analysis intent. The three requests reported a total cost
of $0.000414. Live Google login remains unverified because Google OAuth client
credentials are not configured in the local environment. After configuring them,
verify login, guest transfer, account reload, logout, and login from a second browser
using the setup in the root README.
