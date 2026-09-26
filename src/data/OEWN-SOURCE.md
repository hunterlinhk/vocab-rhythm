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
