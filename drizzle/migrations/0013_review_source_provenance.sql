-- source_book_id is historical provenance, not a Review identity or a live-book dependency.
-- Review identity remains (user_id, normalized word_key, review_mode); keep source ids after deletion.
ALTER TABLE public.review_states
  DROP CONSTRAINT IF EXISTS review_states_source_book_id_fkey;

COMMENT ON COLUMN public.review_states.source_book_id IS
  'Source book id of the latest included session; provenance only, may identify a bundled or deleted book.';
