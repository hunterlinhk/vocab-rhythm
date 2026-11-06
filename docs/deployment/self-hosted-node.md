# Self-hosted Node deployment

The app builds with Nitro's `node-server` preset and runs on Node.js 22.12 or newer:

```sh
bun install --frozen-lockfile
bun run build
bun run start
```

The build output is `.output/`. The runtime entry is `.output/server/index.mjs`; `start` runs it with Node. Nitro reads `NITRO_PORT` or `PORT` (default `3000`) and `NITRO_HOST` or `HOST`. The actual port, bind address, TLS termination, health checks, and restart policy must match the Alibaba Cloud service and reverse-proxy configuration.

## Supabase configuration

The browser and server can use separate API URLs. Browser values are compiled into the client bundle; they must be present during `bun run build`:

| Variable | Scope | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Build time, public | Supabase API URL reachable by users' browsers |
| `VITE_SUPABASE_PUBLISHABLE_KEY` or `VITE_SUPABASE_ANON_KEY` | Build time, public | Supabase publishable/legacy anon key |
| `SUPABASE_URL` | Node runtime | Supabase API URL reachable by the Node service; may be an internal URL |
| `SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_ANON_KEY` | Node runtime | Public key used by authenticated server functions |
| `SUPABASE_SERVICE_ROLE_KEY` | Node runtime, secret | Admin operations that intentionally bypass RLS |
| `DATABASE_URL` | Migration CLI only, secret | Direct PostgreSQL connection for Drizzle migrations; the app runtime does not use it |

Never use a service-role or secret key in a `VITE_` variable. The browser client uses Supabase Auth's normal browser storage and sends the signed-in user's bearer token to TanStack server functions. Those functions validate the token and query Supabase with the user's key and token, preserving RLS. Admin operations use the service-role key only on the server.

## Supabase Auth setup

The self-hosted Auth service must allow the sign-in methods the product uses: email/password, Google OAuth, and anonymous sign-in. Set its site URL to the final app origin and allow the app's `/learn` redirect URI. Configure the Google provider and its callback URL in Supabase Auth. Email confirmation links must also return to the app origin. The application now calls Supabase Auth directly; it no longer uses Lovable's OAuth broker.

The public API URL, internal API URL, key format, migration connection, Auth provider settings, redirect allowlist, email delivery, TLS, and reverse-proxy behavior are not known in this repository. `supabase/config.toml` also contains an existing project identifier that must be checked against the target before using Supabase CLI commands. The infrastructure owner must provide and verify these values. Verify sign-up, email confirmation, Google sign-in, anonymous sign-in, token refresh, and an authenticated server-function request against the migrated instance before release.

## Optional integrations

- The AI assistant is disabled in application code. If it is re-enabled, configure `OPENAI_API_KEY` and `OPENAI_MODEL`; `OPENAI_BASE_URL` is optional. The configured endpoint must support the OpenAI Responses API used by the current adapter. The provider, model, endpoint, and credentials remain an infrastructure/product decision.
- `CRON_SECRET` and optional `CRON_SECRET_PREVIOUS` are used by the generic cron request authenticator if a scheduled route is enabled. No cron route is currently wired to it.

## Release handoff

Before release, the infrastructure owner should confirm the Node version, service start command, port/bind settings, public and internal Supabase URLs, public and service-role keys, direct `DATABASE_URL`, target Supabase CLI project identifier, database migration status, Auth provider and email settings, domain and TLS, reverse-proxy headers, and backup/restore procedure. Database migrations remain explicit operations and are not run by the Node app's startup command.
