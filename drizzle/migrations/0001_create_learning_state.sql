CREATE TABLE public.user_settings (
  user_id uuid PRIMARY KEY,
  daily_goal integer NOT NULL DEFAULT 20,
  active_book text NOT NULL DEFAULT 'core',
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;
GRANT ALL ON public.user_settings TO service_role;

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own settings select" ON public.user_settings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own settings insert" ON public.user_settings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own settings update" ON public.user_settings FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.book_progress (
  user_id uuid NOT NULL,
  book_id text NOT NULL,
  cursor_index integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, book_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.book_progress TO authenticated;
GRANT ALL ON public.book_progress TO service_role;

ALTER TABLE public.book_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own book progress select" ON public.book_progress FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own book progress insert" ON public.book_progress FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own book progress update" ON public.book_progress FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own book progress delete" ON public.book_progress FOR DELETE TO authenticated USING (auth.uid() = user_id);

ALTER TABLE public.attempts ADD COLUMN IF NOT EXISTS is_review boolean NOT NULL DEFAULT false;