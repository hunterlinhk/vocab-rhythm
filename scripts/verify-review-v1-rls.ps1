[CmdletBinding()]
param(
  [string]$PostgresImage = 'postgres:16-alpine',
  [int]$StartupTimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationDir = Join-Path $repoRoot 'drizzle/migrations'
$containerName = 'review-v1-rls-' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
$tempFiles = [System.Collections.Generic.List[string]]::new()

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker CLI is unavailable. This verification was not run.'
}
& docker info *> $null
if ($LASTEXITCODE -ne 0) {
  throw 'Docker is unavailable or the daemon is not running. This verification was not run.'
}

function Write-TempSql {
  param([Parameter(Mandatory)][string]$Content)
  $file = Join-Path ([IO.Path]::GetTempPath()) ('review-v1-' + [Guid]::NewGuid().ToString('N') + '.sql')
  [IO.File]::WriteAllText($file, $Content, [Text.UTF8Encoding]::new($false))
  $tempFiles.Add($file)
  return $file
}

function Invoke-PostgresFile {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Container,
    [switch]$SingleTransaction
  )
  $containerPath = '/tmp/' + [IO.Path]::GetFileName($Path)
  & docker cp $Path ($Container + ':' + $containerPath) *> $null
  if ($LASTEXITCODE -ne 0) { throw "Could not copy SQL test file into temporary PostgreSQL: $([IO.Path]::GetFileName($Path))" }

  $psqlArgs = @(
    'exec', $Container, 'psql', '--no-psqlrc', '--set=ON_ERROR_STOP=1',
    '--username=postgres', '--dbname=review_test'
  )
  if ($SingleTransaction) { $psqlArgs += '--single-transaction' }
  $psqlArgs += @('--file', $containerPath)
  & docker @psqlArgs
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL rejected SQL file: $([IO.Path]::GetFileName($Path))" }
}

$bootstrap = @'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
'@

$rlsChecks = @'
-- Test fixtures are inserted as the server role, matching its intended write boundary.
SET ROLE service_role;
INSERT INTO public.word_books (id, name, source, owner_user_id)
VALUES ('rls-test-book', 'RLS test book', 'custom', '11111111-1111-4111-8111-111111111111');
INSERT INTO public.word_entries (book_id, position, word) VALUES ('rls-test-book', 0, 'shared word');

INSERT INTO public.attempts (id, user_id, mode, book_id, word, correct)
VALUES
  ('22222222-2222-4222-8222-222222222221', '11111111-1111-4111-8111-111111111111', 'memorize', 'rls-test-book', 'shared word', true),
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111112', 'memorize', 'other-book', 'shared word', true);

INSERT INTO public.review_session_results
  (user_id, book_id, word, word_key, review_mode, session_id, last_attempt_id, outcome, counted_for_review,
   final_correct, completed_at, time_zone, learning_day, source_fingerprint)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'rls-test-book', 'shared word', 'shared word', 'recognition',
   '33333333-3333-4333-8333-333333333331', '22222222-2222-4222-8222-222222222221', 'smooth', true, true,
   now(), 'UTC', current_date, 'a'),
  ('11111111-1111-4111-8111-111111111112', 'other-book', 'shared word', 'shared word', 'recognition',
   '33333333-3333-4333-8333-333333333332', '22222222-2222-4222-8222-222222222222', 'smooth', true, true,
   now(), 'UTC', current_date, 'b');

INSERT INTO public.review_schedule_decisions
  (decision_id, user_id, book_id, word, word_key, review_mode, session_id, decision_revision, learning_day,
   session_outcome, effective_inclusion, is_initial_learning, state_advanced, interval_advanced,
   schedule_action, decision_reason, scheduler_version, input_fingerprint, before_state, after_state)
