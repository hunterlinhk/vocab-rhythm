-- Single-statement final apply. Execute only after 11-stage-validation.sql succeeds.
-- Any raised exception aborts this DO statement and rolls back its public-table changes.
DO $oewn_apply$
DECLARE
  _meta record;
  _sense_count bigint;
  _lexeme_count bigint;
  _reviewed_count bigint;
  _unreviewed_count bigint;
  _batch_count bigint;
  _pilot_key_count bigint;
  _batch_no integer;
  _expected_batch_rows bigint;
  _actual_batch_rows bigint;
  _existing_senses bigint;
  _existing_pilots bigint;
  _pilot_match_count bigint;
  _extra_senses bigint;
  _existing_mismatches bigint;
  _source_hash text;
  _source_version text;
  _source_license text;
  _post_source_count bigint;
BEGIN
  IF to_regclass('public.lexemes') IS NULL OR to_regclass('public.lexicon_sources') IS NULL
     OR to_regclass('public.lexicon_entries') IS NULL THEN
    RAISE EXCEPTION 'Shared Lexicon tables are missing; ensure migrations 0006-0008 are applied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lexicon_sources' AND column_name='source_sha256')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lexicon_sources' AND column_name='license_notice')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lexicon_sources' AND column_name='transformation') THEN
    RAISE EXCEPTION 'Lexicon provenance schema is incomplete; ensure migration 0007 is applied';
  END IF;

