# Review v1 rollout

This rollout applies migration `0011_review_system_v1_foundation.sql` before merging the application changes to `main`. No production database has been contacted as part of preparing this runbook.

## Follow-up: source-book provenance migration 0013

The project owner has confirmed that 0011 was applied to production and 0012 is present as its marker. The source-provenance fix requires `0013_review_source_provenance.sql` to be applied to an isolated test database, then production, before deploying the application code from this branch. Do not rerun 0011 or 0012 for this follow-up.

Migration 0013 drops only the `review_states.source_book_id → word_books.id` foreign key. The source ID remains nullable text for provenance, can name bundled or deleted books, and is not used to identify or resolve due-review items. The migration is safe to repeat. The review page and due-review server function invoke an authenticated, idempotent repair that rebuilds missing states from included Review v1 session results; legacy attempts without v1 metadata are outside its scan.

For the follow-up verification, run `scripts/verify-review-v1-rls.ps1` against its isolated Docker database. It applies migrations through 0013, verifies that a bundled source ID without a `word_books` row is accepted, and verifies custom-book deletion leaves its review state and source ID intact. Before any production rollout, an authorized human must confirm a restorable backup and the migration ledger, apply only 0013, then verify the foreign key is absent before deploying the application branch. Do not restore the old foreign key unless every stored source ID is known to exist in `word_books`.

The remaining steps below document the original 0011 rollout and are historical for this follow-up. Their 0010 ledger checkpoint, empty-projection expectation, and `ON DELETE SET NULL` assertion do not apply after 0013.

## Migration registration and runner

The migration is registered as index 11 in `drizzle/migrations/meta/_journal.json`. `drizzle.config.ts` points Drizzle Kit at `drizzle/migrations` and reads `LOVABLE_DB_MIGRATION_URL`; there is no repository `migrate` npm script. The SQL file has no explicit `BEGIN`/`COMMIT`. The installed Drizzle PostgreSQL migrator runs pending migrations in a transaction, and records them in `drizzle.__drizzle_migrations`.

Lovable Git sync does not execute migration files. The repository has marker migrations `0008` and `0010` whose comments expect the Drizzle migrator to apply earlier pending files. The available project history does not prove how every production migration was run. Since `0009` was confirmed executed but its execution method and the live migration log have not been checked, it is possible the production database has no Drizzle migration log, or that the log is behind the schema.

**Recommended runner:** use `npx drizzle-kit migrate` only after a human read-only preflight confirms that `drizzle.__drizzle_migrations` exists and its latest row corresponds to migration `0010`. This gives 0011 the journal-based, transactional path. If the table is missing or the latest entry is not 0010, stop; do not run Drizzle Kit blindly because it can try to replay the earlier, non-idempotent `0000` schema migration. In that case, a human must choose a targeted SQL Editor/transactional `psql` execution plan and reconcile the migration ledger before any later Drizzle migration. Lovable does not document SQL Editor batch transaction semantics, so verify those semantics against the test database before relying on SQL Editor atomicity.

Read-only ledger preflight:

```sql
SELECT to_regclass('drizzle.__drizzle_migrations') AS migration_log_table;
```

If the result is not null:

```sql
SELECT id, created_at, hash
FROM drizzle.__drizzle_migrations
ORDER BY created_at DESC
LIMIT 5;
```

The journal timestamp for `0010_apply_pending_0009_marker` is `1790557756797`; compare it with the latest logged migration. If the log is absent, stale, or does not match the known schema, stop and resolve the discrepancy before applying 0011.

## Rollout order

### 1. Apply 0011 to an isolated test database — human action

Use a disposable local PostgreSQL environment with:

```powershell
.\scripts\verify-review-v1-rls.ps1
```

The script creates a no-port, temporary Docker PostgreSQL instance, bootstraps only the minimal Supabase roles and `auth.uid()`, applies migrations `0000–0011`, applies 0011 a second time, and checks old-app attempt writes, ownership RLS, service-role grants, and book deletion. It never reads `.env` or connects to a configured project. If a separate Lovable test project is used, first confirm it is isolated from production and execute only 0011 there using the approved runner above.

**Expected:** the script prints PASS notices for every assertion and exits zero. Any failure means stop; discard/recreate the disposable database or restore the test project from its backup, then fix and rerun before considering production.

### 2. Validate the test database — human action

Confirm all of these before continuing:

- `attempts` has RLS enabled; its insert policy has `WITH CHECK (auth.uid() = user_id)` and its update policy has both owner `USING` and owner `WITH CHECK`.
- All three new tables have RLS enabled and only owner-scoped SELECT policies for `authenticated`.
- `anon` has no SELECT/INSERT/UPDATE/DELETE table privileges on the new tables; `authenticated` has SELECT and no write privileges; `service_role` has the required full privileges.
- `review_states.source_book_id` uses `ON DELETE SET NULL`; session-result and decision `book_id` are not foreign keys.
- A pre-0011-style insert/update to `attempts` still succeeds as its owner after the migration.
- A user cannot see another user's rows, insert a row as another user, or update their own row to another `user_id`.
- Deleting an owned custom book succeeds, leaves the review state with `source_book_id = NULL`, and leaves the historical session/decision `book_id` values intact.
- A second application of 0011 succeeds without duplicate constraints, indexes, policies, or tables.

