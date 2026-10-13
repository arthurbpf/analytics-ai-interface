# Deploying to Railway

The application is a pnpm monorepo with an Express API (`apps/api`), a
React/Vite frontend (`apps/web`), and a shared contracts package
(`packages/contracts`). In production the API serves the built frontend as
static files, so a single Node service plus a PostgreSQL database is all that
runs. Everything the app needs is described by two files:

- `Dockerfile` — builds the workspace, runs database migrations, and starts the
  API (which also serves `apps/web/dist`).
- `.railway/railway.ts` — Railway [Infrastructure as Code][railway-iac] for the
  app service and a managed PostgreSQL database.

[railway-iac]: https://docs.railway.com/infrastructure-as-code

## Prerequisites

| Credential                     | Purpose                         | How to get it                                                      |
| ------------------------------ | ------------------------------- | ------------------------------------------------------------------ |
| OpenRouter API key             | LLM calls                       | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) |
| OpenRouter model id            | Default analyst model           | e.g. `openai/gpt-4o` or `anthropic/claude-sonnet-4`                |
| Google Cloud project id        | BigQuery billing project        | Existing GA4 export project                                        |
| GCP service-account key (JSON) | BigQuery access from the server | See below                                                          |
| Google OAuth client id/secret  | Optional "Sign in with Google"  | See below                                                          |

### GCP service account for BigQuery

The API queries the GA4 dataset using Application Default Credentials. On
Railway you cannot mount a credentials file, so the service-account JSON is
stored as a secret and materialized by the app at startup.

1. In the project that hosts the BigQuery GA4 export, create a service account
   with **BigQuery Job User** and **BigQuery Data Viewer** roles (least
   privilege: Job User to run queries, Data Viewer on the GA4 dataset).
2. Create a JSON key for it (`APIs & Services > Credentials > Service
   Accounts`).
3. The entire JSON file becomes the `GOOGLE_APPLICATION_CREDENTIALS_JSON`
   secret (one line, including the braces).

### Google login (optional)

If you want account sign-in, create a **Web application** OAuth client. The
authorized JavaScript origin is your deployed origin and the authorized
redirect URI is `<APP_ORIGIN>/api/auth/google/callback`. Leave the
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` variables unset for guest-only access.

## Deploy steps

1. Install and sign in to the CLI (skip if already done):

   ```bash
   # see https://docs.railway.com/cli#installing-the-cli
   railway login
   ```

2. From the repository root, link the directory to a Railway project:

   ```bash
   railway init          # or: railway link
   ```

3. Commit the working tree and push to GitHub. Railway auto-deploys new commits
   to the linked branch. The `.railway/railway.ts` file declares the same repo
   as its source; adjust `source: github(...)` there if your repo path differs.

4. Set the required variables before the first deploy (see the table below):

   ```bash
   railway variables set OPENROUTER_API_KEY=sk-... OPENROUTER_MODEL=openai/gpt-4o
   railway variables set GOOGLE_CLOUD_PROJECT=my-gcp-project
   # The service-account JSON is long; paste it from a file:
   railway variables set GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat path/to/key.json)"
   ```

5. Apply the Infrastructure-as-Code definition (installs the `railway` SDK if
   asked, then previews and applies):

   ```bash
   pnpm add -D -w railway       # SDK that evaluates .railway/railway.ts
   railway config plan          # preview only
   railway config apply         # creates the postgres DB + api service
   ```

   `plan`/`apply` provision the PostgreSQL database and the API service and wire
   `DATABASE_URL` to the database. Review the plan before confirming.

6. If the first build didn't already trigger, deploy explicitly:

   ```bash
   railway up
   ```

The Dockerfile runs `node dist/db/migrate.js` (idempotent Drizzle migrations)
before starting the server, so no separate migration step is needed.

## Variables

Required:

| Variable                              | Notes                                                         |
| ------------------------------------- | ------------------------------------------------------------- |
| `DATABASE_URL`                        | Managed by IaC via `db.env.DATABASE_URL`; do not set by hand. |
| `OPENROUTER_API_KEY`                  | Secret.                                                       |
| `OPENROUTER_MODEL`                    | Model id supporting tool calls.                               |
| `GOOGLE_CLOUD_PROJECT`                | BigQuery billing project.                                     |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Service-account JSON (see above).                             |
| `NODE_ENV`                            | Set to `production` by IaC.                                   |

Optional:

| Variable                                    | Notes                                                                                                                               |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ORIGIN`                                | Public HTTPS origin. Omitted, the app derives it from Railway's `RAILWAY_PUBLIC_DOMAIN`. Set explicitly for a custom domain.        |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Enable Google login.                                                                                                                |
| `OPENROUTER_REVIEW_MODEL`                   | Overrides the reviewer; defaults to the analyst model.                                                                              |
| `OPENROUTER_TITLE_MODEL`                    | Defaults to `anthropic/claude-haiku-4.5`.                                                                                           |
| `DATABASE_SSL_CA`                           | PEM CA certificate when PostgreSQL uses a private or self-signed CA; required unless its certificate chains to a system-trusted CA. |

`HOST=0.0.0.0` and `STATIC_DIR=/app/web/dist` are baked into the image by the
Dockerfile; `PORT` is injected by Railway.

## Post-deploy checks

- `GET https://<domain>/api/health` returns `200` (Railway's healthcheck).
- Open `https://<domain>/`, start a chat, and confirm a narrative and chart
  render, then reload the page to confirm history persists.
- Check `railway logs` for `query_complete` events and no `http_failed` noise.

## Notes

- **TLS to Postgres**: both the API and migrations require certificate and
  hostname verification in `NODE_ENV=production`. Obtain the trusted CA
  certificate from the database provider or administrator through an
  authenticated channel. For a private/self-signed CA, set `DATABASE_SSL_CA` to
  its PEM contents with actual newlines and add `DATABASE_SSL_CA: preserve()` to
  the IaC service variables. The database must serve a certificate whose SAN
  matches the hostname in `DATABASE_URL`; trusting a CA does not repair a
  hostname mismatch. If the current database certificate does not match, configure
  a matching server certificate before deploying this change. Never copy an
  unverified certificate from a network connection into the trust configuration.
  Remove URL TLS options; `sslmode=verify-full` is accepted and removed before
  passing the explicit TLS options to pg, so it cannot overwrite the trusted CA.
  Other `ssl*` URL options are rejected. Local development keeps its existing
  connection behavior; setting `DATABASE_SSL_CA` locally also enables verified TLS.
- **Private networking**: use the database's private hostname in the same Railway
  project/environment and remove its public TCP proxy when external access is
  unnecessary. Keep verified database TLS enabled. Check the actual database
  hostname/certificate and connectivity before deployment; the application code
  does not provision server certificates or remove network endpoints. See
  [Railway private networking](https://docs.railway.com/networking/private-networking)
  and [node-postgres TLS configuration](https://node-postgres.com/features/ssl).
- **Migrations & PgBouncer**: the default Postgres is not pooled, so migrations
  run fine. If you later add the PgBouncer plugin, point migrations at
  `DATABASE_UNPOOLED_URL` instead (schema migrations need a dedicated session).
- **Backups**: enable Railway's [PostgreSQL backups][railway-backups]; they are
  off by default. A retention policy for old query results is still open work.
- **pgvector**: the schema does not use vector types yet. When embeddings land,
  enable the extension on the database and keep the pgvector-capable image.
- **Single process**: startup recovery (`store.recover()`) assumes one API
  process. Do not scale to multiple replicas until turn ownership/recovery is
  revisited (see `AGENTS.md`).

[railway-backups]: https://docs.railway.com/databases/postgresql#backups
