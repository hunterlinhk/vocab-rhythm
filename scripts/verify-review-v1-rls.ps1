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

$preScopeFixture = @'
-- Seed valid pre-0015 Review data, including source ids with no word_books row.
SET ROLE service_role;
INSERT INTO public.user_settings (user_id)
VALUES ('55555555-5555-4555-8555-555555555555');

INSERT INTO public.attempts
  (id, user_id, mode, book_id, word, correct, review_mode, counted_for_review, review_session_id, session_stage, time_zone)
VALUES
  ('66666666-6666-4666-8666-666666666661', '55555555-5555-4555-8555-555555555555', 'memorize', 'ngsl-1.2', 'Scope Migration', true, 'recognition', true, '77777777-7777-4777-8777-777777777771', 'context', 'UTC'),
  ('66666666-6666-4666-8666-666666666662', '55555555-5555-4555-8555-555555555555', 'memorize', 'deleted-custom-book', 'Scope Migration', true, 'recognition', true, '77777777-7777-4777-8777-777777777772', 'context', 'UTC');

INSERT INTO public.review_session_results
  (user_id, book_id, word, word_key, review_mode, session_id, last_attempt_id, outcome, counted_for_review,
   final_correct, completed_at, time_zone, learning_day, source_fingerprint)
VALUES
  ('55555555-5555-4555-8555-555555555555', 'ngsl-1.2', 'Scope Migration', 'scope migration', 'recognition',
   '77777777-7777-4777-8777-777777777771', '66666666-6666-4666-8666-666666666661', 'smooth', true, true,
   now(), 'UTC', current_date, 'pre-scope-ngsl'),
  ('55555555-5555-4555-8555-555555555555', 'deleted-custom-book', 'Scope Migration', 'scope migration', 'recognition',
   '77777777-7777-4777-8777-777777777772', '66666666-6666-4666-8666-666666666662', 'strained', true, true,
   now(), 'UTC', current_date, 'pre-scope-deleted');

INSERT INTO public.review_schedule_decisions
  (decision_id, user_id, book_id, word, word_key, review_mode, session_id, decision_revision, learning_day,
   session_outcome, effective_inclusion, is_initial_learning, state_advanced, interval_advanced,
   schedule_action, decision_reason, scheduler_version, input_fingerprint, before_state, after_state)
VALUES
  ('88888888-8888-4888-8888-888888888881', '55555555-5555-4555-8555-555555555555', 'ngsl-1.2',
   'Scope Migration', 'scope migration', 'recognition', '77777777-7777-4777-8777-777777777771', 0, current_date,
   'smooth', true, true, true, false, 'initialize', 'first_learning', 'pre-scope-test', 'ngsl', '{}'::jsonb, '{}'::jsonb),
  ('88888888-8888-4888-8888-888888888882', '55555555-5555-4555-8555-555555555555', 'deleted-custom-book',
   'Scope Migration', 'scope migration', 'recognition', '77777777-7777-4777-8777-777777777772', 0, current_date,
   'strained', true, false, true, false, 'hold', 'same_day_repeat', 'pre-scope-test', 'deleted', '{}'::jsonb, '{}'::jsonb);

INSERT INTO public.review_states
  (user_id, source_book_id, word, word_key, review_mode, last_attempt_id, last_session_id,
   last_decision_id, last_learning_day, scheduler_version)
VALUES
  ('55555555-5555-4555-8555-555555555555', 'deleted-custom-book', 'Scope Migration', 'scope migration',
   'recognition', '66666666-6666-4666-8666-666666666662', '77777777-7777-4777-8777-777777777772',
   '88888888-8888-4888-8888-888888888882', current_date, 'pre-scope-test');
RESET ROLE;
'@

$scopeChecks = @'
DO $$
DECLARE
  state_pk text;
  decision_unique text;
