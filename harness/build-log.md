# Direct learning entry

- `feat/direct-learning-entry` starts from `origin/main` at `ba33b11c9c1dc743a951b9ae83d16ca5f1104d48`.
- `/` checks the browser session and replaces the route with `/learn` or `/auth`; `/home` redirects to `/learn`. Auth success and confirmation links target `/learn`; sign-out targets `/auth`. The Dashboard is no longer rendered.
- Validation: `npm test` 81/81, `npx tsc --noEmit`, `npm run build`, and `git diff --check` passed. No database or migration changes.

# Full-history learning problems

- `bugfix/full-history-learning-problems` from `main` at `76312251204278c841d9cb665ef845baee325bc5`.
- Wrong/trouble queues use a separate paginated read of real-error attempts. Ordinary `/learn` does not query problem history. The manual "加入错题本" action was removed because it fabricated an error attempt; active saves use "收藏". Normal learning state remains capped at 2,000 attempts and carries no partial problem lists. The existing 60-item queue cap remains.
- The home "待复习" count uses an exact count of due Scheduler states in the active shared/book scope, including recognition and spelling, rather than wrong-word count.
- Attempt writes, mistouch edits, and scope changes invalidate the problem query. Validation: `npm test` 80/80, `npx tsc --noEmit`, `npm run build`, and `git diff --check` passed. No database operation or migration.

# Review problem scope

- Phase: implementation on `feat/review-problem-scope` from clean `origin/main` at `488dd9e457312e42edd34cb1b5acbb69e3a6aed8`.
- Wrong/trouble words and the stats trouble list now group by Review's normalized word and active shared/book scope, without splitting recognition from spelling. A group retains its first real-error book/word/translation as the existing queue entry. Distinct attempt IDs each contribute at most one error; skip and mistouch remain excluded. Book review exclusion does not erase learning-problem history.
- The spelling result's mistake badge uses the same problem key; changing global sharing invalidates both learning-state and stats queries. No schema or scheduler change.
- Validation: `npm test` 75/75, `npx tsc --noEmit`, `npm run build`, and `git diff --check` passed. Diff is scoped to problem aggregation, the settings-dependent stats read/cache, corresponding UI badge, tests, and this log. Next: commit and push. No production database was accessed.

# Scheduler-backed 今日复习

- Phase: implementation on `feat/scheduler-due-review-queue` from `origin/main` at `3c00d4bd1655c24efce829ebf7f11851b8ef4ba5`. No migration or production database operation.
- 今日复习 reads due recognition and spelling states from the scheduler, freezes each visit's queue, and routes to recognition or standalone spelling. Recognition records context and recall under one stable review session without advancing normal memorize progress; spelling explicitly counts the due attempt. The existing wrong/trouble queues are unchanged.
- The due query exposes source-book provenance without requiring a live book row. Missing book entries fall back to a bare entry that Shared Lexicon can hydrate. Active scope and per-book inclusion remain governed by the existing Review projections.
- Follow-up on this branch: removed the outdated Review-page subtitle and use one deterministic option selector for both due recognition and ordinary memorize. When two distinct distractor meanings exist, it returns exactly three distinct options; fewer available meanings remain fewer options. `npm test` passed 72/72, `npx tsc --noEmit` and `npm run build` passed. Next: commit and push; no production database was accessed.

# Review scheduler v1

- Scheduler v1 was merged to `main` at `3c00d4bd1655c24efce829ebf7f11851b8ef4ba5`.
- The existing session projection, scope settings, daily success limit, failure precedence, mistouch replay, and append-only decision revisions remain the authority. No schema change is needed; `interval_seconds`, `next_due_at`, and `scheduler_version` already exist.
- New policy: first successful inclusion 24 hours; failure 10 minutes; later smooth success 2.5× with a 24-hour floor, strained success 1.5× with a 1-hour floor; cap 90 days. Due dates use the persisted session completion timestamp, so full-history replay is deterministic.
- A separate dry-run-first CLI replays existing active-scope states still marked with the foundation scheduler version; it leaves inactive scopes for their next settings-triggered rebuild. Normal due reads do not scan history. Missing states remain covered by the existing bounded historical repair, not this recalibration.
- Validation: `npm test` passed 70/70, `npx tsc --noEmit` passed, `npm run build` passed, CLI `--help` and `node --check` passed, `git diff --check` passed. No production database was accessed; no migration or OEWN files changed.
- Existing foundation states may need the scheduler recalibration CLI before they become due; no database operation was performed in this task.

