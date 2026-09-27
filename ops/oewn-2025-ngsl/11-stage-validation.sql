-- Read-only staging validation. Raises an exception unless all counts and provenance match.
DO $oewn_validate$
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
BEGIN
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
END
$oewn_validate$;

SELECT 'STAGING VALIDATED' AS result, count(*) AS senses,
       count(DISTINCT normalized_word) AS lexemes,
       count(*) FILTER (WHERE priority = 100) AS reviewed_pilot_senses,
       count(*) FILTER (WHERE priority = 0) AS unreviewed_senses,
       count(DISTINCT batch_no) AS complete_batches,
       max(m.id) AS source_id, max(m.version) AS source_version,
       max(m.source_url) AS source_url, max(m.license_id) AS license_id,
       max(m.license_url) AS license_url, max(m.attribution) AS attribution,
       max(m.archive_sha256) AS source_archive_sha256,
       bool_and(m.version = '2025-12-31' AND m.source_url = 'https://en-word.net/downloads/english-wordnet-2025-json.zip'
         AND m.license_id = 'CC-BY-4.0' AND m.license_url = 'https://github.com/globalwordnet/english-wordnet/blob/2025-edition/LICENSE.md'
         AND m.attribution = 'Open English Wordnet 2025 © The Open English WordNet Team, CC BY 4.0; derived from Princeton WordNet 3.1 © 2011 Princeton University under the WordNet License. Selected and transformed NGSL senses; no endorsement is implied.'
         AND m.archive_sha256 = '7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51'
         AND m.license_notice = '1 This software and database is being provided to you, the LICENSEE, by
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
  30 Princeton University and LICENSEE agrees to preserve same.'
         AND m.transformation = 'Exact-spelling NGSL headwords and explicitly reviewed sense IDs; first source definition and synset example; US IPA preferred over GB. No inferred content, translations, or automatic default sense.') AS provenance_match
FROM oewn_stage_2025.senses CROSS JOIN oewn_stage_2025.import_meta m
WHERE m.id = 'oewn-2025';
