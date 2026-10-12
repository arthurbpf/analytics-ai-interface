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
| HTTP/SSE  | Create/read sessions; bad requests fail before streaming; charts and answer publish only after review; browser parser handles fragmented UTF-8 frames; abort propagates to model and warehouse; failures emit terminal states; candidate charts remain private on interrupted reload; completed answers stay completed after close; slow consumers respect backpressure.                                                        |

## Catalog, clarification and live verification

The current harness keeps one analyst with eight tools and a bounded reviewer. `run_metric` exposes 18
metrics, while guarded `run_sql` requires purpose/justification. Calendar dates,
allowed dimensions/filters, steps and ranking columns are validated before query
submission. Values are bound parameters; identifiers/operators are server-owned.
SQL parsing/access checks, dry-run resource validation, result bounds and one
cumulative warehouse ledger apply to both paths (2 GiB/catalog, 1 GiB/ad-hoc,
5 GiB/turn). Catalog provenance is assigned by the server, with legacy defaults.

Deterministic checks cover hostile values, incompatible session/event filters,
item defaults and event-revenue isolation, no implicit limit, identical inspection
and execution parameters, full group counts and top-N selection completeness,
legacy result/chart defaults, missing transport metadata on overflow, and shared
cap reservation/settlement/unknown billing. Complete saved top-N selections can
support only those groups; incomplete transport cannot ground final evidence.
Charts retain scope/required limitations; presentation merges those limitations.

Clarification shares the completion transaction and status `completed` with
analysis. Tests check both terminal tools on the last model step, dispatch of
unavailable work, terminal-last ordering, persistence before success, private drafts and candidate charts, retained results, duplicate IDs, reload, and a normal follow-up
with clarification context. Browser tests exercise the production UI with scripted
external services; they do not validate live analytics by themselves.

On 2026-10-12, bounded-review checks passed: 145 API unit tests,
51 web unit tests, 25 real PostgreSQL integration tests and 18 Playwright browser
cases. The browser run initially collided with concurrent startup recovery; its
one interrupted case passed when rerun alone. Workspace formatting, lint, typecheck and production builds passed. Vite
reports the existing large frontend bundle warning; deployment remains unverified.

Live verification commands (explicit paid/external checks):

```sh
pnpm --filter @analytics/api test:live
pnpm --filter @analytics/api test:evaluation
```

[Live catalog results](live-catalog-results.json) distinguish vocabulary,
independent observed values, catalog observations, adversarial SQL fixtures and
36 query-shape estimates. Each observation records SQL, date scope, definition,
rows, job ID and processed/billed bytes; estimates retain identical bound
parameters. Full-window independent queries reproduce 5,692 purchase events,
$362,165 recorded event revenue, 4,451 distinct valid transaction IDs, 906 invalid
ID events, 326 repeated valid IDs, and 15 cross-user IDs with conflicting revenue
across dates. Item vocabulary across all events is 1,394 IDs/431 names. Purchase
items record quantity 22,720 and USD revenue $362,110, with 448 missing quantities
and 448 missing item revenues; two purchase events have no item rows.

Independent session-start/conversion and engagement checks use complete recorded
session membership, not the historical activity-based monthly totals in
[live-bigquery-results.json](live-bigquery-results.json). Adversarial SQL checks
include cross-midnight membership, changing dimensions, timestamp ties, repeated
purchase events, invalid IDs, checkout before/after purchase, unknown flags,
single-event duration, absent engagement time, historical/prior versus later
purchases, bucket-end purchaser classification, overlapping user groups,
deterministic top-N ties, empty selections and missing item values.

The largest of 36 representative weekly query estimates is 1,809,468,091 bytes
(about 1.69 GiB), within the 2 GiB catalog cap. Full-history session construction
requires the same scan for January and the entire reporting period. The current
catalog uses a shared full-history event projection for every metric; narrower
date arguments reduce qualifying rows but do not currently prune scanned tables.
These estimates establish representative headroom, not that every permitted
shape will fit; maximumBytesBilled and the remaining turn budget still govern
execution.

[Model evaluations](live-harness-evaluations.json) record model, correctness
checks, unnecessary clarification, repair attempts, latency, usage, tool calls,
answers and saved evidence for seven scenarios plus a follow-up: catalog revenue,
top-N purchases, an ad-hoc conflict diagnostic, ambiguity, unavailable dates,
metric explanation, a one-byte warehouse budget, and January-preserving weekly
follow-up. All eight recorded cases pass the current rubric. Metric explanations
and unavailable-data answers correctly omit evidence; dataset numerical findings
reference saved results. Budget rejection preserves the requested dates/meaning.

