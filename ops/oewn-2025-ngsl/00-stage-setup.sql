-- OEWN staging setup only. This file creates objects outside public and seeds provenance metadata.
CREATE SCHEMA IF NOT EXISTS oewn_stage_2025;
REVOKE ALL ON SCHEMA oewn_stage_2025 FROM PUBLIC;

CREATE TABLE IF NOT EXISTS oewn_stage_2025.import_meta (
  id text PRIMARY KEY CHECK (id = 'oewn-2025'),
  version text NOT NULL,
  archive_sha256 text NOT NULL,
  source_url text NOT NULL,
  license_id text NOT NULL,
  license_url text NOT NULL,
  attribution text NOT NULL,
  license_notice text NOT NULL,
  transformation text NOT NULL,
  expected_lexemes integer NOT NULL,
  expected_senses integer NOT NULL,
  expected_reviewed integer NOT NULL,
  expected_unreviewed integer NOT NULL,
  expected_batches integer NOT NULL,
  rows_per_batch integer NOT NULL
);

CREATE TABLE IF NOT EXISTS oewn_stage_2025.senses (
  batch_no integer NOT NULL CHECK (batch_no > 0),
  normalized_word text NOT NULL,
  lemma text NOT NULL,
  source_entry_ref text NOT NULL,
  sense_key text PRIMARY KEY,
  priority integer NOT NULL CHECK (priority IN (0, 100)),
  part_of_speech text NOT NULL,
  phonetic text,
  definition_en text NOT NULL,
  sentence text,
  CHECK (source_entry_ref = sense_key)
);
CREATE INDEX IF NOT EXISTS oewn_stage_senses_word_idx
  ON oewn_stage_2025.senses (normalized_word);
CREATE INDEX IF NOT EXISTS oewn_stage_senses_batch_idx
  ON oewn_stage_2025.senses (batch_no);
REVOKE ALL ON ALL TABLES IN SCHEMA oewn_stage_2025 FROM PUBLIC;

INSERT INTO oewn_stage_2025.import_meta
  (id, version, archive_sha256, source_url, license_id, license_url, attribution,
   license_notice, transformation, expected_lexemes, expected_senses, expected_reviewed,
   expected_unreviewed, expected_batches, rows_per_batch)
VALUES ('oewn-2025', '2025-12-31', '7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51', 'https://en-word.net/downloads/english-wordnet-2025-json.zip', 'CC-BY-4.0', 'https://github.com/globalwordnet/english-wordnet/blob/2025-edition/LICENSE.md', 'Open English Wordnet 2025 © The Open English WordNet Team, CC BY 4.0; derived from Princeton WordNet 3.1 © 2011 Princeton University under the WordNet License. Selected and transformed NGSL senses; no endorsement is implied.', '1 This software and database is being provided to you, the LICENSEE, by
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
  30 Princeton University and LICENSEE agrees to preserve same.', 'Exact-spelling NGSL headwords and explicitly reviewed sense IDs; first source definition and synset example; US IPA preferred over GB. No inferred content, translations, or automatic default sense.', '2742', '19028', '26', '19002', '20', '1000')
ON CONFLICT (id) DO NOTHING;
