# Self-hosted Node deployment

Cadence runs on Node.js 22.12 or newer with PostgreSQL. Better Auth handles email/password accounts, Google OAuth, anonymous sessions, and cookies. Drizzle is the only application database layer. Caddy can terminate HTTPS and proxy requests to the Node process.

## Local setup

Copy `.env.example` to `.env`, set a PostgreSQL connection string and a random `BETTER_AUTH_SECRET` of at least 32 characters, then run:

```sh
bun install --frozen-lockfile
bun run db:setup
bun run dev
```

`db:setup` applies the Drizzle migrations and idempotently imports NGSL 1.2, the full OEWN dataset, the 26 reviewed pilots, and all 88 Round 2 editorial records. Round 2 rows remain restricted and `pending_review`. Re-running the command verifies source hashes and does not duplicate data. `bun run db:migrate` applies only migrations.

## Docker Compose

Set `POSTGRES_PASSWORD` to a URL-safe random value such as the output of `openssl rand -hex 32`. Set `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and `APP_ORIGIN` in `.env`. For Google sign-in, supply both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; leave both empty to disable Google locally.

Initialize a new database and its vocabulary data, then start the Node service:

```sh
docker compose run --rm app node scripts/db-setup.mjs
docker compose up -d app
```

PostgreSQL data is stored in the `cadence-postgres` volume. The app listens on `127.0.0.1:3000`, so a host Caddy service can proxy to it. The Node startup command does not run migrations or import data. Back up the PostgreSQL volume or use `pg_dump` before schema changes.

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection used by the app and migration/data setup commands |
| `BETTER_AUTH_SECRET` | yes | Random server secret, at least 32 characters |
| `BETTER_AUTH_URL` | yes in production | Public canonical app URL used for cookies and OAuth callbacks |
| `APP_ORIGIN` | yes in production | Trusted browser origin, including scheme and host |
| `GOOGLE_CLIENT_ID` | optional | Google OAuth client ID; configure the Better Auth callback at `/api/auth/callback/google` |
| `GOOGLE_CLIENT_SECRET` | optional | Google OAuth client secret; supply it together with the client ID |
| `HOST` / `PORT` | no | Node bind address and port; default to `0.0.0.0:3000` in the container |
| `DB_POOL_SIZE` | no | Maximum PostgreSQL connections per Node process; defaults to `5` |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | no | Optional AI integration; the assistant is disabled by default |

For Caddy, preserve the original `Host` header and forward `X-Forwarded-For` and `X-Forwarded-Proto`. Set `BETTER_AUTH_URL` and `APP_ORIGIN` to the public HTTPS origin. Google OAuth must use that origin with the callback path above. Do not expose PostgreSQL's port publicly.

## Operations

Use `node scripts/db-setup.mjs` once against a fresh database or when applying a reviewed vocabulary-data update. Use `bun run db:migrate` for schema-only changes in a development checkout. Production app startup uses `node .output/server/index.mjs` and never migrates automatically. To roll back an application release, restore the previous image; to reverse a database migration, use a reviewed down migration or restore the PostgreSQL backup. Do not delete imported OEWN, pilot, or pending editorial rows as an application rollback.

The local end-to-end command `bun run test:self-hosted-postgres` starts an isolated PostgreSQL cluster, initializes it twice, exercises the Node server and owner-scoped learning paths, and reports Node/PostgreSQL memory use. It does not read `.env` or connect to a configured database.

On Windows, run this test under a non-administrator token; PostgreSQL refuses to start under an administrator token. The local verification run passed with a restricted token. It measured the production Node process at about 93 MiB private memory and PostgreSQL at about 62 MiB summed private memory across its worker processes. PostgreSQL's summed working set was about 275 MiB and includes shared pages counted by multiple workers.

For a fresh, low-traffic deployment, 1 vCPU, 1 GiB RAM, and 10 GiB disk are a reasonable minimum starting point. The measured service processes used about 155 MiB private memory together; the rest allows room for the operating system, Docker, PostgreSQL shared buffers, and short-lived imports. Use 2 GiB RAM when you want more operating headroom. This is a baseline estimate, not a load-test result; monitor memory and database growth after launch.
