# Cadence self-hosted backend rewrite

## Goal

Replace Supabase Auth, its SDK/PostgREST/RPC access, and all Lovable runtime dependencies with Better Auth, Drizzle, PostgreSQL, and the existing TanStack Start Node server. Keep the existing learning flows, scheduling behavior, statistics, lexicon, 2,809 NGSL entries, 19,028 OEWN candidates, 26 pilots, and 88 pending Round 2 records.

## Constraints

- Work on `feat/self-hosted-better-auth-postgres`, based on `6467cbed0df8eb9ea3ecd8f142e69f743e1e0e59`.
- No migration of old Supabase users, passwords, or sessions.
- No access to Lovable production data or Alibaba Cloud business services; no cutover.
- Enforce user ownership in server-side Drizzle queries. Keep all editorial rows pending and restricted.
- Validate against a real disposable local PostgreSQL instance, not only PGlite. Docker and `psql` are unavailable in this workstation; use the bundled `embedded-postgres` test server.

## Plan

1. Inventory the current schema, query paths, data packs, auth flows, and test seams.
2. Define the complete Better Auth and Cadence Drizzle schema; replace Supabase migrations with a clean-from-zero PostgreSQL migration without RLS, Supabase roles, `auth.uid()`, or RPCs.
3. Implement Better Auth email/password, Google OAuth, anonymous sessions, and TanStack server auth context.
4. Replace every PostgREST/RPC call with Drizzle repositories and owner-scoped server functions while preserving learning and review algorithms.
5. Add deterministic, rerunnable local data initialization for NGSL, full OEWN, pilot, and pending Round 2 editorial data.
6. Run the complete suite, TypeScript, production build, local PostgreSQL auth/ownership/learning/lexicon E2E, and memory measurements.
7. Add an environment template and Docker Compose or equivalent deployment handoff; commit and push only this feature branch.

## Current checkpoint

- Implementation is complete on `feat/self-hosted-better-auth-postgres`; no production DB, Alibaba Cloud service, domain, site cutover, or merge was touched.
- The new schema and clean-from-zero migrations cover Better Auth, profiles, attempts, progress, mastery, review settings/results/decisions/states, private books, NGSL, shared lexicon, provenance, and editorial publication fields. User data access is scoped in the server store and auth middleware.
- `scripts/db-setup.mjs` applies migrations and repeatably imports 2,809 NGSL words, 19,028 OEWN candidate senses, 26 reviewed pilots, and 88 pending/restricted Round 2 records.
- `.env.example`, `Dockerfile`, `compose.yaml`, and `docs/deployment/self-hosted-node.md` provide local and server handoff instructions. Caddy remains a reverse proxy only.
- Final validation before push: 105/105 tests; TypeScript; production Node build; frozen Bun lockfile; real PostgreSQL E2E including repeated initialization, OAuth redirect generation, email sign-up/login, guest session/linking, permission isolation, learning, review, stats, lexicon, and pending-content gates.
- E2E process memory: Node 93 MiB private; PostgreSQL 62 MiB summed private across workers. Shared-page working-set sum is higher and should not be treated as unique memory.
- Pushed to GitHub at `cba51cc17a1c91f601637038e85392e7a10730ff`; local HEAD and upstream tracking ref match. GitHub API was used after local DNS could not resolve `github.com`.

## Validation log

- `bun run test`: 105 passed, 0 failed.
- `bunx tsc --noEmit`: passed.
- `bun run build`: passed; Nitro output targets `.output/server/index.mjs`.
- `bun install --frozen-lockfile`: passed with no lockfile changes.
- `node scripts/test-self-hosted-postgres.mjs`: passed against disposable PostgreSQL under a restricted Windows token; import counts and behavior checks passed.
- `node scripts/prepare-cadence-round2-editorial.mjs --check`: 88 generated rows verified.