If any assertion fails, do not continue. For a disposable test database, recreate it. For a test project, restore its backup or use `docs/review-v1-rollback.sql` after confirming the rollback preconditions.

### 3. Back up production — human action

In Lovable Cloud, open **Cloud → Database → Backups** and create or confirm a recent backup that Lovable marks restorable. Record its timestamp/identifier and confirm the restore path. Record pre-migration aggregate counts for `attempts`, `word_books`, and `book_progress`; no user rows should be inserted, updated, or deleted by 0011. Do not continue without a verified backup.

### 4. Apply 0011 to production — human action

Repeat the migration-log preflight. If the latest log entry is 0010 and the runner URL is configured outside the repository, run `npx drizzle-kit migrate` from the checked-out release commit. It should apply only 0011 and record its journal timestamp in the Drizzle log.

If the migration log is missing or does not match 0010, stop. Do not use Drizzle Kit until the historical ledger is reconciled. A targeted SQL Editor or `psql --single-transaction` run must be approved and tested first; never paste prior migrations `0000–0010` into production as a workaround. Do not add or modify credentials in `.env` as part of this step.

**Expected:** migration completes with no errors and the Drizzle log's latest `created_at` corresponds to 0011 (`1790575662388`). The application code has not been merged yet, so the three projection tables should still be empty. Existing attempt and book-progress row counts should match the recorded pre-migration counts.

### 5. Validate production — human action

Run read-only checks in Lovable SQL Editor. Expected values:

```sql
SELECT c.relname, c.relrowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('attempts', 'review_session_results', 'review_schedule_decisions', 'review_states')
ORDER BY c.relname;
```

All four `relrowsecurity` values must be true.

```sql
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('attempts', 'review_session_results', 'review_schedule_decisions', 'review_states')
ORDER BY tablename, policyname;
```

For `attempts`, the insert policy must show the owner check in `with_check`; update must show it in both `qual` and `with_check`. For the three projection tables, only owner-filtered SELECT policies should remain.

```sql
SELECT table_name,
       has_table_privilege('anon', format('public.%I', table_name), 'SELECT') AS anon_select,
       has_table_privilege('anon', format('public.%I', table_name), 'INSERT') AS anon_insert,
       has_table_privilege('anon', format('public.%I', table_name), 'UPDATE') AS anon_update,
       has_table_privilege('anon', format('public.%I', table_name), 'DELETE') AS anon_delete,
       has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT') AS user_select,
       has_table_privilege('authenticated', format('public.%I', table_name), 'INSERT') AS user_insert,
       has_table_privilege('authenticated', format('public.%I', table_name), 'UPDATE') AS user_update,
       has_table_privilege('authenticated', format('public.%I', table_name), 'DELETE') AS user_delete,
       has_table_privilege('service_role', format('public.%I', table_name), 'SELECT') AS service_select,
       has_table_privilege('service_role', format('public.%I', table_name), 'INSERT') AS service_insert,
       has_table_privilege('service_role', format('public.%I', table_name), 'UPDATE') AS service_update,
       has_table_privilege('service_role', format('public.%I', table_name), 'DELETE') AS service_delete
FROM unnest(ARRAY['review_session_results','review_schedule_decisions','review_states']) AS t(table_name)
ORDER BY table_name;
```

Expected: all `anon_*` and authenticated write columns are false; `user_select` and all `service_*` columns are true. Also confirm the migration log is at 0011 and the three projection tables are empty before merging application code. Recheck the aggregate counts recorded in step 3.

Confirm book deletion relationships:

```sql
SELECT tc.table_name, kcu.column_name, ccu.table_name AS referenced_table, rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.constraint_schema = kcu.constraint_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
JOIN information_schema.referential_constraints rc
  ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.constraint_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND ((tc.table_name = 'review_states' AND kcu.column_name = 'source_book_id')
    OR (tc.table_name IN ('review_session_results', 'review_schedule_decisions') AND kcu.column_name = 'book_id'));
```

Expected: one `review_states.source_book_id → word_books.id` row with `delete_rule = SET NULL`; no `book_id` foreign-key rows for session results or decisions.

If any check fails, stop before merging. If the migration is still inside a transaction, let the runner roll it back. If SQL Editor committed a partial batch, restore the backup or, after confirming no 0011 application code has run, use `docs/review-v1-rollback.sql` and verify the old app schema again.

### 6. Merge the application branch to main — human action

Only after production verification passes, merge `feat/review-system-v1-foundation` to the current `main` with a normal merge and deploy the application. This step is intentionally last so the new server code never runs against a schema missing 0011.

If deployment fails before users create v1 attempts, revert the application first, then use the rollback SQL after confirming the backup. If v1 has already recorded data, stop and take a fresh backup before rollback; the rollback drops v1-specific attempt fields and preference columns.

## Rollback behavior

`docs/review-v1-rollback.sql` is a transactional schema rollback. It drops the three derived projection tables, their linked constraints, generated review key and 0011 attempt metadata, plus the new spelling-preference columns. It deliberately leaves the strengthened `attempts` owner `WITH CHECK` policy in place. Run it only after application rollback and a verified backup; it is destructive to data written into 0011-specific columns and tables.

## Human-only operations

Creating/restoring the production backup, checking the production migration ledger, executing the production migration, verifying production data/policies, and merging/deploying to `main` must be performed by an authorized human. This repository preparation does not perform any of those actions.
