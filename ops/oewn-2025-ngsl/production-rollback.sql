-- Roll back the full OEWN 2025 NGSL import before exposing its unreviewed senses.
-- Requires the exact imported archive and counts. Keeps all 26 reviewed pilot senses and shared lexemes.
BEGIN;
DO $$
DECLARE _senses bigint; _pilots bigint; _unreviewed bigint; _lexemes bigint;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE priority=100), count(*) FILTER (WHERE priority=0), count(DISTINCT lexeme_id)
    INTO _senses, _pilots, _unreviewed, _lexemes
    FROM public.lexicon_entries WHERE source_id='oewn-2025';
  IF (_senses, _pilots, _unreviewed, _lexemes) IS DISTINCT FROM (19028, 26, 19002, 2742) THEN
    RAISE EXCEPTION 'Rollback stopped: OEWN rows no longer match the prepared import (senses %, pilots %, unreviewed %, lexemes %)', _senses, _pilots, _unreviewed, _lexemes;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.lexicon_sources WHERE id='oewn-2025' AND version='2025-12-31' AND source_sha256='7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51') THEN
    RAISE EXCEPTION 'Rollback stopped: OEWN source provenance changed';
  END IF;
  IF (SELECT count(*) FROM public.lexicon_entries WHERE source_id='oewn-2025' AND priority=100 AND sense_key IN ('ability%1:07:00::', 'achieve%2:41:00::', 'adapt%2:30:01::', 'analyze%2:31:00::', 'bank%1:14:00::', 'book%1:10:00::', 'challenge%1:26:00::', 'concept%1:09:00::', 'create%2:36:00::', 'decision%1:04:00::', 'develop%2:36:01::', 'effort%1:04:00::', 'evidence%1:09:00::', 'familiar%3:00:00::', 'focus%1:09:00::', 'garden%1:06:00::', 'hospital%1:06:00::', 'identify%2:31:00::', 'improve%2:30:01::', 'learn%2:31:00::', 'library%1:06:01::', 'maintain%2:42:00::', 'music%1:10:00::', 'perform%2:36:00::', 'teacher%1:18:00::', 'water%1:27:00::')) <> 26 THEN
    RAISE EXCEPTION 'Rollback stopped: reviewed pilot sense IDs changed';
  END IF;
END $$;

DELETE FROM public.lexicon_entries WHERE source_id='oewn-2025' AND priority=0;
UPDATE public.lexicon_sources SET
  attribution='Open English Wordnet 2025 © The Open English WordNet Team, CC BY 4.0; derived from Princeton WordNet 3.1 © 2011 Princeton University under the WordNet License. This is a selected and transformed NGSL pilot subset; no endorsement is implied.',
  transformation='Selected NGSL headwords and reviewed OEWN sense IDs from oewn-2025-pilot-senses.tsv; retained the first English definition and example, with US IPA preferred over GB; omitted unlicensed translations.'
WHERE id='oewn-2025' AND version='2025-12-31' AND source_sha256='7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51';
COMMIT;
