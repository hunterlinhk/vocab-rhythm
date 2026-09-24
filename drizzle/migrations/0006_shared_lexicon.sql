-- Lexicon content is shared by lemma; book order and source statistics stay on word_entries.
CREATE TABLE public.lexemes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  language text NOT NULL DEFAULT 'en',
  normalized_word text NOT NULL,
  lemma text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (language, normalized_word)
);

CREATE TABLE public.lexicon_sources (
  id text PRIMARY KEY,
  title text NOT NULL,
  version text,
  source_url text NOT NULL,
  license_id text NOT NULL,
  license_url text NOT NULL,
  attribution text NOT NULL,
  access_tier text NOT NULL DEFAULT 'public' CHECK (access_tier IN ('public', 'restricted')),
  imported_at timestamptz NOT NULL DEFAULT now()
);

-- One source may provide several senses for the same lemma. Every content row keeps its origin.
CREATE TABLE public.lexicon_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lexeme_id uuid NOT NULL REFERENCES public.lexemes(id) ON DELETE CASCADE,
  source_id text NOT NULL REFERENCES public.lexicon_sources(id),
  source_entry_ref text,
  sense_key text NOT NULL DEFAULT 'primary',
  priority integer NOT NULL DEFAULT 0,
  translation text,
  part_of_speech text,
  phonetic text,
  definition_en text,
  sentence text,
  sentence_translation text,
  subject text,
  verb text,
  object text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lexeme_id, source_id, sense_key)
);
CREATE INDEX lexicon_entries_lexeme_priority_idx ON public.lexicon_entries (lexeme_id, priority DESC);

ALTER TABLE public.word_entries
  ADD COLUMN lexeme_id uuid REFERENCES public.lexemes(id);
CREATE INDEX word_entries_lexeme_idx ON public.word_entries (lexeme_id);

-- Link existing book entries in place. Their learning fields remain untouched as private/legacy overrides.
INSERT INTO public.lexemes (language, normalized_word, lemma)
SELECT 'en', lower(btrim(word)), min(btrim(word))
FROM public.word_entries
WHERE btrim(word) <> ''
GROUP BY lower(btrim(word))
ON CONFLICT (language, normalized_word) DO NOTHING;

UPDATE public.word_entries AS e
SET lexeme_id = l.id
FROM public.lexemes AS l
WHERE l.language = 'en' AND l.normalized_word = lower(btrim(e.word));

-- Future custom-book inserts automatically reuse an existing lexeme or create an empty one.
CREATE OR REPLACE FUNCTION public.link_word_entry_lexeme()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _key text := lower(btrim(NEW.word));
BEGIN
  IF _key = '' THEN RAISE EXCEPTION 'word must not be blank'; END IF;
  INSERT INTO public.lexemes (language, normalized_word, lemma)
  VALUES ('en', _key, btrim(NEW.word))
  ON CONFLICT (language, normalized_word) DO NOTHING;
  SELECT id INTO NEW.lexeme_id FROM public.lexemes
  WHERE language = 'en' AND normalized_word = _key;
  RETURN NEW;
END;
$$;
CREATE TRIGGER word_entries_link_lexeme BEFORE INSERT OR UPDATE OF word ON public.word_entries
  FOR EACH ROW EXECUTE FUNCTION public.link_word_entry_lexeme();

GRANT SELECT ON public.lexemes, public.lexicon_sources, public.lexicon_entries TO authenticated;
GRANT ALL ON public.lexemes, public.lexicon_sources, public.lexicon_entries TO service_role;
ALTER TABLE public.lexemes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lexicon_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lexicon_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lexemes readable" ON public.lexemes FOR SELECT TO authenticated USING (true);
CREATE POLICY "public lexicon sources readable" ON public.lexicon_sources FOR SELECT TO authenticated
  USING (access_tier = 'public');
CREATE POLICY "public lexicon entries readable" ON public.lexicon_entries FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.lexicon_sources s WHERE s.id = source_id AND s.access_tier = 'public'
  ));
