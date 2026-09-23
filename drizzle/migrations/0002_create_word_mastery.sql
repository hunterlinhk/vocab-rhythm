CREATE TABLE public.word_mastery (
  user_id uuid NOT NULL,
  word text NOT NULL,
  book_id text NOT NULL DEFAULT 'core',
  translation text,
  context_ok boolean NOT NULL DEFAULT false,
  recall_ok boolean NOT NULL DEFAULT false,
  spell_ok boolean NOT NULL DEFAULT false,
  rounds integer NOT NULL DEFAULT 0,
  reinforced_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, word)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.word_mastery TO authenticated;
GRANT ALL ON public.word_mastery TO service_role;

ALTER TABLE public.word_mastery ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own mastery select" ON public.word_mastery FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own mastery insert" ON public.word_mastery FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own mastery update" ON public.word_mastery FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own mastery delete" ON public.word_mastery FOR DELETE TO authenticated USING (auth.uid() = user_id);

ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS memorize_spelling boolean NOT NULL DEFAULT true;