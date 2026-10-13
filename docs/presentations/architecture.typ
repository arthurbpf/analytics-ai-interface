#import "@preview/touying:0.7.4": *
#import themes.simple: *

#let ink = rgb("182b3a")
#let teal = rgb("146b67")
#let paper = rgb("f7f5f0")
#let muted = rgb("587080")

#show: simple-theme.with(
  aspect-ratio: "16-9",
  footer: [GA4 ANALYTICS · 13 OCT 2026],
  config-common(handout: true),
  config-colors(primary: teal, neutral-lightest: paper, neutral-darkest: ink),
)
#set text(font: "DejaVu Sans", size: 20pt, fill: ink)
#set heading(level: 2, supplement: none)
#show heading.where(level: 2): set text(size: 29pt, weight: "bold")
#set par(leading: 0.65em)

// A reusable diagram node; body is its label, tone sets its border and text color.
#let card(body, tone: teal) = rect(
  width: 100%, height: 60pt, radius: 7pt, inset: 8pt,
  fill: tone.lighten(93%), stroke: 0.8pt + tone.lighten(45%),
  align(center + horizon, text(size: 15pt, fill: tone, body)),
)

// A left-to-right flow of labeled nodes with explicit direction arrows.
#let flow(..labels) = {
  let cells = ()
  for (index, label) in labels.pos().enumerate() {
    if index > 0 { cells.push(align(center + horizon, text(fill: muted)[→])) }
    cells.push(card(label))
  }
  grid(
    columns: labels.pos().enumerate().map(((i, label)) => if i == 0 { (1fr,) } else { (18pt, 1fr) }).flatten(),
    align: horizon, ..cells,
  )
}

// A small section marker that keeps the narrative visible above each diagram.
#let kicker(body) = text(size: 11pt, weight: "bold", fill: muted, tracking: 1pt, body)

== The model chooses. The application controls.

#kicker[01 / SYSTEM BOUNDARIES]
#v(14pt)
#flow([Browser\ React + charts], [Express API\ Identity + SSE], [Analyst runtime\ Tools + review])
#align(center, text(size: 13pt, fill: muted)[APPLICATION DEPENDENCIES])
#grid(columns: (1fr, 1fr, 1fr), gutter: 12pt,
  card([PostgreSQL\ History + evidence]),
  card([BigQuery\ Read-only GA4]),
  card([OpenRouter\ Analyst / reviewer]),
)
#v(16pt)
*Application-owned:* access, budgets, persistence, publication.

#speaker-note[The bottom row represents application dependencies, not a sequential pipeline. Express and the runtime share PostgreSQL. The runtime calls BigQuery and OpenRouter. One hand-rolled analyst with eight tools; the reviewer is a bounded role without query execution. Sources: index.ts, app.ts, agent/loop.ts, packages/contracts.]

== Request lifecycle

#kicker[02 / REQUEST HANDLING]
#v(14pt)
#flow([Validate identity\ + ownership], [Save running turn\ Open SSE], [Build context\ Call analyst], [Execute tools\ Save feedback])
#align(right, text(size: 15pt, fill: muted)[↖ feedback returns to the analyst ↙])
#v(14pt)
- One active turn per conversation; duplicate IDs are rejected.
- Tools inspect, compute, retrieve evidence, and propose output.
- *Ambiguity → clarification.* The reply begins a new turn.

#speaker-note[Eight tools: get_schema, get_metrics, run_metric, run_sql, get_result, publish_chart, present_analysis, request_clarification. Calls execute sequentially. Correctable tool errors become model feedback. Plain prose cannot complete an analysis. Sources: app.ts, db/store.ts:startTurn, agent/loop.ts, agent/tools.ts.]

== Defined metrics, guarded execution

#kicker[03 / QUERY EXECUTION]
#v(12pt)
#text(size: 16pt, fill: muted)[run_metric: 18 defined metrics  |  run_sql: purpose + justification]
#v(12pt)
#flow([Validate SQL\ Dry-run], [Reserve\ turn budget], [Execute with\ billing cap], [Bound + save\ provenance])
#v(17pt)
*5 GiB / turn* · 2 GiB / catalog query · 1 GiB / ad-hoc query

