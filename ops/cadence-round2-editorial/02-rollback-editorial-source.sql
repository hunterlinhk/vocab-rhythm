BEGIN;

UPDATE public.lexicon_sources SET access_tier = 'restricted' WHERE id = 'cadence-round2-editorial-bccb9a1ab863';
DELETE FROM public.lexicon_entries WHERE source_id = 'cadence-round2-editorial-bccb9a1ab863';
DELETE FROM public.lexicon_sources WHERE id = 'cadence-round2-editorial-bccb9a1ab863';

COMMIT;