BEGIN
  IF (SELECT share_review_progress FROM public.user_settings
      WHERE user_id = '55555555-5555-4555-8555-555555555555') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'existing user did not receive the default cross-book sharing setting';
  END IF;
  IF (SELECT count(*) FROM public.review_session_results
      WHERE user_id = '55555555-5555-4555-8555-555555555555') <> 2 THEN
    RAISE EXCEPTION '0015 changed or lost pre-existing session results';
  END IF;
  IF (SELECT count(*) FROM public.review_schedule_decisions
      WHERE user_id = '55555555-5555-4555-8555-555555555555' AND scope_key = 'shared') <> 2 THEN
    RAISE EXCEPTION '0015 did not preserve pre-existing decisions in the shared scope';
  END IF;
  IF (SELECT count(*) FROM public.review_states
      WHERE user_id = '55555555-5555-4555-8555-555555555555'
        AND scope_key = 'shared' AND source_book_id = 'deleted-custom-book'
        AND last_decision_id = '88888888-8888-4888-8888-888888888882') <> 1 THEN
    RAISE EXCEPTION '0015 did not preserve the old state and its decision/source provenance';
  END IF;
  SELECT pg_get_constraintdef(oid) INTO state_pk
    FROM pg_constraint WHERE conrelid = 'public.review_states'::regclass AND contype = 'p';
  IF state_pk IS NULL OR state_pk NOT LIKE '%scope_key%' THEN
    RAISE EXCEPTION 'review_states primary key does not include scope_key: %', state_pk;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO decision_unique
    FROM pg_constraint
   WHERE conrelid = 'public.review_schedule_decisions'::regclass
     AND conname = 'review_schedule_decisions_scope_revision_unique';
  IF decision_unique IS NULL OR decision_unique NOT LIKE '%scope_key%' THEN
    RAISE EXCEPTION 'decision revision uniqueness does not include scope_key: %', decision_unique;
  END IF;
  IF col_description('public.review_states'::regclass, (
       SELECT attnum FROM pg_attribute WHERE attrelid = 'public.review_states'::regclass AND attname = 'word_key'
     )) NOT LIKE '%review_mode + scope_key%' THEN
    RAISE EXCEPTION 'review_states.word_key database comment still describes unconditional shared identity';
  END IF;
  IF col_description('public.review_session_results'::regclass, (
       SELECT attnum FROM pg_attribute WHERE attrelid = 'public.review_session_results'::regclass AND attname = 'book_id'
     )) NOT LIKE '%shared or book-local%' THEN
    RAISE EXCEPTION 'review_session_results.book_id database comment does not describe both scopes';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_book_review_settings'::regclass) THEN
    RAISE EXCEPTION 'user_book_review_settings RLS is not enabled';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.user_book_review_settings'::regclass
       AND contype = 'f' AND confrelid = 'public.word_books'::regclass
  ) THEN RAISE EXCEPTION 'book review settings unexpectedly depend on word_books'; END IF;
  RAISE NOTICE 'PASS: 0015 preserves pre-existing Review rows and migrates their identity to shared scope';
END $$;

INSERT INTO public.user_book_review_settings (user_id, book_id)
VALUES
  ('55555555-5555-4555-8555-555555555555', 'ngsl-1.2'),
  ('55555555-5555-4555-8555-555555555555', 'deleted-custom-book');
DO $$
BEGIN
  IF (SELECT count(*) FROM public.user_book_review_settings
      WHERE user_id = '55555555-5555-4555-8555-555555555555' AND include_in_review) <> 2 THEN
    RAISE EXCEPTION 'book review setting default is not enabled';
  END IF;

  INSERT INTO public.review_states (user_id, source_book_id, word, word_key, review_mode, scope_key)
  VALUES
    ('55555555-5555-4555-8555-555555555555', 'ngsl-1.2', 'Scope Migration', 'scope migration', 'recognition', 'book:ngsl-1.2'),
    ('55555555-5555-4555-8555-555555555555', 'deleted-custom-book', 'Scope Migration', 'scope migration', 'recognition', 'book:deleted-custom-book'),
    ('55555555-5555-4555-8555-555555555555', NULL, 'Scope Migration', 'scope migration', 'spelling', 'shared');

  IF (SELECT count(*) FROM public.review_states
      WHERE user_id = '55555555-5555-4555-8555-555555555555' AND word_key = 'scope migration') <> 4 THEN
    RAISE EXCEPTION 'same word did not retain independent modes and scopes';
  END IF;

  BEGIN
    INSERT INTO public.review_states (user_id, word, word_key, review_mode, scope_key)
    VALUES ('55555555-5555-4555-8555-555555555555', 'Scope Migration', 'scope migration', 'recognition', 'book:ngsl-1.2');
    RAISE EXCEPTION 'review state duplicate scope identity unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.review_states (user_id, word, word_key, review_mode, scope_key)
    VALUES ('55555555-5555-4555-8555-555555555555', 'Invalid Scope', 'invalid scope', 'recognition', 'invalid');
    RAISE EXCEPTION 'invalid review state scope unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- The new uniqueness includes scope_key: one source-session revision can be represented in another projection.
INSERT INTO public.review_schedule_decisions
  (decision_id, user_id, book_id, word, word_key, review_mode, session_id, decision_revision, scope_key,
   learning_day, session_outcome, effective_inclusion, state_advanced, interval_advanced,
   schedule_action, decision_reason, scheduler_version, input_fingerprint, before_state, after_state)