#text(size: 17pt)[LIMIT bounds output, not scan cost. Cancellation is not a cost ceiling.]

#speaker-note[Definitions cover grain, denominators, attribution, and nulls. Purchases count events, not reconstructed orders. Both query paths cross the same executor. Known billed bytes reconcile the reservation; unknown billing keeps it reserved. Sources: analytics/catalog.ts, guardrails.ts, bigquery.ts, budget.ts.]

== Save the evidence. Reuse it.

#kicker[04 / EVIDENCE AND MEMORY]
#v(14pt)
#flow([Saved history\ + query results], [Bounded context\ 128 KiB ceiling], [Analyst])
#v(12pt)
#grid(columns: (1fr, 1fr), gutter: 14pt,
  card([get_result retrieves older evidence]),
  card([Charts render saved rows]),
)
#v(14pt)
*No paid rerun to draw a chart.* New breakdowns generally need SQL.

#speaker-note[Durable history is separate from bounded model context. Results retain SQL, parameters, definitions or justification, billing, quality, and scope. Transport bounds: 500 rows, 32 columns, 64 KiB. The active turn stays intact; completed turns are added whole while space permits. No automatic summarization. Sources: agent/context.ts, analytics/bigquery.ts, packages/contracts/src/results.ts.]

== Private candidates cross a publication gate

#kicker[05 / VERIFICATION]
#v(12pt)
#flow([Private answer\ + charts], [Validate evidence\ + mappings], [Review if\ policy requires])
#v(12pt)
#grid(columns: (1fr, 1fr), gutter: 14pt,
  card([Approved or exempt → Commit]),
  card([Rejected → Repair → Final review], tone: rgb("946123")),
)
#v(12pt)
#text(size: 17pt)[Final rejection or review failure → Withhold the answer.]

#text(size: 18pt)[*Same budget and deadline:* 8 analyst + 2 repair + 2 review calls; 120 seconds.]

#speaker-note[Charts, ad-hoc evidence, multiple results, and specified catalog complexity trigger review. The reviewer checks calculations, grain, dates, filters, attribution, and overclaims; it cannot query. At most two repair calls and one final review after rejection. Five SQL execution submissions. Deterministic validation also applies to exempt analyses. Sources: agent/presentation.ts, review.ts, review-policy.ts, loop.ts.]

== Commit first. Stream second.

#kicker[06 / DELIVERY AND RECOVERY]
#v(14pt)
#flow([Atomic commit\ Answer + charts], [SSE delivers\ saved artifacts], [Browser renders\ and reconciles])
#v(17pt)
- Delivery failure after commit leaves a *reloadable answer*.
- Stop, disconnect, or deadline retains saved work.
- Restart interrupts abandoned turns; *no automatic paid replay*.

#speaker-note[Saved history is authoritative. Private reviews and candidates remain hidden. A follow-up starts a new turn with bounded prior context. Completed publication cannot be downgraded by a later delivery failure. Startup recovery assumes one API process. Sources: db/store.ts:completeTurn,recover, agent/loop.ts, http/stream.ts, frontend stream state.]

== Running today. Still measuring accuracy.

#kicker[07 / CURRENT STATE]
#v(14pt)
#grid(columns: (1fr, 1fr), gutter: 24pt,
  [
    #text(fill: teal, weight: "bold")[IMPLEMENTED]
    #v(7pt)
    #text(size: 17pt)[
      Deployed\
      Guest access + Google SSO\
      Chat persistence + reload\
      254 API / frontend unit tests
    ]
  ],
  [
    #text(fill: muted, weight: "bold")[REMAINING]
    #v(7pt)
    #text(size: 17pt)[
      Broader numerical evaluations\
      Evidence storage efficiency\
      Retention policy
    ]
  ],
)
#v(18pt)
*Answers and charts are saved with their supporting query results.*

#text(size: 16pt, fill: muted)[Reviewer approval is fallible. Independent expected results still matter.]

#speaker-note[Deployment checks ran on 13 October 2026. Google SSO is implemented. Runtime review is distinct from offline evaluation; independent numerical checks remain necessary. Further work includes deduplicating saved evidence, bounding database reads, and defining retention. Sources: docs/backend-test-cases.md, docs/decision-log.md, deployment-session checks.]
