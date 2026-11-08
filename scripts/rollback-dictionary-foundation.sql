BEGIN;
DO $rollback$
DECLARE
  user_state_before jsonb;
  user_state_after jsonb;
  pilot_state_before jsonb;
  pilot_state_after jsonb;
  round2_state_before jsonb;
  round2_state_after jsonb;
BEGIN
  SELECT jsonb_build_object(
    'books', (SELECT count(*) FROM public.word_books),
    'entries', (SELECT count(*) FROM public.word_entries),
    'attempts', (SELECT count(*) FROM public.attempts),
    'mastery', (SELECT count(*) FROM public.word_mastery),
    'progress', (SELECT count(*) FROM public.book_progress)
  ) INTO user_state_before;

  SELECT jsonb_build_object(
    'senses', (SELECT count(*) FROM public.lexicon_entries WHERE source_id = 'oewn-2025'),
    'pilots', (SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.sense_key)
      FROM (SELECT sense_key, source_entry_ref, priority, translation, part_of_speech, definition_en, sentence
        FROM public.lexicon_entries WHERE source_id = 'oewn-2025' AND priority = 100) AS row_data)
  ) INTO pilot_state_before;

  SELECT jsonb_build_object(
    'source', (SELECT to_jsonb(source_row) FROM public.lexicon_sources AS source_row
      WHERE source_row.id = 'cadence-round2-editorial-bccb9a1ab863'),
    'entries', (SELECT jsonb_agg(to_jsonb(entry_row) ORDER BY entry_row.id)
      FROM public.lexicon_entries AS entry_row
      WHERE entry_row.source_id = 'cadence-round2-editorial-bccb9a1ab863')
  ) INTO round2_state_before;

  UPDATE public.lexicon_sources SET access_tier = 'restricted'
  WHERE id IN ('ecdict', 'cadence_headword_ranking', 'cadence_enhanced_entries');

  DELETE FROM public.lexicon_entries WHERE source_id = 'cadence_enhanced_entries';
  DELETE FROM public.lexicon_documents WHERE source_id = 'cadence_enhanced_entries';
  DELETE FROM public.dictionary_expression_reviews WHERE source_id = 'cadence_headword_ranking';
  DELETE FROM public.dictionary_expression_links WHERE source_id = 'cadence_headword_ranking';
  DELETE FROM public.dictionary_headwords WHERE source_id = 'cadence_headword_ranking';
  DELETE FROM public.dictionary_source_entries WHERE source_id = 'ecdict';
  DELETE FROM public.lexicon_sources
  WHERE id IN ('ecdict', 'cadence_headword_ranking', 'cadence_enhanced_entries');

  SELECT jsonb_build_object(
    'books', (SELECT count(*) FROM public.word_books),
    'entries', (SELECT count(*) FROM public.word_entries),
    'attempts', (SELECT count(*) FROM public.attempts),
    'mastery', (SELECT count(*) FROM public.word_mastery),
    'progress', (SELECT count(*) FROM public.book_progress)
  ) INTO user_state_after;

  SELECT jsonb_build_object(
    'senses', (SELECT count(*) FROM public.lexicon_entries WHERE source_id = 'oewn-2025'),
    'pilots', (SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.sense_key)
      FROM (SELECT sense_key, source_entry_ref, priority, translation, part_of_speech, definition_en, sentence
        FROM public.lexicon_entries WHERE source_id = 'oewn-2025' AND priority = 100) AS row_data)
  ) INTO pilot_state_after;

  SELECT jsonb_build_object(
    'source', (SELECT to_jsonb(source_row) FROM public.lexicon_sources AS source_row
      WHERE source_row.id = 'cadence-round2-editorial-bccb9a1ab863'),
    'entries', (SELECT jsonb_agg(to_jsonb(entry_row) ORDER BY entry_row.id)
      FROM public.lexicon_entries AS entry_row
      WHERE entry_row.source_id = 'cadence-round2-editorial-bccb9a1ab863')
  ) INTO round2_state_after;

  IF user_state_after IS DISTINCT FROM user_state_before THEN
    RAISE EXCEPTION 'Dictionary rollback changed user learning data';
  END IF;
  IF pilot_state_after IS DISTINCT FROM pilot_state_before THEN
    RAISE EXCEPTION 'Dictionary rollback changed OEWN or pilot data';
  END IF;
  IF round2_state_after IS DISTINCT FROM round2_state_before THEN
    RAISE EXCEPTION 'Dictionary rollback changed Round 2 editorial data';
  END IF;
END;
$rollback$;
COMMIT;