The [initial evaluation](live-harness-evaluations-initial.json) is retained to make
its limitations reviewable: a custom diagnostic omitted known placeholder-ID
exclusions and reported 16 rather than 15. The prompt/schema guidance was corrected
to preserve catalog definitions in custom SQL. Two routing checks also rejected
`event_counts` filtered to purchase events, despite its equivalence to purchase
counts; the rubric now accepts that precisely filtered alternative. The initial
ad-hoc definition error was found by narrative/SQL review, illustrating why valid
references alone cannot prove analytical correctness.

Remaining gaps: repeated/model-diverse evaluations, automatic verification of
every narrative claim and derivative calculation, independent real-data references
for every catalog metric/dimension/filter combination, broader malformed export
fixtures (including repeated parameter keys), and deployed streaming/backup/retention
checks. Single-run prompt success is evidence for these cases, not a correctness
guarantee. Investigation delegation, embeddings and vector indexes are not implemented.

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

## Bounded analytical review

Review runs after deterministic validation and before publication for custom SQL,
multiple results, charts, time series, filters, ranked results, multi-dimension
results, and rate/comparison-style catalog metrics. It skips explanations without
query evidence and simple one-result catalog aggregates with at most one dimension.
Clarification bypasses it. The reviewer receives complete referenced evidence and
returns exactly one typed verdict. Tests cover malformed/contradictory/multiple
verdicts, provider failures, context overflow without previews, unknown interrupted
usage, one repair cycle, query-capable repair sharing the SQL ledger, twelve total
model calls, and terminal-only final repair dispatch. PostgreSQL checks retain
private records across reopen and inject an answer-insert failure to verify that
chart publication and completion roll back together. Browser checks withhold output
during delayed review, keep rejected/interrupted candidates private on reload, and
reject duplicate IDs without replay.

Live evaluation artifacts separate end-to-end routing over BigQuery from controlled
synthetic reviewer challenges. Neither reference validation nor reviewer approval
establishes every numerical or causal claim; manual review and repeated/model-diverse
runs remain necessary.

Final live checks for `openai/gpt-5.6-luna` are in
[live baseline](live-harness-evaluations-baseline.json),
[live reviewed](live-harness-evaluations-reviewed.json), and
[controlled review](live-review-evaluations.json). Both end-to-end runs completed
nine cases. Their median turn latencies were 13.899 seconds without review and
21.712 seconds with review; reported total LLM costs were $0.01417248 and
$0.03205549, including $0.01768915 of reviewer usage. The final reviewed run needed
no repair queries. These are single runs, not controlled latency/cost estimates;
model trajectories vary. The multi-part coverage rubric accepts `event_counts`
filtered to purchase events as equivalent to `purchases`; coverage annotations
were reassessed from saved evidence without rerunning paid work.

The controlled run uses synthetic complete evidence, scripted analyst output and
repairs, and a live reviewer: 12 incorrect candidates were rejected, three correct
initial candidates accepted, and all twelve scripted repairs accepted, with no
false rejections in that run. Fifteen reviewed turns had a median latency of 6.318
seconds, reported reviewer cost $0.0437594, and no warehouse execution. This
establishes those reviewer judgments, not the analyst's ability to produce the
scripted repairs or general production accuracy.

Earlier live failures are retained in
[initial review](live-harness-review-initial.json),
[chart repair failure](live-harness-review-chart-failure.json), and
[alias review failure](live-review-evaluations-alias-failure.json). They exposed an
unnecessary inline-reference demand, unsupported line-chart series advice, and a
false SQL-grain objection. The reviewer now receives the authoritative chart schema;
shared SQL guidance records BigQuery's documented SELECT-alias precedence in GROUP BY.
A live dry run accepted the fixture SQL and estimated 31,933,994 bytes. The alias
failure artifact predates counting false rejections of correct repairs; its last
rejection is a false rejection even though its original `falseRejection` flag is false.
See [BigQuery GROUP BY](https://docs.cloud.google.com/bigquery/docs/reference/standard-sql/query-syntax#group_by_clause).

Manual review still found numerical rounding errors in the final live multi-part
answer: the desktop revenue decline was 59.9263% (59.9% to one decimal), reported
as 60.0%; the overall decline was 60.2454% (60.2%), reported as 60.3%. The reviewer
approved them. The automated `correctness` field measures its stated routing and
evidence rubric, not every numerical claim. Reviewer approval remains fallible,
and broader numerical evaluation is still pending.
