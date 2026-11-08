# Dictionary foundation and automatic book indexing

## Goal

Import the local ECDICT-backed foundation into Cadence's shared PostgreSQL lexicon so future official and user-created books resolve entries by normalized headword. Use completed Cadence-authored entries as the authoritative visible content for overlapping words, with ECDICT filling missing fields.

## Constraints and decisions

- Work on `feat/dictionary-foundation-indexing`, based on the current self-hosted Better Auth/PostgreSQL branch.
- Do not connect to, migrate, import into, upload to, or restart the Alibaba Cloud server until the owner confirms the final transfer step.
- Do not commit the 196 MiB SQLite database or source snapshots to Git; prepare a separately hashed, streamable server import artifact.
- Keep per-book content highest priority. Shared Cadence-authored content overrides ECDICT for effective lookup; retain the original ECDICT source record for audit/rebuild rather than destructively discarding it.
- Keep pending/restricted Round 2 content hidden and preserve existing NGSL, OEWN, pilot, progress, and user data.
- Custom-book rows remain private and must not write into the shared lexicon. Their existing `word_entries` link and shared lookup path should continue to work.

## Architecture and implementation state

- `word_entries` already has a database trigger that creates/links a `lexemes` row by normalized spelling.
- `getBookEntries`, bundled-book reads, and `resolveEntries` already call batched `hydrateEntries`; this includes custom books.
- A custom book links only its word spelling to the shared lexeme; its translation remains in the user's own `word_entries` row and wins during hydration.
- The local SQLite source contains 770,611 ECDICT rows, 30,000 ranked headwords, 4,489 expression inventory rows, 525 authored headwords/2,904 senses, and 1,342 authored expressions/1,451 senses. All 525 authored headwords overlap ECDICT.
- Authored headword documents/senses take precedence in effective lookup. ECDICT rows remain a separate, unchanged source for traceability and fallback. No ECDICT sense is destructively replaced.
- Curated expression content is parent-linked in `lexicon_documents`, keyed by source-row ID. Repeated phrase rows cannot overwrite each other and are grouped by parent/phrase for display. The v2 import stores expression senses and usage notes only in these documents, never as independent `lexicon_entries` senses. It cross-checks all headword and expression senses and all 1,844 usage notes against their complete documents.
- Headword content imports as 2,904 senses and 982 usage-note rows. Total authored usage notes are 1,844 (982 headword + 862 expression).
- Lookup hydration now groups up to 1,000 words per database batch; custom books can contain up to 5,000 entries.
- The v2 package is generated locally at `C:\headswap\Cadence_30k_headwords\server_upload\Cadence_dictionary_foundation_2026-11-08.zip`; regenerate and rehash after importer/exporter changes.

## Implementation scope

1. Drizzle migrations define the additive source, expression, and document tables.
2. A read-only exporter builds a hashed package from `C:\headswap\Cadence_30k_headwords\dictionary_entries\cadence_dictionary.sqlite3`.
3. The streaming importer keeps sources restricted during first import, validates hashes/counts/overlap/protected data, verifies expression-to-parent mapping, and publishes only after all checks pass.
4. The shared resolver checks book-local content before shared authored content and ECDICT fallback. Round 2 remains hidden while pending/restricted.
5. A narrowly scoped rollback removes only the three new source layers and verifies OEWN, Round 2, lexemes, and user learning data remain intact.
6. Final handoff includes the reviewed branch, package SHA-256, verification result, server commands, and rollback command. Do not upload or connect to the server until the owner confirms.

## Checkpoint

- Branch: `feat/dictionary-foundation-indexing`, based on `feat/self-hosted-better-auth-postgres` at `088a7384da9cd36f60b087a4a840be151e713a23`.
- Implementation and deployment docs, including the source-ID expression-key correction, are pushed at `bbe02f2`.
- No server connection, migration, SQL, import, ZIP upload, or deploy has occurred.
- The v2 package was regenerated and verified; tests 109/109, TypeScript, production build, ZIP/file hashes, cross-file authored mapping, and local SQLite integrity checks passed.
- Current ZIP SHA-256 is `d04c98c60b498e6f48d39bc1656ea36c55478fd594d309a3570d490d00216382`.
- Next action: wait for the owner's confirmation before transferring the ZIP and running the documented backup → migration → import → verify → app restart sequence.
