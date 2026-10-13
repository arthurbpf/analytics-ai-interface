# Decision Log — Agentic GA4 Analytics

## What I assumed and why

- **Correctness and traceability mattered more than unrestricted SQL generation.** GA4's nested events and ambiguous session, purchase, and revenue definitions make plausible answers easy to get wrong. I implemented an 18-metric catalog with server-built, parameterized SQL, retaining guarded ad-hoc SQL for clearly defined questions outside it. Material ambiguity triggers clarification rather than a guessed definition. Findings describe only the available November 2020–January 2021 sample, never lifetime customer behavior.
- **The application must enforce its own limits.** Prompt instructions are guidance, not cost or access controls. The executor checks dataset access, dry-runs queries, enforces execution-time billed-byte caps and a cumulative turn budget, and bounds results. A hand-rolled analyst loop feeds tool errors back for correction; a bounded reviewer checks higher-risk answers before publication.
- **UI libraries were acceptable after clarification.** I asked Mary how strictly to interpret “implement the user interface yourself, without a library,” explicitly mentioning React and pre-built component libraries. She confirmed that “React and material ui are both fine.” I therefore treated component libraries as permitted and used React with shadcn/Base UI to focus effort on the analytics workflow rather than rebuilding UI primitives.

## What I cut or deprioritized

I prioritized a complete question → evidence → chart → narrative → follow-up flow. I deferred specialist-agent delegation, semantic-layer editing, embeddings, additional chart types, and chat deletion. A single analyst plus a limited reviewer provided a smaller, more inspectable design than general multi-agent orchestration. I kept bounded history and exact result retrieval instead of adding potentially lossy conversation summaries. I expanded the scope to include authentication, but deferred administrative tooling and an operational cost dashboard.

## Where I got stuck and what I did about it

- **Choosing whether to add a separate planner.** I prototyped a talker–planner–reviewer pipeline to explore whether separating conversation, planning, and review would improve the analysis. In the comparisons I ran, the separate planner did not produce an observable improvement over the simpler analyst–reviewer setup. I therefore deprioritized the three-role pipeline and retained an analyst with a bounded reviewer, avoiding additional orchestration without a demonstrated benefit.

## What I would do with another 40 hours

1. **Agent observability and evaluation.** Track model/tool calls, latency, costs, and failures, and expand evaluations to check answer accuracy and appropriate clarification.
2. **Semantic-layer and visualization coverage.** Add high-value metrics with explicit definitions and verified reference results, and expand chart types where they help communicate those metrics.
3. **Dataset extensibility.** Separate GA4-specific schema, metric definitions, and prompt guidance from the agent’s orchestration and query execution. Validate those boundaries by integrating a second dataset.
