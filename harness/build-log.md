# Current OEWN production import preparation

- Branch: `feat/oewn-production-import-prep`, based on latest `main` at `3999a99`.
- Decision: deliver a standalone controlled psql data transaction under `ops/oewn-2025-ngsl/`, not a `0009` schema migration. The Shared Lexicon schema is already in `0006–0008`; keeping 19k data rows outside Drizzle prevents schema deployment from auto-running a long import.
- Bundle: generated from pinned OEWN 2025 archive SHA-256 `7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51`. Production SQL is 3.2 MB, batched in 400 rows, single transaction, lock timeout 10s and statement timeout 10m. Guarded rollback keeps 26 reviewed pilot senses and shared lexemes.
- Expected postflight: 2,742 OEWN lexemes, 19,028 senses, 26 priority-100 pilot senses, 19,002 priority-0 senses, one provenance source row. Bundle manifest carries checksums and counts.
- Verification: 26/26 tests pass; generator `--production-bundle --check` passes. PGlite applied 0006/0007, ran production import twice (2,742 lexemes/19,028 senses/26 pilots), then rollback (26 pilot senses remain). No production URL was used.
- Validation: 26/26 tests; TypeScript, production build, scoped ESLint, and bundle `--check` pass. PGlite ran import twice and guarded rollback; final state retained exactly the 26 pilot senses. No production database was contacted; migrations `0000–0008` are unchanged.
- Bundle import SQL SHA-256: `1221665d5d270ac1753d80002bc6fdd2cd2f364a72aa973f3b8154d3d0603432` (3,209,634 bytes). Rollback SQL SHA-256: `eebaebe97e2c9b98ecfdfeaec53d51e7651a3c017d02a745c01c13958e5b7ca0`.
- Remaining: commit and push this feature branch, then verify remote HEAD.