VALUES
  ('44444444-4444-4444-8444-444444444441', '11111111-1111-4111-8111-111111111111', 'rls-test-book',
   'shared word', 'shared word', 'recognition', '33333333-3333-4333-8333-333333333331', 0, current_date,
   'smooth', true, true, true, false, 'initialize', 'first_learning', 'test', 'a', '{}'::jsonb, '{}'::jsonb),
  ('44444444-4444-4444-8444-444444444442', '11111111-1111-4111-8111-111111111112', 'other-book',
   'shared word', 'shared word', 'recognition', '33333333-3333-4333-8333-333333333332', 0, current_date,
   'smooth', true, true, true, false, 'initialize', 'first_learning', 'test', 'b', '{}'::jsonb, '{}'::jsonb);

INSERT INTO public.review_states (user_id, source_book_id, word, word_key, review_mode, last_decision_id)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'rls-test-book', 'shared word', 'shared word', 'recognition',
   '44444444-4444-4444-8444-444444444441'),
  ('11111111-1111-4111-8111-111111111112', NULL, 'shared word', 'shared word', 'recognition',
   '44444444-4444-4444-8444-444444444442');
RESET ROLE;

-- Authenticated user A can see its own row in each table, but none of B's rows.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.attempts) <> 1 THEN RAISE EXCEPTION 'attempts RLS isolation failed'; END IF;
  IF (SELECT count(*) FROM public.review_session_results) <> 1 THEN RAISE EXCEPTION 'session-result RLS isolation failed'; END IF;
  IF (SELECT count(*) FROM public.review_schedule_decisions) <> 1 THEN RAISE EXCEPTION 'decision RLS isolation failed'; END IF;
  IF (SELECT count(*) FROM public.review_states) <> 1 THEN RAISE EXCEPTION 'review-state RLS isolation failed'; END IF;
  RAISE NOTICE 'PASS: user A reads its own rows and cannot read user B rows';
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.attempts (user_id, mode, book_id, word)
    VALUES ('11111111-1111-4111-8111-111111111112', 'word', 'other-book', 'forged insert');
    RAISE EXCEPTION 'RLS unexpectedly accepted an insert for user B';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE public.attempts
    SET user_id = '11111111-1111-4111-8111-111111111112'
    WHERE id = '22222222-2222-4222-8222-222222222221';
    RAISE EXCEPTION 'RLS unexpectedly accepted changing user_id to user B';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'PASS: attempts INSERT and UPDATE WITH CHECK reject cross-user ownership';
END $$;

-- An old application version omits all 0011 columns and can still insert/update attempts.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
INSERT INTO public.attempts
  (id, user_id, mode, book_id, word, translation, correct, mistouch, typo_count, duration_ms, is_review, skipped)
VALUES
  ('22222222-2222-4222-8222-222222222223', '11111111-1111-4111-8111-111111111111', 'word',
   'rls-test-book', 'old client write', NULL, true, false, 0, 10, false, false);
UPDATE public.attempts SET mistouch = true
WHERE id = '22222222-2222-4222-8222-222222222223';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.attempts
    WHERE id = '22222222-2222-4222-8222-222222222223'
      AND review_mode IS NULL AND counted_for_review IS NULL AND mistouch
  ) THEN RAISE EXCEPTION 'old-style attempt write did not survive migration'; END IF;
  RAISE NOTICE 'PASS: pre-0011 attempt insert/update remains compatible';
END $$;
RESET ROLE;

-- Anonymous users have no table privileges at all; authenticated users can only read projections.
SET ROLE anon;
DO $$
DECLARE
  table_name text;
  privilege_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['review_session_results', 'review_schedule_decisions', 'review_states'] LOOP
    FOREACH privilege_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF has_table_privilege(current_user, format('public.%I', table_name), privilege_name) THEN
        RAISE EXCEPTION 'anon unexpectedly has % on %', privilege_name, table_name;
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'PASS: anon has no read/write privileges on all projection tables';
END $$;
RESET ROLE;

