-- Keep attempt history as the event source and store a replaceable review-state projection.
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS include_spelling_in_review boolean NOT NULL DEFAULT true;

ALTER TABLE public.attempts
  ADD COLUMN IF NOT EXISTS review_mode text,
  ADD COLUMN IF NOT EXISTS counted_for_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hint_count integer NOT NULL DEFAULT 0;

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
      CHECK (NOT counted_for_review OR (review_mode IS NOT NULL AND NOT skipped));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attempts_sentence_not_reviewable_check') THEN
    ALTER TABLE public.attempts
      ADD CONSTRAINT attempts_sentence_not_reviewable_check
      CHECK (mode <> 'sentence' OR (review_mode IS NULL AND NOT counted_for_review));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attempts_hint_count_check') THEN
    ALTER TABLE public.attempts
      ADD CONSTRAINT attempts_hint_count_check CHECK (hint_count >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS attempts_review_projection_idx
  ON public.attempts (user_id, book_id, word, review_mode, created_at, id)
  WHERE counted_for_review = true AND skipped = false;

CREATE TABLE IF NOT EXISTS public.review_states (
  user_id uuid NOT NULL,
  book_id text NOT NULL,
  word text NOT NULL,
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
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, book_id, word, review_mode)
);

CREATE INDEX IF NOT EXISTS review_states_due_idx
  ON public.review_states (user_id, review_mode, next_due_at)
  WHERE next_due_at IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.review_states TO authenticated;
GRANT ALL ON public.review_states TO service_role;
ALTER TABLE public.review_states ENABLE ROW LEVEL SECURITY;

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
