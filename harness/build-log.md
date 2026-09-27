# Current OEWN work

- Branch: `feat/oewn-2025-ngsl-import`, created from `origin/main` at `fe138d7`. The old `feat/oewn-lexicon-import` branch remains untouched.
- Scope: deterministic NGSL-wide OEWN 2025 candidate audit and reviewed-only staged SQL. No UI, Shared Lexicon reader, or applied migration changes; no production database write.
- Source: pinned official OEWN 2025 JSON archive with SHA-256 `7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51`, kept outside Git at `../oewn-2025/`.
- Current observed audit: 2,809 NGSL words; 2,742 exact OEWN headwords with 19,028 candidate senses; 5 case-only spellings held; 62 unmatched. Only the existing 26 reviewed pilot senses are import-ready. See `src/data/OEWN-SOURCE.md` for coverage and review rules.
- Validation: `npm test` passed 20/20; `npx tsc --noEmit`, `npm run build`, scoped ESLint, and generator `--check` passed. The 26 generated senses match the existing pilot fields. In local PGlite, applying migrations 0006/0007 then the staged SQL twice left 26 OEWN senses on 26 lexemes.
- Next action: review additional NGSL word/sense pairs into a TSV, regenerate the staged SQL, then plan a new migration/import operation after checking live migration state and visible OEWN attribution. Keep `0005`–`0008` unchanged; no production import has been run here.
