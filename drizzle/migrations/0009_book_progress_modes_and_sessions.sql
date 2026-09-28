-- Keep each learning mode's cursor and resumable session isolated per user and book.
-- Existing progress rows become mode='word' through the column default.
ALTER TABLE public.book_progress
  ADD COLUMN mode text NOT NULL DEFAULT 'word',
  ADD COLUMN session_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN revision integer NOT NULL DEFAULT 0;

ALTER TABLE public.book_progress
  DROP CONSTRAINT IF EXISTS book_progress_pkey;

ALTER TABLE public.book_progress
  ADD CONSTRAINT book_progress_pkey PRIMARY KEY (user_id, book_id, mode),
  ADD CONSTRAINT book_progress_mode_check CHECK (mode IN ('word', 'sentence', 'memorize')),
  ADD CONSTRAINT book_progress_revision_check CHECK (revision >= 0);
