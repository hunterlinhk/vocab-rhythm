-- Memory v2 shadow model: record what the learner actually saw before typing.
-- NULL deliberately means historical visibility is unknown; do not backfill or guess.
-- Safe to apply before deploying code that reads/writes prompt_visibility.
ALTER TABLE public.attempts
  ADD COLUMN IF NOT EXISTS prompt_visibility text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attempts_prompt_visibility_check') THEN
    ALTER TABLE public.attempts
      ADD CONSTRAINT attempts_prompt_visibility_check
      CHECK (prompt_visibility IS NULL OR prompt_visibility IN ('visible', 'masked'));
  END IF;
END $$;

COMMENT ON COLUMN public.attempts.prompt_visibility IS
  'Whether the untyped target was visible or masked when word spelling was attempted; NULL indicates historical unknown.';
