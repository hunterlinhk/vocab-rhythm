# OEWN Lovable Cloud import preparation

- Base: latest fetched `main` at `421eacc`; work is on `feat/oewn-lovable-staging-import`.
- Production database was not contacted. Migrations `0000–0008` are unchanged.
- Replaced the 3.2 MB production SQL artifact with a generated 15-file Lovable pack: setup, ten retryable staging files (1,000 rows per statement; files <360 KB), validation including the exact approved pilot sense IDs, one-statement final apply, read-only verification, guarded cleanup, and per-file SHA-256 manifest.
- Staging is isolated in non-public `oewn_stage_2025`; public upserts happen only inside the final atomic `DO` statement. Counts target 2,742 lexemes / 19,028 senses / 26 priority-100 pilot / 19,002 priority-0 senses.
- PGlite simulation against migrations `0006–0008` and the 26-row pilot passed: partial batch failure and retry, repeated batch execution, validation, final apply twice, verification, and cleanup.
- Validation: `npm test` 25/25 passed; `npx tsc --noEmit` passed; `npm run build` passed; targeted ESLint for changed JS files passed. Repository-wide `npm run lint` reports thousands of pre-existing CRLF/Prettier errors across untouched files.
- No production import is authorized or needed in this task.
