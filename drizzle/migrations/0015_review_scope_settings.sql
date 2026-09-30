-- Review identity can be shared across books or isolated per source book. Book ids here are
-- scope/provenance strings, not foreign keys: bundled and deleted books remain valid identities.
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS share_review_progress boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.user_book_review_settings (
  user_id uuid NOT NULL,
  book_id text NOT NULL CHECK (btrim(book_id) <> ''),
  include_in_review boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, book_id)
);

COMMENT ON TABLE public.user_book_review_settings IS
  'Per-user review inclusion preferences; intentionally has no word_books foreign key so bundled books are supported.';
COMMENT ON COLUMN public.user_book_review_settings.book_id IS
  'Book id for a preference. It may identify a bundled or deleted book and is not a live-book dependency.';

REVOKE ALL ON public.user_book_review_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.user_book_review_settings TO authenticated;
GRANT ALL ON public.user_book_review_settings TO service_role;
ALTER TABLE public.user_book_review_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own book review settings select" ON public.user_book_review_settings;
CREATE POLICY "own book review settings select" ON public.user_book_review_settings
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "own book review settings insert" ON public.user_book_review_settings;
CREATE POLICY "own book review settings insert" ON public.user_book_review_settings
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own book review settings update" ON public.user_book_review_settings;
CREATE POLICY "own book review settings update" ON public.user_book_review_settings
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.review_states
  ADD COLUMN IF NOT EXISTS scope_key text NOT NULL DEFAULT 'shared';
ALTER TABLE public.review_schedule_decisions
  ADD COLUMN IF NOT EXISTS scope_key text NOT NULL DEFAULT 'shared';

DO $$
DECLARE
  existing_pkey text;
  pkey_definition text;
BEGIN
  SELECT conname, pg_get_constraintdef(oid)
    INTO existing_pkey, pkey_definition
    FROM pg_constraint
   WHERE conrelid = 'public.review_states'::regclass AND contype = 'p';

  IF existing_pkey IS NULL THEN
    ALTER TABLE public.review_states
      ADD CONSTRAINT review_states_pkey PRIMARY KEY (user_id, word_key, review_mode, scope_key);
  ELSIF position('scope_key' IN pkey_definition) = 0 THEN
    EXECUTE format('ALTER TABLE public.review_states DROP CONSTRAINT %I', existing_pkey);
    ALTER TABLE public.review_states
      ADD CONSTRAINT review_states_pkey PRIMARY KEY (user_id, word_key, review_mode, scope_key);
  END IF;
END $$;

DO $$
DECLARE
  unique_constraint record;
  has_scope_unique boolean := false;
BEGIN
  FOR unique_constraint IN
    SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
     WHERE conrelid = 'public.review_schedule_decisions'::regclass AND contype = 'u'
  LOOP
    IF unique_constraint.definition =
      'UNIQUE (user_id, scope_key, book_id, word_key, review_mode, session_id, decision_revision)' THEN
      has_scope_unique := true;
    ELSIF unique_constraint.definition =
      'UNIQUE (user_id, book_id, word_key, review_mode, session_id, decision_revision)' THEN
      EXECUTE format('ALTER TABLE public.review_schedule_decisions DROP CONSTRAINT %I', unique_constraint.conname);
    END IF;
  END LOOP;

  IF NOT has_scope_unique THEN
    ALTER TABLE public.review_schedule_decisions
      ADD CONSTRAINT review_schedule_decisions_scope_revision_unique
      UNIQUE (user_id, scope_key, book_id, word_key, review_mode, session_id, decision_revision);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.review_states'::regclass
       AND conname = 'review_states_scope_key_check'
  ) THEN
    ALTER TABLE public.review_states ADD CONSTRAINT review_states_scope_key_check
      CHECK (scope_key = 'shared' OR (scope_key LIKE 'book:%' AND length(scope_key) > 5));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.review_schedule_decisions'::regclass
       AND conname = 'review_schedule_decisions_scope_key_check'
  ) THEN
    ALTER TABLE public.review_schedule_decisions ADD CONSTRAINT review_schedule_decisions_scope_key_check
      CHECK (scope_key = 'shared' OR (scope_key LIKE 'book:%' AND length(scope_key) > 5));
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.review_schedule_decisions'::regclass
       AND conname = 'review_schedule_decisions_decision_reason_check'
       AND position('excluded_by_book_setting' IN pg_get_constraintdef(oid)) = 0
  ) THEN
    ALTER TABLE public.review_schedule_decisions
      DROP CONSTRAINT review_schedule_decisions_decision_reason_check;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.review_schedule_decisions'::regclass
       AND conname = 'review_schedule_decisions_decision_reason_check'
  ) THEN
    ALTER TABLE public.review_schedule_decisions ADD CONSTRAINT review_schedule_decisions_decision_reason_check
      CHECK (decision_reason IN (
        'first_learning', 'normal_growth', 'same_day_repeat', 'failure_reset',
        'inclusion_pending', 'excluded_by_choice', 'excluded_by_preference',
        'excluded_by_book_setting', 'no_valid_attempts'
      ));
  END IF;
END $$;

COMMENT ON COLUMN public.review_states.scope_key IS
  'Review identity scope: shared across books or book:<id>. Recognition and spelling remain separate modes.';
COMMENT ON COLUMN public.review_schedule_decisions.scope_key IS
  'Projection scope for this immutable decision revision; source book remains provenance.';

CREATE INDEX IF NOT EXISTS review_states_scoped_due_idx
  ON public.review_states (user_id, review_mode, scope_key, next_due_at)
  WHERE next_due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS review_session_results_book_replay_idx
  ON public.review_session_results (user_id, book_id, word_key, review_mode, completed_at, session_id);
