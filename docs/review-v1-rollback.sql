-- Roll back the Review v1 projection schema only after reverting the application code.
-- This script is destructive to 0011 projection tables and removes new raw attempt metadata.
-- Run only while 0011 code is not writing data, or after the production backup is verified.
-- It deliberately leaves the stronger attempts owner WITH CHECK policy in place.

BEGIN;

DROP TABLE IF EXISTS public.review_states;
DROP TABLE IF EXISTS public.review_session_results;
DROP TABLE IF EXISTS public.review_schedule_decisions;

DROP INDEX IF EXISTS public.attempts_review_session_idx;

ALTER TABLE public.attempts
  DROP CONSTRAINT IF EXISTS attempts_review_mode_check,
  DROP CONSTRAINT IF EXISTS attempts_counted_review_check,
  DROP CONSTRAINT IF EXISTS attempts_sentence_not_reviewable_check,
  DROP CONSTRAINT IF EXISTS attempts_review_mode_owner_check,
  DROP CONSTRAINT IF EXISTS attempts_review_stage_owner_check,
  DROP CONSTRAINT IF EXISTS attempts_review_session_check,
  DROP CONSTRAINT IF EXISTS attempts_session_stage_check,
  DROP CONSTRAINT IF EXISTS attempts_hint_count_check;

ALTER TABLE public.attempts
  DROP COLUMN IF EXISTS review_word_key,
  DROP COLUMN IF EXISTS review_mode,
  DROP COLUMN IF EXISTS counted_for_review,
  DROP COLUMN IF EXISTS hint_count,
  DROP COLUMN IF EXISTS review_session_id,
  DROP COLUMN IF EXISTS session_stage,
  DROP COLUMN IF EXISTS time_zone;

ALTER TABLE public.user_settings
  DROP COLUMN IF EXISTS include_spelling_in_review,
  DROP COLUMN IF EXISTS include_spelling_in_review_first_choice;

COMMIT;