VALUES
  ('99999999-9999-4999-8999-999999999991', '55555555-5555-4555-8555-555555555555', 'ngsl-1.2',
   'Scope Migration', 'scope migration', 'recognition', '77777777-7777-4777-8777-777777777771', 0, 'book:ngsl-1.2',
   current_date, 'smooth', true, true, false, 'initialize', 'first_learning', 'scope-test', 'scoped-revision', '{}'::jsonb, '{}'::jsonb);
DO $$
BEGIN
  BEGIN
    INSERT INTO public.review_schedule_decisions
      (decision_id, user_id, book_id, word, word_key, review_mode, session_id, decision_revision, scope_key,
       learning_day, session_outcome, state_advanced, interval_advanced, schedule_action, decision_reason,
       scheduler_version, input_fingerprint, before_state, after_state)
    VALUES
      ('99999999-9999-4999-8999-999999999992', '55555555-5555-4555-8555-555555555555', 'ngsl-1.2',
       'Scope Migration', 'scope migration', 'recognition', '77777777-7777-4777-8777-777777777771', 0, 'book:ngsl-1.2',
       current_date, 'smooth', true, false, 'initialize', 'first_learning', 'scope-test', 'duplicate-scoped-revision', '{}'::jsonb, '{}'::jsonb);
    RAISE EXCEPTION 'duplicate decision revision in same scope unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.review_schedule_decisions
      (decision_id, user_id, book_id, word, word_key, review_mode, session_id, decision_revision, scope_key,
       learning_day, state_advanced, interval_advanced, schedule_action, decision_reason,
       scheduler_version, input_fingerprint, before_state, after_state)
    VALUES
      ('99999999-9999-4999-8999-999999999993', '55555555-5555-4555-8555-555555555555', 'ngsl-1.2',
       'Scope Migration', 'scope migration', 'recognition', '77777777-7777-4777-8777-777777777771', 1, 'invalid',
       current_date, true, false, 'initialize', 'first_learning', 'scope-test', 'invalid-scope', '{}'::jsonb, '{}'::jsonb);
    RAISE EXCEPTION 'invalid decision scope unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS: per-book and shared states coexist; scope constraints and scoped decision revisions hold';
END $$;
'@

$rlsChecks = @'
-- Test fixtures are inserted as the server role, matching its intended write boundary.
SET ROLE service_role;
INSERT INTO public.word_books (id, name, source, owner_user_id)
VALUES ('rls-test-book', 'RLS test book', 'custom', '11111111-1111-4111-8111-111111111111');
INSERT INTO public.word_entries (book_id, position, word) VALUES ('rls-test-book', 0, 'shared word');
INSERT INTO public.user_book_review_settings (user_id, book_id, include_in_review)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'rls-test-book', true),
  ('11111111-1111-4111-8111-111111111111', 'ngsl-1.2', false),
  ('11111111-1111-4111-8111-111111111111', 'deleted-review-setting', true),
  ('11111111-1111-4111-8111-111111111112', 'ngsl-1.2', true);

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

-- A bundled source need not have a word_books row; this remains provenance only.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.word_books WHERE id = 'ngsl-1.2') THEN
    RAISE EXCEPTION 'RLS fixture unexpectedly registered the bundled NGSL id';
  END IF;
END $$;
INSERT INTO public.review_states (user_id, source_book_id, word, word_key, review_mode)
VALUES ('11111111-1111-4111-8111-111111111111', 'ngsl-1.2', 'bundled word', 'bundled word', 'spelling');
RESET ROLE;

-- Authenticated user A can see its own row in each table, but none of B's rows.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.attempts) <> 1 THEN RAISE EXCEPTION 'attempts RLS isolation failed'; END IF;
  IF (SELECT count(*) FROM public.review_session_results) <> 1 THEN RAISE EXCEPTION 'session-result RLS isolation failed'; END IF;
  IF (SELECT count(*) FROM public.review_schedule_decisions) <> 1 THEN RAISE EXCEPTION 'decision RLS isolation failed'; END IF;
  IF (SELECT count(*) FROM public.review_states) <> 2 THEN RAISE EXCEPTION 'review-state RLS isolation failed'; END IF;
  IF (SELECT count(*) FROM public.user_book_review_settings) <> 3 THEN RAISE EXCEPTION 'book-review-settings RLS isolation failed'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_book_review_settings WHERE user_id = '11111111-1111-4111-8111-111111111112') THEN
    RAISE EXCEPTION 'book-review-settings RLS exposed user B settings';
  END IF;
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

