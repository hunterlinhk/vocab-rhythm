-- Attempts are raw learning events. Session results and scheduler decisions are
-- separate, rebuildable layers. This migration is forward-only and not applied here.
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS include_spelling_in_review boolean,
  ADD COLUMN IF NOT EXISTS include_spelling_in_review_first_choice boolean;

ALTER TABLE public.attempts
  ADD COLUMN IF NOT EXISTS review_mode text,
  ADD COLUMN IF NOT EXISTS counted_for_review boolean,
  ADD COLUMN IF NOT EXISTS hint_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_session_id uuid,
  ADD COLUMN IF NOT EXISTS session_stage text,
  ADD COLUMN IF NOT EXISTS time_zone text,
  ADD COLUMN IF NOT EXISTS review_word_key text GENERATED ALWAYS AS (
    lower(regexp_replace(word, '^[[:space:]]+|[[:space:]]+$', '', 'g'))
  ) STORED;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attempts_review_mode_check') THEN
    ALTER TABLE public.attempts
      ADD CONSTRAINT attempts_review_mode_check
      CHECK (review_mode IS NULL OR review_mode IN ('recognition', 'spelling'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attempts_counted_review_check') THEN
    ALTER TABLE public.attempts
      ADD CONSTRAINT attempts_counted_review_check
      CHECK (counted_for_review IS DISTINCT FROM true OR (review_mode IS NOT NULL AND NOT skipped));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attempts_sentence_not_reviewable_check') THEN
    ALTER TABLE public.attempts
      ADD CONSTRAINT attempts_sentence_not_reviewable_check
      CHECK (mode <> 'sentence' OR (review_mode IS NULL AND counted_for_review IS DISTINCT FROM true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attempts_review_mode_owner_check') THEN
    ALTER TABLE public.attempts
      ADD CONSTRAINT attempts_review_mode_owner_check
      CHECK (
        (review_mode IS NULL)
        OR (review_mode = 'recognition' AND mode = 'memorize')
        OR (review_mode = 'spelling' AND mode = 'word')
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attempts_review_stage_owner_check') THEN
    ALTER TABLE public.attempts
      ADD CONSTRAINT attempts_review_stage_owner_check
      CHECK (
        review_mode IS NULL
        OR (review_mode = 'recognition' AND mode = 'memorize' AND session_stage IS NOT NULL AND session_stage IN ('context', 'recall'))
        OR (review_mode = 'spelling' AND mode = 'word' AND session_stage IS NOT NULL AND session_stage = 'word_spelling')
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attempts_review_session_check') THEN
    ALTER TABLE public.attempts
      ADD CONSTRAINT attempts_review_session_check
      CHECK (review_mode IS NULL OR review_session_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attempts_session_stage_check') THEN
    ALTER TABLE public.attempts
      ADD CONSTRAINT attempts_session_stage_check
      CHECK (
        session_stage IS NULL
        OR (mode = 'word' AND session_stage = 'word_spelling')
        OR (mode = 'memorize' AND session_stage IN ('context', 'recall', 'spell'))
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attempts_hint_count_check') THEN
    ALTER TABLE public.attempts
      ADD CONSTRAINT attempts_hint_count_check CHECK (hint_count >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS attempts_review_session_idx
  ON public.attempts (user_id, review_word_key, review_mode, review_session_id, created_at, id)
  WHERE review_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.review_session_results (
  user_id uuid NOT NULL,
  book_id text NOT NULL,
  word text NOT NULL,
  word_key text NOT NULL CHECK (
    word_key <> '' AND word_key = lower(regexp_replace(word, '^[[:space:]]+|[[:space:]]+$', '', 'g'))
  ),
  review_mode text NOT NULL CHECK (review_mode IN ('recognition', 'spelling')),
  session_id uuid NOT NULL,
  outcome text CHECK (outcome IS NULL OR outcome IN ('smooth', 'strained', 'failed')),
  counted_for_review boolean,
  final_correct boolean,
  had_real_error boolean NOT NULL DEFAULT false,
  real_wrong_count integer NOT NULL DEFAULT 0 CHECK (real_wrong_count >= 0),
  used_hint boolean NOT NULL DEFAULT false,
  hint_count integer NOT NULL DEFAULT 0 CHECK (hint_count >= 0),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  valid_attempt_count integer NOT NULL DEFAULT 0 CHECK (valid_attempt_count >= 0),
  last_attempt_id uuid REFERENCES public.attempts(id) ON DELETE SET NULL,
  completed_at timestamptz NOT NULL,
  time_zone text NOT NULL,
  learning_day date NOT NULL,
  source_fingerprint text NOT NULL,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, book_id, word_key, review_mode, session_id)
);
COMMENT ON COLUMN public.review_session_results.book_id IS
  'Source book for this session; review scheduling is shared by user, word, and review mode.';
COMMENT ON COLUMN public.review_session_results.word_key IS
  'Trimmed and lowercased word; part of shared review identity, while word retains source spelling.';

CREATE INDEX IF NOT EXISTS review_session_results_replay_idx
  ON public.review_session_results (user_id, word_key, review_mode, completed_at, book_id, session_id);

CREATE TABLE IF NOT EXISTS public.review_schedule_decisions (
  decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  book_id text NOT NULL,
  word text NOT NULL,
  word_key text NOT NULL CHECK (
    word_key <> '' AND word_key = lower(regexp_replace(word, '^[[:space:]]+|[[:space:]]+$', '', 'g'))
  ),
  review_mode text NOT NULL CHECK (review_mode IN ('recognition', 'spelling')),
  session_id uuid NOT NULL,
  decision_revision integer NOT NULL CHECK (decision_revision >= 0),
  supersedes_decision_id uuid REFERENCES public.review_schedule_decisions(decision_id),
  learning_day date NOT NULL,
  session_outcome text CHECK (session_outcome IS NULL OR session_outcome IN ('smooth', 'strained', 'failed')),
  effective_inclusion boolean,
  is_initial_learning boolean NOT NULL DEFAULT false,
  state_advanced boolean NOT NULL,
  interval_advanced boolean NOT NULL,
  schedule_action text NOT NULL CHECK (
    schedule_action IN ('initialize', 'grow', 'hold', 'failure_reset_short', 'none')
  ),
  decision_reason text NOT NULL CHECK (
    decision_reason IN (
      'first_learning', 'normal_growth', 'same_day_repeat', 'failure_reset',
      'inclusion_pending', 'excluded_by_choice', 'excluded_by_preference', 'no_valid_attempts'
    )
  ),
  scheduler_version text NOT NULL,
  input_fingerprint text NOT NULL,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, book_id, word_key, review_mode, session_id, decision_revision)
);
COMMENT ON COLUMN public.review_schedule_decisions.book_id IS
  'Source book for the session that produced this scheduling decision.';
COMMENT ON COLUMN public.review_schedule_decisions.word_key IS
  'Trimmed and lowercased word; scopes this source session within its shared review identity.';
COMMENT ON COLUMN public.review_schedule_decisions.supersedes_decision_id IS
  'Previous immutable revision for this source session; the latest revision is current.';

CREATE INDEX IF NOT EXISTS review_schedule_decisions_replay_idx
  ON public.review_schedule_decisions (user_id, word_key, review_mode, learning_day, created_at);

CREATE TABLE IF NOT EXISTS public.review_states (
  user_id uuid NOT NULL,
  word text NOT NULL,
  word_key text NOT NULL CHECK (
    word_key <> '' AND word_key = lower(regexp_replace(word, '^[[:space:]]+|[[:space:]]+$', '', 'g'))
  ),
  source_book_id text REFERENCES public.word_books(id) ON DELETE SET NULL,
  review_mode text NOT NULL CHECK (review_mode IN ('recognition', 'spelling')),
  last_reviewed_at timestamptz,
  next_due_at timestamptz,
  interval_seconds integer CHECK (interval_seconds IS NULL OR interval_seconds >= 0),
  consecutive_correct integer NOT NULL DEFAULT 0 CHECK (consecutive_correct >= 0),
  total_wrong integer NOT NULL DEFAULT 0 CHECK (total_wrong >= 0),
  hint_count integer NOT NULL DEFAULT 0 CHECK (hint_count >= 0),
  difficulty numeric,
  scheduler_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_attempt_id uuid REFERENCES public.attempts(id) ON DELETE SET NULL,
  last_session_id uuid,
  last_learning_day date,
  successful_growth_day date,
  pending_action text NOT NULL DEFAULT 'none' CHECK (
    pending_action IN ('initialize', 'grow', 'hold', 'failure_reset_short', 'none')
  ),
  last_outcome text CHECK (last_outcome IS NULL OR last_outcome IN ('smooth', 'strained', 'failed')),
  last_decision_reason text,
  scheduler_version text,
  last_decision_id uuid REFERENCES public.review_schedule_decisions(decision_id) ON DELETE SET NULL,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, word_key, review_mode)
);
COMMENT ON COLUMN public.review_states.source_book_id IS
  'Source book of the latest included session; deletion sets this provenance pointer to NULL.';
COMMENT ON COLUMN public.review_states.word_key IS
  'Trimmed and lowercased word; review state identity is user_id + word_key + review_mode across all books.';

CREATE INDEX IF NOT EXISTS review_states_due_idx
  ON public.review_states (user_id, review_mode, next_due_at)
  WHERE next_due_at IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.review_session_results TO authenticated;
GRANT SELECT, INSERT ON public.review_schedule_decisions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.review_states TO authenticated;
GRANT ALL ON public.review_session_results, public.review_schedule_decisions, public.review_states TO service_role;

ALTER TABLE public.review_session_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_schedule_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own review session results select" ON public.review_session_results;
CREATE POLICY "own review session results select" ON public.review_session_results FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "own review session results insert" ON public.review_session_results;
CREATE POLICY "own review session results insert" ON public.review_session_results FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own review session results update" ON public.review_session_results;
CREATE POLICY "own review session results update" ON public.review_session_results FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own review session results delete" ON public.review_session_results;
CREATE POLICY "own review session results delete" ON public.review_session_results FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "own review schedule decisions select" ON public.review_schedule_decisions;
CREATE POLICY "own review schedule decisions select" ON public.review_schedule_decisions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "own review schedule decisions insert" ON public.review_schedule_decisions;
CREATE POLICY "own review schedule decisions insert" ON public.review_schedule_decisions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own review states select" ON public.review_states;
CREATE POLICY "own review states select" ON public.review_states FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "own review states insert" ON public.review_states;
CREATE POLICY "own review states insert" ON public.review_states FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own review states update" ON public.review_states;
CREATE POLICY "own review states update" ON public.review_states FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own review states delete" ON public.review_states;
CREATE POLICY "own review states delete" ON public.review_states FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
