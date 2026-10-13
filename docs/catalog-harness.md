# Catalog harness

The implemented design uses one analyst with eight tools and a bounded reviewer.
Investigation delegation and a generalized runner are deferred. The reviewer has
only a typed verdict tool and defaults to the analyst model, optionally overridden
with `OPENROUTER_REVIEW_MODEL`. It receives the analyst's bounded conversation,
validated candidate, chart specifications, complete referenced results, SQL,
parameters, and authoritative definitions. It checks analytical errors rather than
style. Oversized evidence is rejected without truncation. Risky analyses are reviewed;
clarification and simple single-result catalog aggregates bypass review.

`run_metric` executes 18 server-defined metrics with bound date/filter/step values.
`get_metrics` exposes definitions, allowed parameters and numeric output columns.
Use `run_sql` with purpose/justification for clear computable requests outside the
catalog, preserving relevant catalog definitions. Both paths use SQL parsing,
resource checks, identical dry-run/execution parameters, bounded results and one
warehouse ledger: 2 GiB/catalog submission, 1 GiB/ad-hoc, 5 GiB/turn. Five SQL submissions, the two-minute deadline and output/context
limits remain. Eight initial analyst calls, two repair calls and two reviews allow
at most twelve model calls; repair queries share the existing warehouse ledger.

The entire available history is 2020-11-01 through 2021-01-31. Purchase count,
recorded event revenue and average revenue per purchase event retain event grain.
Transactions count distinct valid IDs, excluding null/blank and known placeholders;
they do not reconstruct orders. Session metrics construct complete sessions over
all history before selecting first-event dates/dimensions. Timestamp ties use event
name/dimensions; Monday weeks use exported dates. First observed sessions use full
history. Purchaser frequency includes historical purchase sessions only through
the selected end or each bucket's end. Item revenue comes from item fields.
Missing IDs/flags/quantities/revenue are reported; rates have null zero denominators.
Funnel steps measure unordered distinct-user reach, with the original four defaults
and verified additional ecommerce events. Definitions live in
`apps/api/src/analytics/catalog.ts`; contracts enforce dates and bounded arguments.

Saved results contain server-assigned origin, normalized catalog arguments and
definition or ad-hoc justification, SQL/parameters, quality counts, required caveats
and analytical scope. Old results default to ad-hoc/unspecified, without inferring
provenance from SQL. Top-N ranks complete aggregates descending (BigQuery defaults
nulls last) and uses dimension values as tie-breakers. The same query computes full
group counts, including an empty-result metadata row that is removed before saving.
No implicit limit is applied. Transport completeness and analytical selection are
separate: complete top-N supports only that selection; overflow cannot support
final evidence. Candidate charts carry scope/caveats, and final presentation merges
server-required limitations from every referenced result. Charts stay backend-only
until review approval. One rejection supplies concrete issues for a bounded repair;
the last repair call allows only presentation or clarification. A second rejection
or technical review failure withholds output. Safe failure records, verdicts,
candidates, reviewer model and latency are saved privately; aggregate usage includes
separate analyst/reviewer breakdowns. Selected charts and the approved answer commit
together before SSE success events. Narrative drafts are no longer emitted.

`request_clarification` persists 1–3 bounded questions and context using the same
completion transaction as analysis, with status `completed`. Both terminal tools
must be last and remain available on the last model step; dispatch enforces the
restriction. Persistence precedes success events. Clarification clears drafts,
retains saved artifacts, displays once live/after reload, and enters follow-up
context. The answer creates a normal turn, without pause/resume or paid replay.

Verification includes calendar/allowlist/hostile-value checks, shared caps,
provenance/legacy/scope tests, PostgreSQL/SSE/browser lifecycle checks, independent
live canonical queries, adversarial SQL fixtures and representative model cases.
Artifacts distinguish vocabulary, observed values and shape estimates; they retain
SQL, scope, definitions, rows, job IDs, estimated/billed bytes and verification date.
Numerical grounding needs evaluation beyond reference validation. Consult
`docs/backend-test-cases.md` for checks actually run and remaining gaps.

Shared SQL guidance also records BigQuery SELECT-alias precedence for GROUP BY,
after a live reviewer incorrectly treated a category alias as struct grouping.
See `docs/backend-test-cases.md` for measured review benefits, cost/latency,
retained failed runs, and missed numerical rounding errors.

Official parameter, grouping and sorting contracts:
[BigQuery parameters](https://docs.cloud.google.com/bigquery/docs/parameterized-queries),
[BigQuery grouping](https://docs.cloud.google.com/bigquery/docs/reference/standard-sql/query-syntax#group_by_clause),
[BigQuery ordering](https://docs.cloud.google.com/bigquery/docs/reference/standard-sql/query-syntax#order_by_clause).
