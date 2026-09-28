# Learning flow recovery bugfix and UI follow-up

- Branch: `bugfix/learning-flow-recovery`, based on fetched `origin/main` at `d53a819c9a76203ff9b571553da8e6a2552b824a`; no upstream movement was found during this task.
- Root cause: learning routes reused the shared React Query cache before a new server read completed, while one-word completion/cursor writes were detached and could race route changes or refreshes. Session-backed memorize/sentence state had the same stale-cache exposure.
- Added one authoritative `useLearningState` query path. It waits for queued writes, always refetches on mount, and gates restoration until that fetch completes. Word completion now waits for the attempt and next cursor; a sessionStorage retry id plus idempotent attempt upsert protects interrupted retries. Sentence/memorize writes use the same ordered queue.
- Error semantics now share one rule keyed by `bookId + word`: a real incorrect recall/selection or typo-bearing attempt adds the word to wrong; trouble requires at least two distinct non-skip, non-mistouch attempt IDs. Stats and AI context use the same inputs. Mistouch remains stored but is absent from review tabs/sidebar.
- UI follow-up: `BookPicker` is shared across word spelling, memorize, and sentence spelling. The selected chip remains the current book control; redundant “当前词书” labels and the missing-meaning explanation were removed. Learning state recovery, spelling-only adaptation, and wrong/trouble rules were not changed.
- Scroll trace: local Chromium on the Vite dev app, 1265×500 viewport, 1114px home page, seven wheel inputs. After closing the unauthenticated sign-in overlay: 41 drawn frames, 0 dropped frames, 0 `ScrollJankV4` events marked janky, no renderer `RunTask` over 50ms; cumulative script/layout/style/paint were 2.8/0.6/8.9/18.9ms. With the overlay open, one run had 5 dropped-frame events but still no janky-scroll flag or long task and raster work was similar; this does not establish that the blur caused the user's reported Preview issue. The README live URL currently returns “Project not found”. No CSS or AppShell changes were made without a reproducible bottleneck. The in-app browser cannot drag the native scrollbar outside its content viewport; wheel scrolling was exercised to the page bottom and back.
- Validation observed: `npm test` 38/38 passed; `npx tsc --noEmit` passed; production build passed; targeted ESLint passed with the repository's existing Prettier rule disabled; changed test and shared component pass Prettier. Build emits existing `inputValidator()` deprecation notices. No migration or OEWN staging files changed; no production database connection or SQL was used.
- UI follow-up was pushed as `90c5742`. If the stutter remains in Lovable Preview, profile it using a working Preview URL; the local trace does not justify a performance CSS change.

---

# Server-side learning checkpoints

- Branch: `feat/core-learning-flow-integrity`; implementation commit `5d70038` has been pushed to origin. No merge to `main` has occurred.
- Current design reuses `book_progress`, keyed by `(user_id, book_id, mode)`. Migration `0009` adds `mode` (legacy rows default to `word`), JSONB `session_state`, and optimistic `revision`; RLS remains per user.
- Sentence checkpoints store the queue cursor, active word, queue length, and server-generated attempt UUID. Completion/skip insert that fixed attempt ID before advancing the checkpoint, so a retry after a lost response cannot duplicate stats. The browser cursor is only a bootstrap/fallback cache.
- Memorize checkpoints store the selected batch, absolute positions, phase, item, spelling mode, counters, and a server-generated UUID for each word/stage. A revision compare-and-swap advances the phase after an idempotent attempt insert; mastery remains keyed by `(user_id, book_id, word)` and uses upserted flags.
- Implementation complete: shared parsers/transitions, sentence and memorize server functions, route wiring, Supabase types, migration journal, and regression coverage are in place. Legacy sentence localStorage is used only when no server cursor exists; legacy book cursor becomes the first memorize cursor.
- Final validation: `npm test` 32/32 passed; `npx tsc --noEmit` passed; `npm run build` passed; targeted ESLint on changed learning code passed; `git diff --check` passed. Build reports existing TanStack `inputValidator()` deprecation notices.
- Repository-wide `npm run lint` was attempted and emits thousands of Prettier CRLF errors across untouched files on this Windows checkout. Changed learning modules lint clean; generated Supabase types and the two minimally changed legacy cursor call sites are excluded from targeted Prettier validation because their checked-out CRLF baseline triggers the same rule.
- Constraints: no production connection/SQL, no edits to `ops/oewn-2025-ngsl/**`, no edits to migrations `0000–0008`, preserve current UI/layout, then commit and push this branch.
- Deployment prerequisite at the time of this checkpoint was migration `0009_book_progress_modes_and_sessions.sql`; the user later confirmed production 0009 succeeded before this task. No production database SQL was run in this bugfix. The latest build-generated `src/routeTree.gen.ts` output was restored; no generated route changes are intended.

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
