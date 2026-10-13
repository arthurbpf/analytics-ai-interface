# Project documentation

## Architecture and decisions

- [Architecture presentation](presentations/architecture.pdf): seven slides covering
  the system, turn lifecycle, query limits, evidence, review, and recovery.
- [Editable Typst source](presentations/architecture.typ): diagrams and speaker notes.
- [Decision log](decision-log.md): assumptions, tradeoffs, and future priorities.
- [Decision log PDF](presentations/decision-log.pdf): printable version of the Markdown.
- [Catalog harness](catalog-harness.md): metric semantics and analytical review design.

## Operations and verification

- [Deployment](deployment.md): Railway configuration, credentials, and checks.
- [Security audit](auth-security-audit.md): authentication findings and remediations.
- [Backend test cases](backend-test-cases.md): coverage, measured evaluations, and gaps.
- [Frontend test cases](frontend-test-cases.md): UI coverage and remaining checks.
- [Evaluation artifacts](evaluations/): retained live results, comparisons, and failures.
  Failures are preserved so the test notes and improvements remain reviewable.

## Rebuild the presentation

From the repository root:

```sh
nix run nixpkgs#typst -- compile docs/presentations/architecture.typ docs/presentations/architecture.pdf
```

The deck uses [Touying's Simple theme](https://github.com/touying-typ/touying),
pinned to 0.7.4 in the source, with native Typst diagrams. Compilation was checked
with nixpkgs' Typst 0.15.1. The first compile downloads Touying and its dependency.
No Node tools or presentation dependencies are added to the application.

Render the decision log directly from its Markdown source:

```sh
nix run nixpkgs#typst -- compile --root docs docs/presentations/decision-log.typ docs/presentations/decision-log.pdf
```

The decision-log template uses cmarker 0.1.10 to read `docs/decision-log.md`.

For layout previews, render to a temporary directory:

```sh
nix run nixpkgs#typst -- compile --format png --ppi 100 docs/presentations/architecture.typ '/tmp/architecture-slide-{p}.png'
```
