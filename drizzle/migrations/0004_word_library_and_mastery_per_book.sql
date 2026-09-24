-- 1) word_mastery 唯一键改为 user_id + book_id + word（现有行在 user_id+word 上唯一，天然满足新键）
ALTER TABLE public.word_mastery DROP CONSTRAINT IF EXISTS word_mastery_pkey;
ALTER TABLE public.word_mastery ADD CONSTRAINT word_mastery_pkey PRIMARY KEY (user_id, book_id, word);

-- 2) 统一词库：词书
CREATE TABLE public.word_books (
  id text PRIMARY KEY DEFAULT ('b_' || replace(gen_random_uuid()::text, '-', '')),
  name text NOT NULL,
  description text,
  source text NOT NULL DEFAULT 'custom' CHECK (source IN ('official', 'custom')),
  owner_user_id uuid,
  word_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT word_books_owner_matches_source CHECK (
    (source = 'official' AND owner_user_id IS NULL) OR (source = 'custom' AND owner_user_id IS NOT NULL)
  )
);
CREATE INDEX word_books_owner_idx ON public.word_books (owner_user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.word_books TO authenticated;
GRANT ALL ON public.word_books TO service_role;
ALTER TABLE public.word_books ENABLE ROW LEVEL SECURITY;

CREATE POLICY "books readable" ON public.word_books FOR SELECT TO authenticated
  USING (source = 'official' OR owner_user_id = auth.uid());
CREATE POLICY "own custom books insert" ON public.word_books FOR INSERT TO authenticated
  WITH CHECK (source = 'custom' AND owner_user_id = auth.uid());
CREATE POLICY "own custom books update" ON public.word_books FOR UPDATE TO authenticated
  USING (source = 'custom' AND owner_user_id = auth.uid())
  WITH CHECK (source = 'custom' AND owner_user_id = auth.uid());
CREATE POLICY "own custom books delete" ON public.word_books FOR DELETE TO authenticated
  USING (source = 'custom' AND owner_user_id = auth.uid());

-- 3) 词条
CREATE TABLE public.word_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id text NOT NULL REFERENCES public.word_books(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  word text NOT NULL,
  translation text,
  phonetic text,
  sentence text,
  sentence_translation text,
  subject text,
  verb text,
  object text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, word)
);
CREATE INDEX word_entries_book_pos_idx ON public.word_entries (book_id, position);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.word_entries TO authenticated;
GRANT ALL ON public.word_entries TO service_role;
ALTER TABLE public.word_entries ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_read_book(_book_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.word_books b WHERE b.id = _book_id AND (b.source = 'official' OR b.owner_user_id = auth.uid()))
$$;
CREATE OR REPLACE FUNCTION public.owns_book(_book_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.word_books b WHERE b.id = _book_id AND b.source = 'custom' AND b.owner_user_id = auth.uid())
$$;

CREATE POLICY "entries readable" ON public.word_entries FOR SELECT TO authenticated USING (public.can_read_book(book_id));
CREATE POLICY "own entries insert" ON public.word_entries FOR INSERT TO authenticated WITH CHECK (public.owns_book(book_id));
CREATE POLICY "own entries update" ON public.word_entries FOR UPDATE TO authenticated USING (public.owns_book(book_id)) WITH CHECK (public.owns_book(book_id));
CREATE POLICY "own entries delete" ON public.word_entries FOR DELETE TO authenticated USING (public.owns_book(book_id));

-- 4) 词书词数自动维护
CREATE OR REPLACE FUNCTION public.sync_word_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id text := COALESCE(NEW.book_id, OLD.book_id);
BEGIN
  UPDATE public.word_books SET word_count = (SELECT count(*) FROM public.word_entries WHERE book_id = _id), updated_at = now() WHERE id = _id;
  RETURN NULL;
END;
$$;
CREATE TRIGGER word_entries_count AFTER INSERT OR DELETE ON public.word_entries
  FOR EACH ROW EXECUTE FUNCTION public.sync_word_count();

-- 5) 按词书查询加速
CREATE INDEX IF NOT EXISTS attempts_user_book_word_idx ON public.attempts (user_id, book_id, word, created_at DESC);