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

Omit `--check` to rewrite the generated JSON and SQL. Apply migration `0006_shared_lexicon.sql` before `0007`. The `0007` pilot seeds only reviewed senses. The separate full import below stores every exact-headword OEWN sense while keeping unreviewed meanings out of `WordEntry` hydration until explicitly selected.

## NGSL-wide OEWN import preparation

`scripts/prepare-oewn-2025-ngsl.mjs` checks the pinned archive SHA-256, reads JSON directly from that archive (so stale extracted files cannot affect results), and scans all 2,809 NGSL headwords. It requires `tar` with ZIP support. Dry-run validates the input, renders the same SQL in memory, and prints the import plan plus SQL checksum without writing files or accessing a database. Its counts are source-derived estimates, not a comparison with live database state:

```sh
node scripts/prepare-oewn-2025-ngsl.mjs english-wordnet-2025-json.zip --dry-run
```

Audit generation writes deterministic files to a chosen output directory:

- `summary.json`: counts, field coverage, source version, checksum, and review policy;
- `lemmas.json`: one row per NGSL headword with match status, sense IDs and counts, POS counts, and ambiguity flags;
- `candidate-senses.json`: source definitions, POS, IPA, examples, exact OEWN sense IDs, and NGSL words for exact headword matches;
- `reviewed-import.sql`: a transactional upsert of the 26 explicitly reviewed pilot senses;
- `ops/oewn-2025-ngsl/`: the separate Lovable Cloud staging operation pack, generated with `--lovable-cloud-bundle`.

Run it with the official archive:

```sh
node scripts/prepare-oewn-2025-ngsl.mjs english-wordnet-2025-json.zip ./oewn-audit
node scripts/prepare-oewn-2025-ngsl.mjs english-wordnet-2025-json.zip ./oewn-audit --check
```

The default reviewed list is the existing 26-sense `oewn-2025-pilot-senses.tsv`. To expand the set of _default learning senses_, make a reviewed TSV and pass `--reviewed path/to/reviewed.tsv`. Each line is `NGSL headword<TAB>OEWN sense ID<TAB>priority`. Priority is optional for a single sense and defaults to 100. If several senses are reviewed for one word, mark exactly one as primary with priority 100 and give the others lower priorities. Case-only matches are held separately, since `it` → `IT`, `or` → `OR`, and `who` → `WHO` are acronym collisions. Their possible senses appear in the lemma audit but are not eligible for automatic import.

The full import treats exact spelling as grounds to store OEWN's own lexical senses, **not** as evidence that any one sense is NGSL's intended learning meaning. The existing `WordEntry` adapter ignores unreviewed OEWN senses at priority 0. Only an explicitly reviewed primary at priority 100 can fill optional learning fields, while book-local fields still win. An expanded reviewed TSV must keep all 26 pilot selections; generation checks that their source content and reviewed status remain intact. Case-only matches and unmatched words remain in the audit and are excluded from the staging pack.

Against the pinned 2025 archive, 2,742 NGSL headwords have exact OEWN headwords, 5 have only a case-insensitive spelling match (29 additional senses held for review), and 62 have none. The exact matches expose 19,028 senses for staged import. Of the exact matches, 2,508 have multiple senses, 1,393 have multiple POS labels, and 15 have OEWN split homograph POS keys such as `n-1`/`n-2`. These categories overlap. Sense field coverage is 13,365/19,028 IPA, 19,028/19,028 English definitions, and 14,132/19,028 source examples. At least one sense supplies IPA for 2,205/2,742 exact-matched lemmas, an English definition for 2,742/2,742, and an example for 2,512/2,742. The generated JSON contains per-word details and the full unmatched list. No claim is made that any particular OEWN sense is NGSL's default learning sense. Only 26 reviewed primaries currently qualify for `WordEntry` hydration.

The staged SQL stores the OEWN source ID, version, URL, archive checksum, CC BY 4.0 license, attribution, Princeton WordNet notice, transformation description, and each original sense ID. `ON CONFLICT` makes repeated execution stable; the priority update uses `GREATEST` so a full run cannot demote reviewed pilot rows.

## Lovable Cloud staging operation pack

The full import is data-only and targets the existing `0006–0008` Shared Lexicon schema, so it is not a Drizzle migration. Generate the reproducible Lovable Cloud pack from the pinned archive:

```sh
node scripts/prepare-oewn-2025-ngsl.mjs /path/to/english-wordnet-2025-json.zip ./ops/oewn-2025-ngsl --lovable-cloud-bundle
node scripts/prepare-oewn-2025-ngsl.mjs /path/to/english-wordnet-2025-json.zip ./ops/oewn-2025-ngsl --lovable-cloud-bundle --check
```

The pack has a setup file, ten staging batch files, staging validation, one final apply, read-only verification, cleanup, and a manifest with byte sizes and SHA-256 values for every SQL file. No multi-megabyte one-shot data SQL is generated. Each staging `INSERT` has at most 1,000 senses; each batch file contains two independent statements and can be safely rerun after a partial failure. Setup and batch files write only to the non-public `oewn_stage_2025` schema. Setup is idempotent and does not drop existing staging rows.

Run the SQL files in this order in Lovable Cloud → SQL editor:

1. `00-stage-setup.sql` creates the private staging schema, tables, and expected source provenance.
2. `01-stage-batches.sql` through `10-stage-batches.sql`, in numeric order, load 19,028 sense rows. Each statement uses `ON CONFLICT` and is retry-safe.
3. `11-stage-validation.sql` must report `STAGING VALIDATED`, 2,742 lexemes, 19,028 senses, the exact 26 approved pilot sense IDs at priority 100, 19,002 unreviewed senses, all 20 complete batches, and the expected archive SHA-256. It raises an error if source/version/license/attribution/notice/transformation, pilot identities, or counts differ.
4. `12-final-apply.sql` is exactly one PostgreSQL `DO` statement. It checks staging and the existing pilot before upserting source provenance, lexemes, and senses. Any raised exception rolls back this statement's complete public-table changes. The 26 pilot senses stay priority 100; the other 19,002 stay priority 0. Reapplying is safe.
5. `13-verification.sql` is read-only; proceed only when counts and provenance fields match and `overall_match` is `true`.
6. `14-cleanup.sql` rechecks public counts and provenance, then drops the staging schema only if they still match.

`manifest.json` contains the expected archive checksum and each SQL file's SHA-256. Before opening SQL Editor, verify the checked-out/generated package with `--check` or compare each local file against the manifest. Case-only and unmatched NGSL words are excluded from staging and remain in the audit. Do not edit migrations `0000–0008`.

Publish visible attribution alongside publicly displayed OEWN content before exposing additional senses in the UI.
