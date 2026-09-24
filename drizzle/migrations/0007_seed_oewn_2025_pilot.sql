-- Generated from the official Open English WordNet 2025 JSON archive by scripts/prepare-oewn-2025.mjs.
-- Open English Wordnet 2025 © The Open English WordNet Team (CC BY 4.0).
-- Derived from Princeton WordNet 3.1 © 2011 Princeton University (WordNet License).
-- Selection and field mapping are documented in src/data/OEWN-SOURCE.md.
ALTER TABLE public.lexicon_sources
  ADD COLUMN IF NOT EXISTS source_sha256 text CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS license_notice text,
  ADD COLUMN IF NOT EXISTS transformation text;

INSERT INTO public.lexicon_sources
  (id, title, version, source_url, license_id, license_url, attribution, license_notice, source_sha256, transformation)
VALUES ('oewn-2025', 'Open English WordNet 2025', '2025-12-31', 'https://en-word.net/downloads/english-wordnet-2025-json.zip', 'CC-BY-4.0', 'https://github.com/globalwordnet/english-wordnet/blob/2025-edition/LICENSE.md', 'Open English Wordnet 2025 © The Open English WordNet Team, CC BY 4.0; derived from Princeton WordNet 3.1 © 2011 Princeton University under the WordNet License. This is a selected and transformed NGSL pilot subset; no endorsement is implied.', '1 This software and database is being provided to you, the LICENSEE, by
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
  30 Princeton University and LICENSEE agrees to preserve same.', '7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51', 'Selected NGSL headwords and reviewed OEWN sense IDs from oewn-2025-pilot-senses.tsv; retained the first English definition and example, with US IPA preferred over GB; omitted unlicensed translations.')
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title, version = EXCLUDED.version, source_url = EXCLUDED.source_url,
  license_id = EXCLUDED.license_id, license_url = EXCLUDED.license_url,
  attribution = EXCLUDED.attribution, license_notice = EXCLUDED.license_notice,
  source_sha256 = EXCLUDED.source_sha256,
  transformation = EXCLUDED.transformation;

INSERT INTO public.lexemes (language, normalized_word, lemma)
VALUES
  ('en', 'ability', 'ability'),
  ('en', 'achieve', 'achieve'),
  ('en', 'adapt', 'adapt'),
  ('en', 'analyze', 'analyze'),
  ('en', 'bank', 'bank'),
  ('en', 'book', 'book'),
  ('en', 'challenge', 'challenge'),
  ('en', 'concept', 'concept'),
  ('en', 'create', 'create'),
  ('en', 'decision', 'decision'),
  ('en', 'develop', 'develop'),
  ('en', 'effort', 'effort'),
  ('en', 'evidence', 'evidence'),
  ('en', 'familiar', 'familiar'),
  ('en', 'focus', 'focus'),
  ('en', 'garden', 'garden'),
  ('en', 'hospital', 'hospital'),
  ('en', 'identify', 'identify'),
  ('en', 'improve', 'improve'),
  ('en', 'learn', 'learn'),
  ('en', 'library', 'library'),
  ('en', 'maintain', 'maintain'),
  ('en', 'music', 'music'),
  ('en', 'perform', 'perform'),
  ('en', 'teacher', 'teacher'),
  ('en', 'water', 'water')
ON CONFLICT (language, normalized_word) DO NOTHING;

INSERT INTO public.lexicon_entries
  (lexeme_id, source_id, source_entry_ref, sense_key, priority, part_of_speech, phonetic, definition_en, sentence)
SELECT l.id, 'oewn-2025', v.source_entry_ref, v.sense_key, v.priority,
       v.part_of_speech, v.phonetic, v.definition_en, v.sentence
FROM (VALUES
  ('ability', 'ability%1:07:00::', 'ability%1:07:00::', 100, 'noun', '/əˈbɪl.ə.ti/', 'the quality of being able to perform; a quality that permits or facilitates achievement or accomplishment', NULL),
  ('achieve', 'achieve%2:41:00::', 'achieve%2:41:00::', 100, 'verb', '/əˈtʃiːv/', 'to gain with effort', 'she achieved her goal despite setbacks'),
  ('adapt', 'adapt%2:30:01::', 'adapt%2:30:01::', 100, 'verb', '/əˈdæpt/', 'make fit for, or change to suit a new purpose', 'Adapt our native cuisine to the available food resources of the new country'),
  ('analyze', 'analyze%2:31:00::', 'analyze%2:31:00::', 100, 'verb', '/ˈæn.ə.laɪz/', 'consider in detail and subject to an analysis in order to discover essential features or meaning', 'analyze a sonnet by Shakespeare'),
  ('bank', 'bank%1:14:00::', 'bank%1:14:00::', 100, 'noun', NULL, 'a financial institution that accepts deposits and channels the money into lending activities', 'he cashed a check at the bank'),
  ('book', 'book%1:10:00::', 'book%1:10:00::', 100, 'noun', NULL, 'a written work or composition that has been published (printed on pages bound together)', 'I am reading a good book on economics'),
  ('challenge', 'challenge%1:26:00::', 'challenge%1:26:00::', 100, 'noun', '/ˈtʃæl.ɪndʒ/', 'a demanding or stimulating situation', 'they reacted irrationally to the challenge of Russian power'),
  ('concept', 'concept%1:09:00::', 'concept%1:09:00::', 100, 'noun', '/ˈkɒn.sɛpt/', 'an abstract or general idea inferred or derived from specific instances', NULL),
  ('create', 'create%2:36:00::', 'create%2:36:00::', 100, 'verb', '/kɹiːˈeɪt/', 'make or cause to be or to become', 'make a mess in one''s office'),
  ('decision', 'decision%1:04:00::', 'decision%1:04:00::', 100, 'noun', '/dɪˈsɪʒən/', 'the act of making up your mind about something', 'the burden of decision was his'),
  ('develop', 'develop%2:36:01::', 'develop%2:36:01::', 100, 'verb', '/dɪˈvɛl.əp/', 'make something new, such as a product or a mental or artistic creation', 'Her company developed a new kind of building material that withstands all kinds of weather'),
  ('effort', 'effort%1:04:00::', 'effort%1:04:00::', 100, 'noun', '/ˈɛfɚt/', 'earnest and conscientious activity intended to do or accomplish something', 'made an effort to cover all the reading material'),
  ('evidence', 'evidence%1:09:00::', 'evidence%1:09:00::', 100, 'noun', '/ˈɛvɪdəns/', 'your basis for belief or disbelief; knowledge on which to base belief', 'the evidence that smoking causes lung cancer is very compelling'),
  ('familiar', 'familiar%3:00:00::', 'familiar%3:00:00::', 100, 'adjective', '/fəˈmɪl.jɚ/', 'well known or easily recognized', 'a familiar figure'),
  ('focus', 'focus%1:09:00::', 'focus%1:09:00::', 100, 'noun', '/ˈfoʊ.kəs/', 'the concentration of attention or energy on something', 'the focus of activity shifted to molecular biology'),
  ('garden', 'garden%1:06:00::', 'garden%1:06:00::', 100, 'noun', '/ˈɡɑɹdən/', 'a plot of ground where plants are cultivated', NULL),
  ('hospital', 'hospital%1:06:00::', 'hospital%1:06:00::', 100, 'noun', '/ˈhɑs.pɪ.tl̩/', 'a health facility where patients receive treatment', NULL),
  ('identify', 'identify%2:31:00::', 'identify%2:31:00::', 100, 'verb', '/aɪˈdɛn.tɪ.faɪ/', 'recognize as being; establish the identity of someone or something', 'She identified the man on the ‘wanted’ poster'),
  ('improve', 'improve%2:30:01::', 'improve%2:30:01::', 100, 'verb', '/ɪmˈpɹuːv/', 'to make better', 'The editor improved the manuscript with his changes'),
  ('learn', 'learn%2:31:00::', 'learn%2:31:00::', 100, 'verb', NULL, 'gain knowledge or skills', 'She learned dancing from her sister'),
  ('library', 'library%1:06:01::', 'library%1:06:01::', 100, 'noun', '/ˈlaɪˌbɹɛɹi/', 'a room where books are kept', 'they had brandy in the library'),
  ('maintain', 'maintain%2:42:00::', 'maintain%2:42:00::', 100, 'verb', '/meɪnˈteɪn/', 'cause to continue in a certain state, position, or activity', 'hold in place'),
  ('music', 'music%1:10:00::', 'music%1:10:00::', 100, 'noun', '/ˈmjuzɪk/', 'an artistic form of auditory communication incorporating instrumental or vocal tones in a structured and continuous manner', NULL),
  ('perform', 'perform%2:36:00::', 'perform%2:36:00::', 100, 'verb', '/pɚˈfɔɹm/', 'carry out or perform an action', 'John did the painting, the weeding, and he cleaned out the gutters'),
  ('teacher', 'teacher%1:18:00::', 'teacher%1:18:00::', 100, 'noun', '/ˈtit͡ʃɚ/', 'a person whose occupation is teaching', NULL),
  ('water', 'water%1:27:00::', 'water%1:27:00::', 100, 'noun', NULL, 'binary compound that occurs at room temperature as a clear colorless odorless tasteless liquid; freezes into ice below 0 degrees centigrade and boils above 100 degrees centigrade; widely used as a solvent', NULL)
) AS v(normalized_word, source_entry_ref, sense_key, priority, part_of_speech, phonetic, definition_en, sentence)
JOIN public.lexemes AS l ON l.language = 'en' AND l.normalized_word = v.normalized_word
ON CONFLICT (lexeme_id, source_id, sense_key) DO UPDATE SET
  source_entry_ref = EXCLUDED.source_entry_ref, priority = EXCLUDED.priority,
  part_of_speech = EXCLUDED.part_of_speech, phonetic = EXCLUDED.phonetic,
  definition_en = EXCLUDED.definition_en, sentence = EXCLUDED.sentence;
