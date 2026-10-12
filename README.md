# HockeyStack Analytics

React + Vite + TanStack Router frontend and Node.js + Express backend, managed
with pnpm workspaces and Turborepo. This is the tooling scaffold; analytics and
chat are not implemented yet.

## Development

Install Nix, devenv, and direnv, with the direnv hook enabled in your shell.
From this directory:

```sh
direnv allow
pnpm install
pnpm dev
```

Alternatively, enter `devenv shell` before running the pnpm commands.
The shell provides Node.js 24 LTS, pnpm, Git, nixfmt, and ShellCheck. JavaScript
tooling comes from workspace dependencies, keeping CLI and editor versions
aligned. Both apps use TypeScript 7.0.2 through the shared pnpm catalog and override.

The frontend runs at http://localhost:5173. The backend listens at
http://127.0.0.1:3001/api/health; Vite proxies `/api` requests to it during development.

## Checks

```sh
pnpm check           # Formatting, lint, type checks, and builds
pnpm lint:fix       # Safe lint fixes
pnpm format         # Format supported files with Oxfmt
nixfmt --check devenv.nix
shellcheck .envrc
```

Oxlint enables correctness and suspicious rules as errors, plus explicit rules
for unsafe TypeScript, unchecked promises, exhaustive switches, import cycles,
React hooks, and accessibility. Type-aware rules use `oxlint-tsgolint`; ordinary
type checks use the pinned TypeScript compiler. Type assertions and explicit
`any` are prohibited; use narrowing, annotations, or `satisfies` instead.
Formatting belongs to Oxfmt. The original exercise and architecture documents
are excluded to preserve the supplied references.

Builds and checks are cached by Turborepo. Development servers and lint fixes
are never cached. Add shared packages under `packages/` when there is code to share.

The dependency lockfile is included. Generate and commit `devenv.lock` when the
shell first initializes with network access. CI installs should use
`pnpm install --frozen-lockfile`.
