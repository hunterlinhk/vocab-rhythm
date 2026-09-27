# Server-side learning checkpoints

- Branch: `feat/core-learning-flow-integrity`; implementation commit `5d70038` has been pushed to origin. No merge to `main` has occurred.
- Current design reuses `book_progress`, keyed by `(user_id, book_id, mode)`. Migration `0009` adds `mode` (legacy rows default to `word`), JSONB `session_state`, and optimistic `revision`; RLS remains per user.
- Sentence checkpoints store the queue cursor, active word, queue length, and server-generated attempt UUID. Completion/skip insert that fixed attempt ID before advancing the checkpoint, so a retry after a lost response cannot duplicate stats. The browser cursor is only a bootstrap/fallback cache.
- Memorize checkpoints store the selected batch, absolute positions, phase, item, spelling mode, counters, and a server-generated UUID for each word/stage. A revision compare-and-swap advances the phase after an idempotent attempt insert; mastery remains keyed by `(user_id, book_id, word)` and uses upserted flags.
- Implementation complete: shared parsers/transitions, sentence and memorize server functions, route wiring, Supabase types, migration journal, and regression coverage are in place. Legacy sentence localStorage is used only when no server cursor exists; legacy book cursor becomes the first memorize cursor.
- Final validation: `npm test` 32/32 passed; `npx tsc --noEmit` passed; `npm run build` passed; targeted ESLint on changed learning code passed; `git diff --check` passed. Build reports existing TanStack `inputValidator()` deprecation notices.
- Repository-wide `npm run lint` was attempted and emits thousands of Prettier CRLF errors across untouched files on this Windows checkout. Changed learning modules lint clean; generated Supabase types and the two minimally changed legacy cursor call sites are excluded from targeted Prettier validation because their checked-out CRLF baseline triggers the same rule.
- Constraints: no production connection/SQL, no edits to `ops/oewn-2025-ngsl/**`, no edits to migrations `0000–0008`, preserve current UI/layout, then commit and push this branch.
- Deployment prerequisite: apply migration `0009_book_progress_modes_and_sessions.sql` before deploying code that reads/writes the new `(user_id, book_id, mode)` key. It has not been applied to any production database. The latest build-generated `src/routeTree.gen.ts` output was restored; no generated route changes are intended.

---

# Core learning flow integrity (previous checkpoint)

- Fixed learning aggregation to retain `book_id + word` identity, keep the newest wrong-attempt translation, and count a recall answer as clean only when correct. Skips stay out of study counts; mistouches are excluded from typo totals.
- Memorize always reaches the spelling round after recall (including a wrong recall answer), and counts mastery only when all three flags are complete.
- Implementation commit `a8a93d8044d9707cfb7fe499230068dde168d27a`; later checkpoint commit `46901d3720d620a479b59c3e9cfd063aeff12913`. Both are on `feat/core-learning-flow-integrity`.

---

# OEWN Lovable Cloud import preparation

- Base: latest fetched `main` at `421eacc`; work is on `feat/oewn-lovable-staging-import`.
- Production database was not contacted. Migrations `0000–0008` are unchanged.
- Replaced the 3.2 MB production SQL artifact with a generated 15-file Lovable pack: setup, ten retryable staging files (1,000 rows per statement; files <360 KB), validation including the exact approved pilot sense IDs, one-statement final apply, read-only verification, guarded cleanup, and per-file SHA-256 manifest.
- Staging is isolated in non-public `oewn_stage_2025`; public upserts happen only inside the final atomic `DO` statement. Counts target 2,742 lexemes / 19,028 senses / 26 priority-100 pilot / 19,002 priority-0 senses.
- Repeated PGlite simulation against migrations `0006–0008` and the 26-row pilot passed: partial batch failure and retry, repeated batch execution without duplicates, public-table isolation during staging, exact counts/provenance/pilot-key validation, guarded early-cleanup refusal, injected final-apply failure with full rollback of source/lexeme/sense writes, final apply twice, read-only verification, and successful cleanup.
- Validation: `npm test` 25/25 passed; `npx tsc --noEmit` passed; `npm run build` passed; targeted ESLint for changed JS files passed. Repository-wide `npm run lint` reports thousands of pre-existing CRLF/Prettier errors across untouched files.
- No production import is authorized or needed in this task.
