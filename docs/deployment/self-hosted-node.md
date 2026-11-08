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

## Dictionary foundation import

The local source is `C:\headswap\Cadence_30k_headwords\dictionary_entries\cadence_dictionary.sqlite3`. Export and verify the package from the repository checkout:

```powershell
python scripts\export-dictionary-foundation.py
node scripts\import-dictionary-foundation.mjs --input-dir C:\headswap\Cadence_30k_headwords\server_upload --verify-only
```

The output is a hashed v2 package containing 770,611 ECDICT records, 30,000 ranked headwords, 4,489 expression-index rows, and the authored layer. It does not belong in Git. Copy the ZIP and `SHA256SUMS.txt` to a private temporary directory on the server, extract the ZIP there, and verify the checksums before database access.

With the new application image built, back up PostgreSQL, apply only the schema migrations, and restart the app:

```sh
docker compose build app
docker compose run --rm app node scripts/db-setup.mjs --migrate-only
docker compose up -d --no-deps app
```

Mount the extracted package read-only into the app container and run its streaming importer:

```sh
docker compose run --rm -v "$PWD/dictionary-import:/dictionary:ro" app node scripts/import-dictionary-foundation.mjs --input-dir /dictionary
```

The importer keeps all three new sources restricted until hashes, counts, authored/ECDICT overlap, OEWN pilots, Round 2 status, and user-data counts pass. It then makes the completed dictionary sources visible together. All 525 Cadence-authored headwords overlap ECDICT and take precedence in effective lookup; the raw ECDICT rows remain stored unchanged for traceability. Wordbook-local fields still take precedence.

The authored layer imports 2,904 senses for 525 headwords and 982 separate headword usage-note rows. It also imports 1,342 curated expression documents containing 1,451 senses and 862 usage notes. Expression documents are keyed by their source-row IDs, so repeated spellings cannot overwrite each other; identical phrase rows are grouped under their parent in the UI. Expression senses and notes remain inside their parent-linked documents; they are not inserted as standalone word senses. The importer cross-checks every headword and expression sense against its document before publishing the source. The complete source total is 1,844 usage notes.

New official and custom book entries are indexed automatically by the `word_entries` trigger, which links the normalized spelling to `lexemes`. Book reads then hydrate shared content in batches. This creates a lookup link without copying the user's private translation into the public dictionary. The hydration query batch is 1,000 words, keeping a 5,000-entry custom book to a small bounded set of database reads.

If the import fails or must be reverted, run `docker compose run --rm app node scripts/rollback-dictionary-foundation.mjs`. This removes only the three foundation sources' rows and verifies that OEWN, Round 2, and user learning rows did not change. It deliberately retains `lexemes`, so existing wordbook links stay valid. The additive schema can remain while the previous app image is restored; do not restore the database backup unless unrelated data also needs recovery.

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

Use `node scripts/db-setup.mjs` once against a fresh database or when applying a reviewed vocabulary-data update. Use `bun run db:migrate` for schema-only changes in a development checkout, or `node scripts/db-setup.mjs --migrate-only` in the production image. Production app startup uses `node .output/server/index.mjs` and never migrates automatically. To roll back an application release, restore the previous image. Do not delete imported OEWN, pilot, or pending editorial rows as an application rollback.

The local end-to-end command `bun run test:self-hosted-postgres` starts an isolated PostgreSQL cluster, initializes it twice, exercises the Node server and owner-scoped learning paths, and reports Node/PostgreSQL memory use. It does not read `.env` or connect to a configured database.

On Windows, run this test under a non-administrator token; PostgreSQL refuses to start under an administrator token. The local verification run passed with a restricted token. It measured the production Node process at about 93 MiB private memory and PostgreSQL at about 62 MiB summed private memory across its worker processes. PostgreSQL's summed working set was about 275 MiB and includes shared pages counted by multiple workers.

For a fresh, low-traffic deployment, 1 vCPU, 1 GiB RAM, and 10 GiB disk are a reasonable minimum starting point. The measured service processes used about 155 MiB private memory together; the rest allows room for the operating system, Docker, PostgreSQL shared buffers, and short-lived imports. Use 2 GiB RAM when you want more operating headroom. This is a baseline estimate, not a load-test result; monitor memory and database growth after launch.
