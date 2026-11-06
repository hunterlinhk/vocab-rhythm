# Cadence Round 2 editorial content

The `source` directory preserves the rewrite JSON and original Round 2 decisions. The generator validates every headword, decision, existing primary ID, and OEWN candidate ID against those inputs and the unchanged 26-row pilot. It also requires a non-empty usage note on each of the 45 input records.

The 45 input records produce 43 sense rows and 45 usage-note rows (88 rows total): 40 primary senses, 3 supplementary senses, and 45 separate usage notes. Each input word has exactly one note. The notes for the 43 sense-bearing inputs link to that new editorial sense; the `forth` and `alright` notes link to their existing audited OEWN sense IDs because those inputs contain no replacement gloss. No sense content is invented for those two words. Usage-note rows have no translation, part of speech, phonetic, definition, or example fields.

Editorial `sense_key` values are namespaced `cadence-round2:` keys. Original OEWN IDs stay in the vendored audit inputs and as related-sense references; they are never replaced. Round 2 decisions are stored once per input word and retained in the source files.

All 88 imported rows are `pending_review`, and the editorial source is `restricted`. Neither the server reader nor the row security policy exposes them as learning content. The import does not change any user's book entries or learning records. The importer is deterministic and idempotent; if an earlier 45-row pending import exists under the same source ID, rerunning this version adds the 43 missing notes and validates the final 88-row state.

## Prepare and release

From the repository root, run:

```sh
node scripts/prepare-cadence-round2-editorial.mjs --check
```

For a future release, use this order:

1. Back up the database and apply Drizzle migrations `0018_lexicon_editorial_content` and `0019_apply_pending_0018_marker` through the established migration path.
2. Re-run the generator check and execute `01-import-pending.sql` in a staging database. Verify the source is restricted and all 88 rows remain pending; only then run the same import against the target database.
3. Deploy the Node server build after the database migration and import are ready. Published primary senses fill only missing local-book fields; supplementary senses and linked usage notes remain separate, and book-local content continues to win.
4. After separate editorial approval, publish only approved rows and change the source to public in the same transaction. The reader and RLS policy require `publication_status = 'published'`.

This branch prepares these files only. No shared or production database migration/import, approval, or application deployment has been performed. Migration behavior was tested only in disposable PGlite.

## Rollback

If any of this source is made public, execute `02-rollback-editorial-source.sql` first. It restricts the source before deleting only that source's lexicon rows and source record; shared lexemes and user book or learning data remain. Then roll back the frontend release. Restricting the source first also prevents an older reader from treating supplementary rows as primary meanings.

The migration is additive. Leave it in place during a normal rollback; remove it only after the source rows are gone, the frontend no longer reads the new columns, and a separately reviewed schema rollback restores the previous row-security policy and required source-license fields.
