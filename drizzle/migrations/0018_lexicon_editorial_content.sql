ALTER TABLE public.lexicon_sources
  ADD COLUMN source_kind text NOT NULL DEFAULT 'external'
    CHECK (source_kind IN ('external', 'editorial')),
  ALTER COLUMN license_id DROP NOT NULL,
  ALTER COLUMN license_url DROP NOT NULL,
  ADD CONSTRAINT lexicon_sources_external_license_required
    CHECK (source_kind = 'editorial' OR (license_id IS NOT NULL AND license_url IS NOT NULL));

ALTER TABLE public.lexicon_entries
  ADD COLUMN content_type text NOT NULL DEFAULT 'sense',
  ADD COLUMN sense_role text,
  ADD COLUMN publication_status text NOT NULL DEFAULT 'published',
  ADD COLUMN review_decision text,
  ADD COLUMN related_sense_key text,
  ADD COLUMN usage_note_zh text;

UPDATE public.lexicon_entries
SET sense_role = CASE
  WHEN source_id = 'oewn-2025' AND priority < 100 THEN 'candidate'
  ELSE 'primary'
END;

ALTER TABLE public.lexicon_entries
  ADD CONSTRAINT lexicon_entries_content_type_check
    CHECK (content_type IN ('sense', 'usage_note')),
  ADD CONSTRAINT lexicon_entries_sense_role_check
    CHECK (sense_role IS NULL OR sense_role IN ('primary', 'supplementary', 'candidate')),
  ADD CONSTRAINT lexicon_entries_publication_status_check
    CHECK (publication_status IN ('pending_review', 'approved', 'published', 'rejected')),
  ADD CONSTRAINT lexicon_entries_review_decision_check
    CHECK (review_decision IS NULL OR review_decision IN ('propose_primary', 'defer_no_suitable_sense')),
  ADD CONSTRAINT lexicon_entries_content_shape_check
    CHECK (
      (content_type = 'sense' AND sense_role IS NOT NULL AND usage_note_zh IS NULL)
      OR
      (content_type = 'usage_note' AND sense_role IS NULL
        AND translation IS NULL AND part_of_speech IS NULL AND phonetic IS NULL
        AND definition_en IS NULL AND sentence IS NULL AND sentence_translation IS NULL
        AND subject IS NULL AND verb IS NULL AND object IS NULL AND usage_note_zh IS NOT NULL)
    );

CREATE INDEX lexicon_entries_publication_lookup_idx
  ON public.lexicon_entries (lexeme_id, publication_status, content_type, sense_role, priority DESC);

DROP POLICY IF EXISTS "public lexicon entries readable" ON public.lexicon_entries;
CREATE POLICY "public lexicon entries readable" ON public.lexicon_entries FOR SELECT TO authenticated
  USING (publication_status = 'published' AND EXISTS (
    SELECT 1 FROM public.lexicon_sources s WHERE s.id = source_id AND s.access_tier = 'public'
  ));
