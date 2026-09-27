-- Guarded cleanup. Drops staging only while the verified public import and provenance still match.
DO $oewn_cleanup$
DECLARE
  _matches boolean;
BEGIN
  WITH counts AS (
    SELECT count(*) AS senses, count(DISTINCT lexeme_id) AS lexemes,
           count(*) FILTER (WHERE priority = 100) AS priority_100,
           count(*) FILTER (WHERE priority = 0) AS priority_0
    FROM public.lexicon_entries WHERE source_id = 'oewn-2025'
  ), source AS (
    SELECT count(*) AS source_rows,
           bool_and(version = '2025-12-31' AND source_url = 'https://en-word.net/downloads/english-wordnet-2025-json.zip'
             AND license_id = 'CC-BY-4.0' AND license_url = 'https://github.com/globalwordnet/english-wordnet/blob/2025-edition/LICENSE.md'
             AND attribution = 'Open English Wordnet 2025 © The Open English WordNet Team, CC BY 4.0; derived from Princeton WordNet 3.1 © 2011 Princeton University under the WordNet License. Selected and transformed NGSL senses; no endorsement is implied.'
             AND source_sha256 = '7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51'
             AND license_notice = '1 This software and database is being provided to you, the LICENSEE, by
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
             AND transformation = 'Exact-spelling NGSL headwords and explicitly reviewed sense IDs; first source definition and synset example; US IPA preferred over GB. No inferred content, translations, or automatic default sense.') AS provenance_match
    FROM public.lexicon_sources WHERE id = 'oewn-2025'
  )
  SELECT (c.senses = 19028 AND c.lexemes = 2742
          AND c.priority_100 = 26 AND c.priority_0 = 19002
          AND s.source_rows = 1 AND coalesce(s.provenance_match, false))
    INTO _matches
    FROM counts c CROSS JOIN source s;
  IF _matches IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'OEWN cleanup refused: post-import counts or provenance do not match';
  END IF;
  EXECUTE 'DROP SCHEMA IF EXISTS oewn_stage_2025 CASCADE';
END
$oewn_cleanup$;
