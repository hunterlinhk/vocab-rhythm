# Core learning flow integrity

- Base: latest fetched `main` at `46d36a6596781a69561de77e4afd0c14329b3756`; branch `feat/core-learning-flow-integrity`.
- Fixed learning aggregation to retain `book_id + word` identity, keep the newest wrong-attempt translation, and count a recall answer as clean only when correct. Skips stay out of study counts; mistouches are excluded from typo totals.
- Sentence spelling now starts from the selected book and restores a per-book browser cursor. Word completion saves the next cursor immediately; memorize batches advance the shared per-book cursor after completion.
- Memorize always reaches the spelling round after recall (including a wrong recall answer), counts mastery only when all three flags are complete, and checks persistence errors with compensating attempt deletion if mastery upsert fails.
- Regression suite: 29/29 tests passed; `npx tsc --noEmit` passed; `npm run build` passed. Targeted ESLint passed with the repository's pre-existing Prettier rule disabled.
- Constraints kept: no database SQL, no edits to `ops/oewn-2025-ngsl/**`, no edits to migrations `0000–0008`, no visual/layout changes.
- Completed and pushed implementation commit `a8a93d8044d9707cfb7fe499230068dde168d27a` to `origin/feat/core-learning-flow-integrity`; worktree was clean after push. Do not merge into `main` unless requested.

---

# OEWN Lovable Cloud import preparation

- Base: latest fetched `main` at `421eacc`; work is on `feat/oewn-lovable-staging-import`.
- Production database was not contacted. Migrations `0000–0008` are unchanged.
- Replaced the 3.2 MB production SQL artifact with a generated 15-file Lovable pack: setup, ten retryable staging files (1,000 rows per statement; files <360 KB), validation including the exact approved pilot sense IDs, one-statement final apply, read-only verification, guarded cleanup, and per-file SHA-256 manifest.
- Staging is isolated in non-public `oewn_stage_2025`; public upserts happen only inside the final atomic `DO` statement. Counts target 2,742 lexemes / 19,028 senses / 26 priority-100 pilot / 19,002 priority-0 senses.
- Repeated PGlite simulation against migrations `0006–0008` and the 26-row pilot passed: partial batch failure and retry, repeated batch execution without duplicates, public-table isolation during staging, exact counts/provenance/pilot-key validation, guarded early-cleanup refusal, injected final-apply failure with full rollback of source/lexeme/sense writes, final apply twice, read-only verification, and successful cleanup.
- Validation: `npm test` 25/25 passed; `npx tsc --noEmit` passed; `npm run build` passed; targeted ESLint for changed JS files passed. Repository-wide `npm run lint` reports thousands of pre-existing CRLF/Prettier errors across untouched files.
- No production import is authorized or needed in this task.