SELECT * INTO _meta FROM oewn_stage_2025.import_meta WHERE id = 'oewn-2025';
IF NOT FOUND THEN RAISE EXCEPTION 'OEWN staging metadata is missing; run 00-stage-setup.sql'; END IF;
IF (_meta.version, _meta.archive_sha256, _meta.source_url, _meta.license_id, _meta.license_url,
    _meta.attribution, _meta.license_notice, _meta.transformation, _meta.expected_lexemes,
    _meta.expected_senses, _meta.expected_reviewed, _meta.expected_unreviewed,
    _meta.expected_batches, _meta.rows_per_batch)
   IS DISTINCT FROM ('2025-12-31', '7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51', 'https://en-word.net/downloads/english-wordnet-2025-json.zip', 'CC-BY-4.0', 'https://github.com/globalwordnet/english-wordnet/blob/2025-edition/LICENSE.md', 'Open English Wordnet 2025 © The Open English WordNet Team, CC BY 4.0; derived from Princeton WordNet 3.1 © 2011 Princeton University under the WordNet License. Selected and transformed NGSL senses; no endorsement is implied.', '1 This software and database is being provided to you, the LICENSEE, by
  2 the Open English Wordnet team under the Creative Commons Attribution 4.0
  3 International License (CC-BY 4.0).
  4
  5 Open English Wordnet 2023 Copyright 2023 by the Open English Wordnet team.
  6
  7 Permission to use, copy, modify and distribute this software and
  8 database and its documentation for any purpose and without fee or
  9 royalty is hereby granted, provided that you agree to comply with
  10 the following copyright notice and statements, including the disclaimer,
  11 and that the same appear on ALL copies of the software, database and
  12 documentation, including modifications that you make for internal
  13 use or for distribution.
  14
  15 WordNet 3.1 Copyright 2011 by Princeton University.  All rights reserved.
  16
  17 THIS SOFTWARE AND DATABASE IS PROVIDED "AS IS" AND PRINCETON
  18 UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR
  19 IMPLIED.  BY WAY OF EXAMPLE, BUT NOT LIMITATION, PRINCETON
  20 UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES OF MERCHANT-
  21 ABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE
  22 OF THE LICENSED SOFTWARE, DATABASE OR DOCUMENTATION WILL NOT
  23 INFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS, TRADEMARKS OR
  24 OTHER RIGHTS.
  25
  26 The name of Princeton University or Princeton may not be used in
  27 advertising or publicity pertaining to distribution of the software
  28 and/or database.  Title to copyright in this software, database and
  29 any associated documentation shall at all times remain with
  30 Princeton University and LICENSEE agrees to preserve same.', 'Exact-spelling NGSL headwords and explicitly reviewed sense IDs; first source definition and synset example; US IPA preferred over GB. No inferred content, translations, or automatic default sense.', '2742', '19028', '26', '19002', '20', '1000') THEN
  RAISE EXCEPTION 'OEWN staging provenance or expected counts do not match this bundle';
END IF;
IF _meta.license_notice IS NULL OR btrim(_meta.license_notice) = '' THEN
  RAISE EXCEPTION 'OEWN staging license notice is empty';
END IF;
SELECT count(*), count(DISTINCT normalized_word), count(*) FILTER (WHERE priority = 100),
       count(*) FILTER (WHERE priority = 0), count(DISTINCT batch_no)
  INTO _sense_count, _lexeme_count, _reviewed_count, _unreviewed_count, _batch_count
  FROM oewn_stage_2025.senses;
IF (_sense_count, _lexeme_count, _reviewed_count, _unreviewed_count, _batch_count)
   IS DISTINCT FROM (19028, 2742, 26, 19002, 20) THEN
  RAISE EXCEPTION 'OEWN staging counts mismatch: senses %, lexemes %, reviewed %, unreviewed %, batches %',
    _sense_count, _lexeme_count, _reviewed_count, _unreviewed_count, _batch_count;
END IF;
SELECT count(*) INTO _pilot_key_count FROM oewn_stage_2025.senses
WHERE priority = 100 AND sense_key IN ('ability%1:07:00::', 'achieve%2:41:00::', 'adapt%2:30:01::', 'analyze%2:31:00::', 'bank%1:14:00::', 'book%1:10:00::', 'challenge%1:26:00::', 'concept%1:09:00::', 'create%2:36:00::', 'decision%1:04:00::', 'develop%2:36:01::', 'effort%1:04:00::', 'evidence%1:09:00::', 'familiar%3:00:00::', 'focus%1:09:00::', 'garden%1:06:00::', 'hospital%1:06:00::', 'identify%2:31:00::', 'improve%2:30:01::', 'learn%2:31:00::', 'library%1:06:01::', 'maintain%2:42:00::', 'music%1:10:00::', 'perform%2:36:00::', 'teacher%1:18:00::', 'water%1:27:00::');
IF _pilot_key_count <> 26 THEN
  RAISE EXCEPTION 'OEWN staging reviewed pilot sense IDs do not match the approved set';
END IF;
FOR _batch_no IN 1..20 LOOP
  _expected_batch_rows := LEAST(1000, 19028 - ((_batch_no - 1) * 1000));
  SELECT count(*) INTO _actual_batch_rows FROM oewn_stage_2025.senses WHERE batch_no = _batch_no;
  IF _actual_batch_rows <> _expected_batch_rows THEN
    RAISE EXCEPTION 'OEWN staging batch % has % rows; expected %', _batch_no, _actual_batch_rows, _expected_batch_rows;
  END IF;
END LOOP;

  SELECT count(*), count(*) FILTER (WHERE priority = 100)
    INTO _existing_senses, _existing_pilots
    FROM public.lexicon_entries WHERE source_id = 'oewn-2025';
  IF _existing_senses NOT IN (26, 19028) OR _existing_pilots <> 26 THEN
    RAISE EXCEPTION 'Existing OEWN state must be the 26-sense pilot or a completed import; got % senses and % pilots', _existing_senses, _existing_pilots;
  END IF;
  SELECT count(*) INTO _pilot_match_count
  FROM oewn_stage_2025.senses s
  JOIN public.lexemes l ON l.language = 'en' AND l.normalized_word = s.normalized_word
  LEFT JOIN public.lexicon_entries e ON e.lexeme_id = l.id AND e.source_id = 'oewn-2025' AND e.sense_key = s.sense_key
  WHERE s.priority = 100 AND e.id IS NOT NULL AND e.priority = 100
    AND e.source_entry_ref IS NOT DISTINCT FROM s.source_entry_ref
    AND e.part_of_speech IS NOT DISTINCT FROM s.part_of_speech
    AND e.phonetic IS NOT DISTINCT FROM s.phonetic
    AND e.definition_en IS NOT DISTINCT FROM s.definition_en
    AND e.sentence IS NOT DISTINCT FROM s.sentence;
  IF _pilot_match_count <> 26 THEN
    RAISE EXCEPTION 'Existing reviewed pilot content/identity does not exactly match staging';
  END IF;
  SELECT count(*) INTO _extra_senses FROM public.lexicon_entries e
  WHERE e.source_id = 'oewn-2025' AND NOT EXISTS (
    SELECT 1 FROM oewn_stage_2025.senses s
    JOIN public.lexemes l ON l.language = 'en' AND l.normalized_word = s.normalized_word
    WHERE l.id = e.lexeme_id AND s.sense_key = e.sense_key
  );
  IF _extra_senses <> 0 THEN RAISE EXCEPTION 'Existing OEWN rows include senses outside the staged source'; END IF;
  SELECT count(*) INTO _existing_mismatches FROM public.lexicon_entries e
  JOIN public.lexemes l ON l.id = e.lexeme_id
  JOIN oewn_stage_2025.senses s ON s.normalized_word = l.normalized_word AND s.sense_key = e.sense_key
  WHERE e.source_id = 'oewn-2025' AND (
    e.source_entry_ref IS DISTINCT FROM s.source_entry_ref OR e.priority IS DISTINCT FROM s.priority OR
    e.part_of_speech IS DISTINCT FROM s.part_of_speech OR e.phonetic IS DISTINCT FROM s.phonetic OR
    e.definition_en IS DISTINCT FROM s.definition_en OR e.sentence IS DISTINCT FROM s.sentence
  );
  IF _existing_mismatches <> 0 THEN RAISE EXCEPTION 'Existing OEWN rows conflict with staged source content'; END IF;
  SELECT source_sha256, version, license_id INTO _source_hash, _source_version, _source_license
    FROM public.lexicon_sources WHERE id = 'oewn-2025';
  IF FOUND AND ((_source_hash IS NOT NULL AND _source_hash <> '7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51') OR
                (_source_version IS NOT NULL AND _source_version <> '2025-12-31') OR
                (_source_license IS NOT NULL AND _source_license <> 'CC-BY-4.0')) THEN
    RAISE EXCEPTION 'Existing OEWN source identity/provenance conflicts with staging';
  END IF;

  INSERT INTO public.lexicon_sources
    (id, title, version, source_url, license_id, license_url, attribution, license_notice, source_sha256, transformation)
  VALUES
    (_meta.id, 'Open English WordNet 2025', _meta.version, _meta.source_url, _meta.license_id,
     _meta.license_url, _meta.attribution, _meta.license_notice, _meta.archive_sha256, _meta.transformation)
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, version = EXCLUDED.version, source_url = EXCLUDED.source_url,
    license_id = EXCLUDED.license_id, license_url = EXCLUDED.license_url,
    attribution = EXCLUDED.attribution, license_notice = EXCLUDED.license_notice,
    source_sha256 = EXCLUDED.source_sha256, transformation = EXCLUDED.transformation;

  INSERT INTO public.lexemes (language, normalized_word, lemma)
  SELECT 'en', normalized_word, min(lemma)
  FROM oewn_stage_2025.senses GROUP BY normalized_word
  ON CONFLICT (language, normalized_word) DO NOTHING;

  INSERT INTO public.lexicon_entries
    (lexeme_id, source_id, source_entry_ref, sense_key, priority, part_of_speech, phonetic, definition_en, sentence)
  SELECT l.id, _meta.id, s.source_entry_ref, s.sense_key, s.priority,
         s.part_of_speech, s.phonetic, s.definition_en, s.sentence
  FROM oewn_stage_2025.senses s
  JOIN public.lexemes l ON l.language = 'en' AND l.normalized_word = s.normalized_word
  ON CONFLICT (lexeme_id, source_id, sense_key) DO UPDATE SET
    source_entry_ref = EXCLUDED.source_entry_ref,
    priority = GREATEST(public.lexicon_entries.priority, EXCLUDED.priority),
    part_of_speech = EXCLUDED.part_of_speech, phonetic = EXCLUDED.phonetic,
    definition_en = EXCLUDED.definition_en, sentence = EXCLUDED.sentence;

  SELECT count(*), count(DISTINCT lexeme_id), count(*) FILTER (WHERE priority = 100),
         count(*) FILTER (WHERE priority = 0)
    INTO _sense_count, _lexeme_count, _reviewed_count, _unreviewed_count
    FROM public.lexicon_entries WHERE source_id = 'oewn-2025';
  IF (_sense_count, _lexeme_count, _reviewed_count, _unreviewed_count)
     IS DISTINCT FROM (19028, 2742, 26, 19002) THEN
    RAISE EXCEPTION 'OEWN final count mismatch: senses %, lexemes %, priority-100 %, priority-0 %',
      _sense_count, _lexeme_count, _reviewed_count, _unreviewed_count;
  END IF;
  SELECT count(*) INTO _post_source_count FROM public.lexicon_sources
  WHERE id = _meta.id AND version = _meta.version AND source_url = _meta.source_url
    AND license_id = _meta.license_id AND license_url = _meta.license_url
    AND attribution = _meta.attribution AND license_notice = _meta.license_notice
    AND source_sha256 = _meta.archive_sha256 AND transformation = _meta.transformation;
  IF _post_source_count <> 1 THEN RAISE EXCEPTION 'OEWN source provenance post-apply check failed'; END IF;
END
$oewn_apply$;
