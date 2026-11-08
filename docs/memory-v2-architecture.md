# Cadence Memory Intelligence v2 (shadow phase)

## Architecture and evidence taxonomy

Source of truth remains \`attempts\`; Review v1 projections (\`review_session_results\`, \`review_states\`, \`review_schedule_decisions\`) remain untouched. \`prompt_visibility\` in migration 0018 is nullable to preserve historical records; it is **never** backfilled. \`masked\` spelling is independent production, \`visible\` is copying, and \`null\` is unknown. Recognition \`session_stage=recall\` is multiple choice, **not** unaided retrieval. No accuracy claim is made for unobserved modalities. Mistouches and skips are excluded; user-excluded books and attempts with \`counted_for_review=false\` do not influence the model.

\`memory-engine.shared.ts\` is deterministic and replayable. Per \`(scope_key, word_key, skill)\` it tracks stability in days, difficulty, last attempt, the number of qualified 24h/7d delayed tests, and predicted success. FSRS-6's learnable-shape decay, anchored at 90% at t=S, is used as a reference; growth/failure transitions are deliberately **not** presented as a full FSRS-6 implementation. Wrong responses, hints, spacing, and spelling response time enter bounded state transitions. A user/skill log-odds offset is updated from previous >=24h tests using an online residual, shrunk toward zero when few observations exist. Recognition and masked spelling calibrate independently.

All evaluation is *prequential*: predict an eligible delayed attempt using the model state **before** learning its result, then update; expose sample size, Brier score, unpersonalized Brier baseline, and log loss. Small samples do not validate accuracy. Bias remains because practice opportunities are selected by the prior scheduler; randomized holdouts or time-based rollout experiments are required for causal learning-efficiency claims. Copying does not create independent-spelling mastery. A seven-day test count is shown separately from shorter delayed tests.

## API and planner

Authenticated TanStack \`getMemorySnapshot({data:{timeZone,timeBudgetMinutes,targetRetention,word?,limit?}})\` returns versioned skill states, uncertainty, forgetting risk, 30-day forecast, next test timestamp, calibration, evidence coverage, and daily action sequence with reason codes. \`word\` can target one word. \`timeBudgetMinutes\` 1..180; \`targetRetention\` 0.75..0.97; \`limit\` 1..500. These bounded per-request overrides allow AI to simulate or adjust **only the current recommendation**, not modify a user's history, v1 scheduling, or settings. The server always derives ownership from verified auth, not input. No model provider is needed. The existing assistant switch is disabled and remains disabled.

Planner prioritizes at-risk known items by estimated forgetting risk per second, recommends diagnostic masked spelling when there has been no qualified delay, and allocates remaining minutes to ordinary new-word practice when the daily goal is incomplete. Task URLs use the existing learning routes. Recognition and spelling of the same word are not both scheduled in one short session. A task URL opens the current v1 mode's queue, not necessarily the exact v2 word; targeted task dispatch is a future rollout gate. No claim is made that the output is globally optimal: measured task times and learning gain must inform future utility estimation.

## Rollout / validation gates

1. Confirm a restorable DB backup and reconcile \`drizzle.__drizzle_migrations\` and the live schema. Lovable Git sync does **not** automatically run SQL migrations.
2. Apply only pending \`0018_memory_evidence_visibility.sql\` via an approved migration process **before** deploying the code. Never replay old non-idempotent migrations into a database with an unverified ledger. Review row counts and RLS before and after. No legacy rows should be rewritten.
3. Ship as read-only **shadow** behind Review v1 scheduling. New \`prompt_visibility\` labels will accrue; old results remain readable, with qualified spelling treated as unknown until new masked attempts occur. The \`/plan\` page may display recommendations; it must not replace v1's due-review queues until gates pass.
4. Run \`npm test\`, \`npm run build\`, \`npm run lint\` in a provisioned local/CI environment with dependencies. Test delayed outcomes, prompts, mistouches, scopes, timestamps, determinism, and capped budgets. Rehearse DB migration/rollback in disposable PostgreSQL.
5. Once each skill has enough *real* delayed observations, compare forward Brier and log loss against unchanged v1/FSRS priors, evaluate calibration buckets (ECE), and stratify by delay, book, mode, and exposure. Require no harmful regression before letting v2 choose actual due dates. Do not interpret synthetic tests as proof of real-user learning gain.

## Research

- FSRS-6: https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm
- Settles & Meeder (ACL 2016), Half-Life Regression: https://research.duolingo.com/papers/settles.acl16.pdf
- Ilídio et al. (PMLR 2026), mixed-effects HLR and context: https://proceedings.mlr.press/v339/ilidio26a.html
- Piech et al. (NIPS 2015), Deep Knowledge Tracing: https://papers.neurips.cc/paper_files/paper/2015/hash/bac9162b47c56fc8a4d2a519803d51b3-Abstract.html
- Schuetze et al. (2025), session-to-session dynamics: https://doi.org/10.1007/s40593-025-00508-3
- Cao et al. (2025), spacing/repetition under time budgets: https://escholarship.org/uc/item/61p4p686
