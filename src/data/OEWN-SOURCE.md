# Open English WordNet 2025: NGSL pilot

This pilot uses the **Open English WordNet 2025 edition**, not the 2025+ proper-name edition. The source is the [official JSON archive](https://en-word.net/downloads/english-wordnet-2025-json.zip), released on 2025-12-31. Its SHA-256 is `7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51`. The archive is not committed to this repository.

Open English WordNet is developed under [CC BY 4.0](https://github.com/globalwordnet/english-wordnet/blob/2025-edition/LICENSE.md) and derives from Princeton WordNet under its own license. Credit both the Open English WordNet team and Princeton University. The source's [WordNet copyright and disclaimer notice](OEWN-WNDB-LICENSE.txt) is retained with trailing whitespace normalized, and the migration stores it with the source record. The prepared data is a selected and transformed subset; the source does not endorse this project.

The official archive contains headwords matching roughly 2,747 of NGSL's 2,809 words by case-insensitive spelling. A spelling match does not prove a meaning match: function words can match a letter name or another unrelated sense. For this first import, [the review list](oewn-2025-pilot-senses.tsv) pins 26 NGSL words to specific OEWN sense IDs. The generator retains one English definition, its part of speech, the first available source example, and one IPA pronunciation (US preferred, then GB). It adds **no Chinese translation**, inferred IPA, or invented example. Missing fields remain null. NGSL order and frequency stay in the NGSL source list.

The generated [pilot data](oewn-2025-pilot.json) is inspectable; migration `0007_seed_oewn_2025_pilot.sql` inserts the same 26 rows into shared `lexemes` and `lexicon_entries`, alongside version, archive checksum, license, attribution, original sense ID, and transformation details in `lexicon_sources`. `word_entries` and user learning records are not modified by this import. The existing Lexicon reader joins NGSL and custom-book words by normalized spelling; book-specific progress continues to use `bookId + word`.

To regenerate after downloading the pinned archive:

```sh
mkdir -p /tmp/oewn-2025
tar -xf english-wordnet-2025-json.zip -C /tmp/oewn-2025
node scripts/prepare-oewn-2025.mjs english-wordnet-2025-json.zip /tmp/oewn-2025 --check
```

Omit `--check` to rewrite the generated JSON and SQL. Apply migration `0006_shared_lexicon.sql` before `0007`. This first import deliberately stops at reviewed senses; expanding to the wider NGSL match set should include a sense-quality review and a plan for visible source attribution before public release.

## NGSL-wide candidate audit and staged import

`scripts/prepare-oewn-2025-ngsl.mjs` checks the same pinned archive SHA-256, reads JSON directly from that archive (so stale extracted files cannot affect results), scans all 2,809 NGSL headwords, and writes four deterministic files to a chosen output directory. It requires `tar` with ZIP support:

- `summary.json`: counts, field coverage, source version, checksum, and review policy;
- `lemmas.json`: one row per NGSL headword with match status, sense IDs and counts, POS counts, and ambiguity flags;
- `candidate-senses.json`: source definitions, POS, IPA, examples, exact OEWN sense IDs, and NGSL words for exact headword matches;
- `reviewed-import.sql`: a transactional, repeatable upsert of **reviewed senses only**. It does not write `word_entries` or learning records.

Run it with the official archive:

```sh
node scripts/prepare-oewn-2025-ngsl.mjs english-wordnet-2025-json.zip ./oewn-audit
node scripts/prepare-oewn-2025-ngsl.mjs english-wordnet-2025-json.zip ./oewn-audit --check
```

The default reviewed list is the existing 26-sense `oewn-2025-pilot-senses.tsv`. To expand it, make a reviewed TSV and pass `--reviewed path/to/reviewed.tsv`. Each line is `NGSL headword<TAB>OEWN sense ID<TAB>priority`. Priority is optional for a single sense and defaults to 100. If several senses are reviewed for one word, mark exactly one as primary with priority 100 and give the others lower priorities. An exact spelling match is only a **candidate**; it never becomes import-ready without an explicit reviewed word/sense pair. Case-only matches are held separately, since `it` → `IT`, `or` → `OR`, and `who` → `WHO` are acronym collisions. Their possible senses appear in the lemma audit but are not eligible for automatic import.

Against the pinned 2025 archive, 2,742 NGSL headwords have exact OEWN headwords, 5 have only a case-insensitive spelling match (29 additional senses held for review), and 62 have none. The exact matches expose 19,028 candidate senses. Of the exact matches, 2,508 have multiple senses, 1,393 have multiple POS labels, and 15 have OEWN split homograph POS keys such as `n-1`/`n-2`. These categories overlap. The candidate sense field coverage is 13,365/19,028 IPA, 19,028/19,028 English definitions, and 14,132/19,028 source examples. At least one sense supplies IPA for 2,205/2,742 exact-matched lemmas, an English definition for 2,742/2,742, and an example for 2,512/2,742. The generated JSON contains the per-word details and the full unmatched list. These counts are **candidate coverage**, not a claim that all 19,028 senses match NGSL's intended meanings. The only currently import-ready set remains the 26 reviewed pilot senses.

The staged SQL stores the OEWN source ID, version, URL, archive checksum, CC BY 4.0 license, attribution, Princeton WordNet notice, transformation description, and original sense ID. `ON CONFLICT` makes a repeated execution stable. Before applying an expanded set online, review the TSV and generated SQL, verify the live database has migrations 0006–0008, prepare a new migration/import operation, and check counts and source IDs in a transaction. Publish visible attribution alongside any publicly displayed OEWN content. Do not edit already applied migrations 0005–0008.