SET ROLE authenticated;
DO $$
DECLARE
  table_name text;
  privilege_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['review_session_results', 'review_schedule_decisions', 'review_states'] LOOP
    IF NOT has_table_privilege(current_user, format('public.%I', table_name), 'SELECT') THEN
      RAISE EXCEPTION 'authenticated is missing SELECT on %', table_name;
    END IF;
    FOREACH privilege_name IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
      IF has_table_privilege(current_user, format('public.%I', table_name), privilege_name) THEN
        RAISE EXCEPTION 'authenticated unexpectedly has % on %', privilege_name, table_name;
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'PASS: authenticated can read but cannot write the three projections, including decision UPDATE/DELETE';
END $$;
RESET ROLE;

DO $$
DECLARE
  table_name text;
  privilege_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['review_session_results', 'review_schedule_decisions', 'review_states'] LOOP
    FOREACH privilege_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF NOT has_table_privilege('service_role', format('public.%I', table_name), privilege_name) THEN
        RAISE EXCEPTION 'service_role is missing % on %', privilege_name, table_name;
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'PASS: service_role retains full projection-table privileges';
END $$;

-- Deleting an owned custom book sets only the nullable provenance FK to NULL.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
DELETE FROM public.word_books WHERE id = 'rls-test-book';
RESET ROLE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.word_books WHERE id = 'rls-test-book') THEN
    RAISE EXCEPTION 'custom book delete failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.review_states
    WHERE user_id = '11111111-1111-4111-8111-111111111111'
      AND word_key = 'shared word' AND source_book_id IS NULL
  ) THEN RAISE EXCEPTION 'review state was deleted instead of clearing source_book_id'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.review_session_results
    WHERE user_id = '11111111-1111-4111-8111-111111111111' AND book_id = 'rls-test-book'
  ) THEN RAISE EXCEPTION 'session result book_id was not preserved'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.review_schedule_decisions
    WHERE user_id = '11111111-1111-4111-8111-111111111111' AND book_id = 'rls-test-book'
  ) THEN RAISE EXCEPTION 'decision book_id was not preserved'; END IF;
  RAISE NOTICE 'PASS: deleting the custom book preserves review rows and clears source_book_id';
END $$;
SELECT 'PASS: local review v1 RLS verification complete' AS result;
'@

try {
  & docker run --detach --rm --name $containerName --network none `
    --tmpfs '/var/lib/postgresql/data:rw,size=1g' `
    --env POSTGRES_HOST_AUTH_METHOD=trust `
    --env POSTGRES_DB=review_test `
    $PostgresImage *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Could not start temporary PostgreSQL container.' }

  $deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
  $ready = $false
  while ([DateTime]::UtcNow -lt $deadline) {
    & docker exec $containerName pg_isready --username=postgres --dbname=review_test *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 750
  }
  if (-not $ready) { throw 'Temporary PostgreSQL did not become ready in time.' }

  $bootstrapFile = Write-TempSql -Content $bootstrap
  Invoke-PostgresFile -Path $bootstrapFile -Container $containerName -SingleTransaction

  $migrations = Get-ChildItem -Path $migrationDir -Filter '*.sql' |
    Where-Object { $_.Name -match '^\d{4}_.*\.sql$' } |
    Sort-Object Name
  if ($migrations.Count -ne 12) {
    throw "Expected migrations 0000–0011 (12 files); found $($migrations.Count)."
  }
  foreach ($migration in $migrations) {
    Write-Host ("Applying " + $migration.Name)
    Invoke-PostgresFile -Path $migration.FullName -Container $containerName -SingleTransaction
  }

  Write-Host 'Reapplying 0011 to verify repeatability'
  Invoke-PostgresFile -Path (Join-Path $migrationDir '0011_review_system_v1_foundation.sql') -Container $containerName -SingleTransaction

  $checksFile = Write-TempSql -Content $rlsChecks
  Invoke-PostgresFile -Path $checksFile -Container $containerName -SingleTransaction
  Write-Host 'Local PostgreSQL RLS verification passed.'
}
finally {
  & docker rm --force $containerName *> $null
  foreach ($file in $tempFiles) {
    Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
  }
}