DO $$
BEGIN
  BEGIN
    INSERT INTO public.user_book_review_settings (user_id, book_id, include_in_review)
    VALUES ('11111111-1111-4111-8111-111111111112', 'forged-book-setting', false);
    RAISE EXCEPTION 'book review settings unexpectedly accepted an insert for user B';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE public.user_book_review_settings
       SET user_id = '11111111-1111-4111-8111-111111111112'
     WHERE user_id = '11111111-1111-4111-8111-111111111111' AND book_id = 'rls-test-book';
    RAISE EXCEPTION 'book review settings unexpectedly accepted changing user_id to user B';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF has_table_privilege(current_user, 'public.user_book_review_settings', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated unexpectedly has DELETE on user_book_review_settings';
  END IF;
  RAISE NOTICE 'PASS: book review settings enforce owner INSERT/UPDATE checks and deny DELETE';
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
  FOREACH table_name IN ARRAY ARRAY['review_session_results', 'review_schedule_decisions', 'review_states', 'user_book_review_settings'] LOOP
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
  FOREACH privilege_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE'] LOOP
    IF NOT has_table_privilege(current_user, 'public.user_book_review_settings', privilege_name) THEN
      RAISE EXCEPTION 'authenticated is missing % on user_book_review_settings', privilege_name;
    END IF;
  END LOOP;
  IF has_table_privilege(current_user, 'public.user_book_review_settings', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated unexpectedly has DELETE on user_book_review_settings';
  END IF;
  RAISE NOTICE 'PASS: authenticated can read but cannot write the three projections, including decision UPDATE/DELETE';
END $$;
RESET ROLE;

DO $$
DECLARE
  table_name text;
  privilege_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['review_session_results', 'review_schedule_decisions', 'review_states', 'user_book_review_settings'] LOOP
    FOREACH privilege_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF NOT has_table_privilege('service_role', format('public.%I', table_name), privilege_name) THEN
        RAISE EXCEPTION 'service_role is missing % on %', privilege_name, table_name;
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'PASS: service_role retains full projection-table privileges';
END $$;

-- Deleting an owned custom book retains source provenance without affecting the review state.
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
      AND word_key = 'shared word' AND source_book_id = 'rls-test-book'
  ) THEN RAISE EXCEPTION 'review state or its source provenance was lost'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.review_states
    WHERE user_id = '11111111-1111-4111-8111-111111111111'
      AND word_key = 'bundled word' AND source_book_id = 'ngsl-1.2'
  ) THEN RAISE EXCEPTION 'bundled source without a word_books row was not retained'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.review_session_results
    WHERE user_id = '11111111-1111-4111-8111-111111111111' AND book_id = 'rls-test-book'
  ) THEN RAISE EXCEPTION 'session result book_id was not preserved'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.review_schedule_decisions
    WHERE user_id = '11111111-1111-4111-8111-111111111111' AND book_id = 'rls-test-book'
  ) THEN RAISE EXCEPTION 'decision book_id was not preserved'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_book_review_settings
    WHERE user_id = '11111111-1111-4111-8111-111111111111' AND book_id = 'rls-test-book'
  ) THEN RAISE EXCEPTION 'book review setting did not survive custom book deletion'; END IF;
  RAISE NOTICE 'PASS: deleted and bundled source ids remain provenance and do not block review states';
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
  if ($migrations.Count -ne 16) {
    throw "Expected migrations 0000–0015 (16 files); found $($migrations.Count)."
  }
  foreach ($migration in $migrations) {
    if ($migration.Name -eq '0012_apply_pending_0011_marker.sql') {
      Write-Host 'Reapplying 0011 to verify repeatability before later migrations'
      Invoke-PostgresFile -Path (Join-Path $migrationDir '0011_review_system_v1_foundation.sql') -Container $containerName -SingleTransaction
    }
    if ($migration.Name -eq '0014_apply_pending_0013_marker.sql') {
      Write-Host 'Reapplying 0013 to verify repeatability before 0015'
      Invoke-PostgresFile -Path (Join-Path $migrationDir '0013_review_source_provenance.sql') -Container $containerName -SingleTransaction
    }
    if ($migration.Name -eq '0015_review_scope_settings.sql') {
      Write-Host 'Seeding pre-0015 Review data before applying scope migration'
      $preScopeFixtureFile = Write-TempSql -Content $preScopeFixture
      Invoke-PostgresFile -Path $preScopeFixtureFile -Container $containerName -SingleTransaction
    }
    Write-Host ("Applying " + $migration.Name)
    Invoke-PostgresFile -Path $migration.FullName -Container $containerName -SingleTransaction
    if ($migration.Name -eq '0015_review_scope_settings.sql') {
      $scopeChecksFile = Write-TempSql -Content $scopeChecks
      Invoke-PostgresFile -Path $scopeChecksFile -Container $containerName -SingleTransaction
      Write-Host 'Reapplying 0015 to verify repeatability'
      Invoke-PostgresFile -Path $migration.FullName -Container $containerName -SingleTransaction
    }
  }

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
