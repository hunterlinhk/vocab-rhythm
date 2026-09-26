-- Keep optional editorial learning fields separate from source-list statistics.
ALTER TABLE public.word_entries
  ADD COLUMN part_of_speech text,
  ADD COLUMN source_rank integer,
  ADD COLUMN source_sfi numeric,
  ADD COLUMN source_frequency_per_million numeric;
