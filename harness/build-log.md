# Current OEWN work

- Branch: `feat/oewn-2025-ngsl-import`. Fetched and merged `origin/main` at `1a38b36` with merge commit `dbde73f`; no conflicts. Lovable's latest UI/routes were retained. Old branches and `main` were not rewritten.
- Scope: all exact-headword OEWN 2025 senses enter a staged, batched, transactional upsert; `--dry-run` renders the same SQL in memory and reports counts/checksum without writes. The `WordEntry` adapter uses only explicitly reviewed OEWN primaries, preserving 26 pilot meanings and book-local overrides. No UI or applied migration `0000`–`0008` changes; no production database write.
- Source: pinned official OEWN 2025 JSON archive with SHA-256 `7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51`, kept outside Git at `../oewn-2025/`.
- Observed dry-run: 2,809 NGSL words; 2,742 exact headwords yield 19,028 senses; 5 case-only and 62 unmatched excluded; 26 reviewed primaries and 19,002 unreviewed senses. See `src/data/OEWN-SOURCE.md`.
- Local database check: after migrations 0006/0007, executing generated full SQL twice in PGlite left 2,742 lexemes and 19,028 OEWN senses, with 26 priority-100 pilot entries and 19,002 priority-0 entries. Source version, license, and archive hash matched.
- Validation: 24/24 tests passed; `npx tsc --noEmit`, scoped ESLint, and `npm run build` passed. Dry-run SQL SHA-256 `2d8aa9e016d6af27738b2473868499593b9634cecfcb195611a447a8bb1e2740` matched generated `full-import.sql`; `--check` passed.
- Next action: commit and push this branch. Before a future online import, check live migration state, test on a database copy, prepare backup and controlled transaction, and provide visible attribution before UI exposure.