## Prior Review scope settings

- Merged into main at `cf5ddd4`; migrations 0015 and the Lovable 0016 marker are present. Review identity is `(user_id, normalized word_key, review_mode, scope_key)`; bundled/deleted book ids can remain provenance.
- Settings writes rebuild affected projections; normal due reads use the active scope and do not scan session history. The 0015 SQL was validated in isolated PGlite through the migration/RLS test runner. Older sections below describe their historical checkpoints, not the current deployment state.

## Prior Review repair and provenance work

- bugfix/review-source-book-independence fixed the source-book FK assumption, added one-off historical repair and a regression test adapted to 0014. It is now merged into main. The production dry-run was not run because the local environment lacked SUPABASE_SERVICE_ROLE_KEY; no production data was accessed.
- Migration 0013 removes only review_states.source_book_id FK and preserves provenance. Migration 0014 is the Lovable marker. Both remain unchanged.
# Review system v1 foundation

- Branch: `feat/review-system-v1-foundation`, based on fetched `origin/main` at `e01ef2edcefef861ab73f62be6bca060a3795a84`.
- The review pipeline has three layers: raw `attempts`, per-source-book `review_session_results`, then append-only `review_schedule_decisions` and a rebuildable `review_states` projection keyed by `(user, normalized word, mode)`. `review_word_key` is generated and normalized in JS by trimming, collapsing whitespace, lowercasing, and mapping curly apostrophes to straight apostrophes. `book_id` remains session/decision provenance. `review_states.source_book_id` is set NULL when that word book is deleted; the session and decision `book_id` columns have no FK, so history does not block book deletion. Recognition and spelling remain separate; sentence practice has no review state.
- Mistouch annotations are a permitted post-insert update to raw attempts. Replays rebuild session outcomes and append decision revisions; a session with no remaining valid attempts has no result and does not affect state. Recognition grading uses the final valid answer of each of context and recall, with either round's final wrong answer making the session fail.
- Session grading is `smooth` (all required stage finals correct, no errors or hints), `strained` (all required stage finals correct after an error or hint), `failed` (any required stage final is wrong), or absent when all attempts are skipped/mistouched. A mistouched attempt contributes neither errors nor hints. Memorize recognition uses context/recall only; its third-round spell attempt remains raw. Standalone word spelling owns the independent spelling state; sentence has none.
- Spelling inclusion is tri-state on attempts and settings (unset/include/exclude). The first explicit setting resolves historical unset attempts; later setting changes apply to new attempts, while explicit historical values remain. Attempts use client-stable UUIDs and duplicate IDs are accepted only when the persisted attempt payload matches (mistouch annotation may have changed).
- All three new derived tables enable RLS, revoke table privileges from `PUBLIC`, `anon`, and `authenticated`, then grant `authenticated` SELECT only; their writes use the server-only `supabaseAdmin` service-role client. `attempts` RLS is reaffirmed in 0011, with explicit owner `WITH CHECK` on insert and update. Revisions link through `supersedes_decision_id`; the latest revision per source `(book, session)` is current. An earlier session change replays the complete normalized-word/mode history and adds revisions for every downstream decision whose fingerprint changes.
- The replaceable `ReviewScheduler` stores symbolic decisions only. First included success initializes without interval growth; later successful sessions can grow once per local learning day; each failure resets immediately; a same-day later success cannot undo a failure or consume a second growth. Learning-day dates are user-local with a 04:00 boundary. No interval durations or forgetting-curve parameters are set.
- Legacy attempts remain intact and are not backfilled into review sessions because they lack reliable session boundaries and inclusion choices; v1 scheduling starts with newly recorded sessions. The production attempt count/user count was not queried. Migration `0011_review_system_v1_foundation.sql` remains edited in place and has not been run. Lovable Git sync does not apply migration files; apply through Lovable chat/SQL Editor or an explicitly configured Drizzle migration run. No production database read or write was performed.
- Follow-up validation: `npm test` 54/54 passed; `npx tsc --noEmit`, `npm run build`, and scoped ESLint (with the repository's CRLF-triggered Prettier rule disabled) passed after the security/normalization adjustments. Build reports existing Vite path-resolution and TanStack `inputValidator()` deprecations, plus the existing large-chunk warning. No OEWN staging files changed and no production database was queried or modified.

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
