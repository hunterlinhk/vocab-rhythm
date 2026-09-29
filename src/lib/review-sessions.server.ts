import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
// Use this service client only for mutations; all projection reads stay under the authenticated RLS client.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  aggregateReviewSession,
  normalizeReviewWord,
  eventOnlyReviewScheduler,
  reviewSessionSource,
  projectReviewScheduleState,
  type ReviewAttemptEvent,
  type ReviewMode,
  type ReviewScheduleState,
  type ReviewSessionSource,
  type ReviewSessionResult,
} from "@/lib/review-scheduler.shared";

type Client = SupabaseClient<Database>;
type Identity = { userId: string; wordKey: string; reviewMode: ReviewMode };
type SessionIdentity = Identity & { bookId: string; word: string };
type SessionInput = { userId: string; bookId: string; word: string; reviewMode: ReviewMode };
type SessionRow = Database["public"]["Tables"]["review_session_results"]["Row"];
const PAGE_SIZE = 500;

function sessionIdentityKey(bookId: string, sessionId: string): string {
  return JSON.stringify([bookId, sessionId]);
}

function sessionFromRow(row: SessionRow): ReviewSessionResult {
  return {
    sessionId: row.session_id,
    bookId: row.book_id,
    word: row.word,
    wordKey: row.word_key,
    reviewMode: row.review_mode as ReviewMode,
    outcome: row.outcome as ReviewSessionResult["outcome"],
    countedForReview: row.counted_for_review,
    finalCorrect: row.final_correct,
    hadRealError: row.had_real_error,
    realWrongCount: row.real_wrong_count,
    usedHint: row.used_hint,
    hintCount: row.hint_count,
    attemptCount: row.attempt_count,
    validAttemptCount: row.valid_attempt_count,
    lastAttemptId: row.last_attempt_id,
    completedAt: row.completed_at,
    timeZone: row.time_zone,
    learningDay: row.learning_day,
    sourceFingerprint: row.source_fingerprint,
  };
}

async function fetchSessions(supabase: Client, identity: Identity): Promise<SessionRow[]> {
  const rows: SessionRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("review_session_results")
      .select("*")
      .eq("user_id", identity.userId)
      .eq("word_key", identity.wordKey)
      .eq("review_mode", identity.reviewMode)
      .order("completed_at", { ascending: true })
      .order("book_id", { ascending: true })
      .order("session_id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

async function fetchAttempts(
  supabase: Client,
  identity: Identity,
  filters: { sessionId?: string; sourceBookId?: string } = {},
): Promise<ReviewAttemptEvent[]> {
  const rows: ReviewAttemptEvent[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = supabase
      .from("attempts")
      .select(
        "id, book_id, word, review_word_key, review_session_id, review_mode, session_stage, counted_for_review, correct, skipped, hint_count, typo_count, mistouch, duration_ms, time_zone, created_at",
      )
      .eq("user_id", identity.userId)
      .eq("review_word_key", identity.wordKey)
      .eq("review_mode", identity.reviewMode)
      .not("review_session_id", "is", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (filters.sourceBookId) query = query.eq("book_id", filters.sourceBookId);
    if (filters.sessionId) query = query.eq("review_session_id", filters.sessionId);
    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as ReviewAttemptEvent[]));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

async function persistSessionResultFromAttempts(
  supabase: Client,
  identity: SessionIdentity,
  sessionId: string,
  attempts?: ReviewAttemptEvent[],
): Promise<void> {
  const [sessionAttempts, existingResult] = await Promise.all([
    attempts
      ? Promise.resolve(attempts)
      : fetchAttempts(supabase, identity, { sessionId, sourceBookId: identity.bookId }),
    supabase
      .from("review_session_results")
      .select("completed_at, time_zone, learning_day, source_fingerprint, revision")
      .eq("user_id", identity.userId)
      .eq("book_id", identity.bookId)
      .eq("word_key", identity.wordKey)
      .eq("review_mode", identity.reviewMode)
      .eq("session_id", sessionId)
      .maybeSingle(),
  ]);
  if (existingResult.error) throw new Error(existingResult.error.message);

  const existing = existingResult.data;
  const persisted = existing
    ? {
        completedAt: existing.completed_at,
        timeZone: existing.time_zone,
        learningDay: existing.learning_day,
      }
    : undefined;
  const result = aggregateReviewSession(identity.reviewMode, sessionAttempts, persisted);
  if (!result) {
    if (!existing) return;
    const { error } = await supabaseAdmin
      .from("review_session_results")
      .delete()
      .eq("user_id", identity.userId)
      .eq("book_id", identity.bookId)
      .eq("word_key", identity.wordKey)
      .eq("review_mode", identity.reviewMode)
      .eq("session_id", sessionId);
    if (error) throw new Error(error.message);
    return;
  }
  const changed = existing?.source_fingerprint !== result.sourceFingerprint;
  if (existing && !changed) return;

  const { error } = await supabaseAdmin.from("review_session_results").upsert(
    {
      user_id: identity.userId,
      book_id: result.bookId,
      word: result.word,
      word_key: result.wordKey,
      review_mode: identity.reviewMode,
      session_id: sessionId,
      outcome: result.outcome,
      counted_for_review: result.countedForReview,
      final_correct: result.finalCorrect,
      had_real_error: result.hadRealError,
      real_wrong_count: result.realWrongCount,
      used_hint: result.usedHint,
      hint_count: result.hintCount,
      attempt_count: result.attemptCount,
      valid_attempt_count: result.validAttemptCount,
      last_attempt_id: result.lastAttemptId,
      completed_at: result.completedAt,
      time_zone: result.timeZone,
      learning_day: result.learningDay,
      source_fingerprint: result.sourceFingerprint,
      revision: existing ? existing.revision + 1 : 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,book_id,word_key,review_mode,session_id" },
  );
  if (error) throw new Error(error.message);
}

/** Recreate closed per-word sessions from raw attempts before replaying decisions. */
async function rebuildReviewSessionResultsFromAttempts(
  supabase: Client,
  identity: Identity,
): Promise<ReviewSessionSource[]> {
  const attempts = await fetchAttempts(supabase, identity);
  const bySession = new Map<string, ReviewAttemptEvent[]>();
  for (const attempt of attempts) {
    const sessionId = attempt.review_session_id;
    if (!sessionId) continue;
    const key = sessionIdentityKey(attempt.book_id, sessionId);
    const group = bySession.get(key) ?? [];
    group.push(attempt);
    bySession.set(key, group);
  }

  const invalidated: ReviewSessionSource[] = [];
  for (const group of bySession.values()) {
    const sessionId = group[0]?.review_session_id;
    if (!sessionId) continue;
    const completed =
      identity.reviewMode === "spelling"
        ? group.some((attempt) => attempt.session_stage === "word_spelling" && !attempt.skipped)
        : group.some((attempt) => attempt.session_stage === "recall" && !attempt.skipped);
    if (!completed) continue;
    const result = aggregateReviewSession(identity.reviewMode, group);
    const sourceBookId = group[0]?.book_id;
    const sourceWord = group[0]?.word;
    if (!sourceBookId || !sourceWord || group.some((attempt) => attempt.book_id !== sourceBookId))
      throw new Error("A review session cannot span source books");
    await persistSessionResultFromAttempts(
      supabase,
      { ...identity, bookId: sourceBookId, word: sourceWord },
      sessionId,
      group,
    );
    if (!result) {
      const source = reviewSessionSource(identity.reviewMode, group);
      if (source) invalidated.push(source);
    }
  }
  return invalidated;
}

async function fetchLatestDecisions(
  supabase: Client,
  identity: Identity,
): Promise<Map<string, { revision: number; fingerprint: string; decisionId: string }>> {
  const latest = new Map<string, { revision: number; fingerprint: string; decisionId: string }>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("review_schedule_decisions")
      .select("book_id, session_id, decision_revision, input_fingerprint, decision_id")
      .eq("user_id", identity.userId)
      .eq("word_key", identity.wordKey)
      .eq("review_mode", identity.reviewMode)
      .order("decision_revision", { ascending: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const key = sessionIdentityKey(row.book_id, row.session_id);
      if (!latest.has(key))
        latest.set(key, {
          revision: row.decision_revision,
          fingerprint: row.input_fingerprint,
          decisionId: row.decision_id,
        });
    }
    if (!data || data.length < PAGE_SIZE) return latest;
  }
}

async function rebuildReviewStateOnce(supabase: Client, identity: Identity): Promise<void> {
  const invalidatedSessions = await rebuildReviewSessionResultsFromAttempts(supabase, identity);
  const [sessions, settingResult, stateResult, previousDecisions] = await Promise.all([
    fetchSessions(supabase, identity),
    identity.reviewMode === "spelling"
      ? supabase
          .from("user_settings")
          .select("include_spelling_in_review, include_spelling_in_review_first_choice")
          .eq("user_id", identity.userId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("review_states")
      .select("revision, source_book_id")
      .eq("user_id", identity.userId)
      .eq("word_key", identity.wordKey)
      .eq("review_mode", identity.reviewMode)
      .maybeSingle(),
    fetchLatestDecisions(supabase, identity),
  ]);
  if (settingResult.error) throw new Error(settingResult.error.message);
  if (stateResult.error) throw new Error(stateResult.error.message);

  const firstSpellingPreference = settingResult.data?.include_spelling_in_review_first_choice ?? null;
  const projection = projectReviewScheduleState(
    identity.reviewMode,
    sessions.map(sessionFromRow),
    firstSpellingPreference,
  );
  const decisionIds = new Map(previousDecisions);

  for (const decision of projection.decisions) {
    const decisionKey = sessionIdentityKey(decision.session.bookId, decision.session.sessionId);
    const prior = previousDecisions.get(decisionKey);
    if (prior?.fingerprint === decision.inputFingerprint) continue;
    const revision = (prior?.revision ?? -1) + 1;
    const { data, error } = await supabaseAdmin
      .from("review_schedule_decisions")
      .insert({
        user_id: identity.userId,
        book_id: decision.session.bookId,
        word: decision.session.word,
        word_key: decision.session.wordKey,
        review_mode: identity.reviewMode,
        session_id: decision.session.sessionId,
        decision_revision: revision,
        supersedes_decision_id: prior?.decisionId ?? null,
        learning_day: decision.session.learningDay,
        session_outcome: decision.session.outcome,
        effective_inclusion: decision.effectiveInclusion,
        is_initial_learning: decision.isInitialLearning,
        state_advanced: decision.stateAdvanced,
        interval_advanced: decision.intervalAdvanced,
        schedule_action: decision.action,
        decision_reason: decision.reason,
        scheduler_version: decision.schedulerVersion,
        input_fingerprint: decision.inputFingerprint,
        before_state: decision.beforeState as unknown as Json,
        after_state: decision.afterState as unknown as Json,
      })
      .select("decision_id")
      .single();
    if (error?.code === "23505") throw new Error("Review decisions changed concurrently; retry projection");
    if (error) throw new Error(error.message);
    decisionIds.set(decisionKey, {
      revision,
      fingerprint: decision.inputFingerprint,
      decisionId: data.decision_id,
    });
  }

  const schedulerVersion = eventOnlyReviewScheduler.version;
  for (const invalidated of invalidatedSessions) {
    const decisionKey = sessionIdentityKey(invalidated.bookId, invalidated.sessionId);
    const prior = previousDecisions.get(decisionKey);
    if (!prior) continue;
    const effectiveInclusion =
      invalidated.countedForReview ??
      (identity.reviewMode === "spelling" ? firstSpellingPreference : null);
    const inputFingerprint = JSON.stringify({
      schedulerVersion,
      sessionId: invalidated.sessionId,
      bookId: invalidated.bookId,
      wordKey: invalidated.wordKey,
      sourceFingerprint: invalidated.sourceFingerprint,
      effectiveInclusion,
      learningDay: invalidated.learningDay,
      invalidated: true,
    });
    if (prior.fingerprint === inputFingerprint) continue;
    const revision = prior.revision + 1;
    const unchangedState = projection.state as unknown as Json;
    const { error } = await supabaseAdmin.from("review_schedule_decisions").insert({
      user_id: identity.userId,
      book_id: invalidated.bookId,
      word: invalidated.word,
      word_key: invalidated.wordKey,
      review_mode: identity.reviewMode,
      session_id: invalidated.sessionId,
      decision_revision: revision,
      supersedes_decision_id: prior.decisionId,
      learning_day: invalidated.learningDay,
      session_outcome: null,
      effective_inclusion: effectiveInclusion,
      is_initial_learning: false,
      state_advanced: false,
      interval_advanced: false,
      schedule_action: "none",
      decision_reason: "no_valid_attempts",
      scheduler_version: schedulerVersion,
      input_fingerprint: inputFingerprint,
      before_state: unchangedState,
      after_state: unchangedState,
    });
    if (error?.code === "23505") throw new Error("Review decisions changed concurrently; retry projection");
    if (error) throw new Error(error.message);
  }

  const hasIncludedResult = projection.decisions.some(
    (decision) => decision.effectiveInclusion === true && decision.session.outcome !== null,
  );
  if (!hasIncludedResult) {
    if (!stateResult.data) return;
    const { data, error } = await supabaseAdmin
      .from("review_states")
      .delete()
      .eq("user_id", identity.userId)
      .eq("word_key", identity.wordKey)
      .eq("review_mode", identity.reviewMode)
      .eq("revision", stateResult.data.revision)
      .select("revision")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Review state changed concurrently; retry projection");
    return;
  }

  const lastIncluded = [...projection.decisions]
    .reverse()
    .find((decision) => decision.effectiveInclusion === true && decision.session.outcome !== null)!;
  const lastDecisionId =
    decisionIds.get(sessionIdentityKey(lastIncluded.session.bookId, lastIncluded.session.sessionId))?.decisionId ?? null;
  const state: ReviewScheduleState = projection.state;
  const stateRow = {
    user_id: identity.userId,
    source_book_id: lastIncluded.session.bookId,
    word: lastIncluded.session.word,
    word_key: identity.wordKey,
    review_mode: identity.reviewMode,
    last_reviewed_at: state.lastReviewedAt,
    next_due_at: state.nextDueAt,
    interval_seconds: state.intervalSeconds,
    consecutive_correct: state.consecutiveCorrect,
    total_wrong: state.totalWrong,
    hint_count: state.hintCount,
    difficulty: state.difficulty,
    scheduler_data: state.schedulerData,
    last_attempt_id: state.lastAttemptId,
    last_session_id: state.lastSessionId,
    last_learning_day: state.lastLearningDay,
    successful_growth_day: state.successfulGrowthDay,
    pending_action: state.pendingAction,
    last_outcome: state.lastOutcome,
    last_decision_reason: state.lastDecisionReason,
    scheduler_version: state.schedulerVersion,
    last_decision_id: lastDecisionId,
    updated_at: new Date().toISOString(),
  };

  if (!stateResult.data) {
    const { error } = await supabaseAdmin.from("review_states").insert({ ...stateRow, revision: 0 });
    if (error?.code === "23505") throw new Error("Review state changed concurrently; retry projection");
    if (error) throw new Error(error.message);
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("review_states")
    .update({ ...stateRow, revision: stateResult.data.revision + 1 })
    .eq("user_id", identity.userId)
    .eq("word_key", identity.wordKey)
    .eq("review_mode", identity.reviewMode)
    .eq("revision", stateResult.data.revision)
    .select("revision")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Review state changed concurrently; retry projection");
}

export async function rebuildReviewState(supabase: Client, identity: Identity): Promise<void> {
  for (let retry = 0; retry < 6; retry += 1) {
    try {
      await rebuildReviewStateOnce(supabase, identity);
      return;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("changed concurrently")) throw error;
    }
  }
  throw new Error("Review state changed concurrently; retry the learning attempt");
}

export async function finalizeReviewSession(
  supabase: Client,
  source: SessionInput,
  sessionId: string,
): Promise<void> {
  const wordKey = normalizeReviewWord(source.word);
  if (!wordKey) throw new Error("A review word must contain non-whitespace characters");
  const identity: Identity = { userId: source.userId, wordKey, reviewMode: source.reviewMode };
  await persistSessionResultFromAttempts(
    supabase,
    { ...identity, bookId: source.bookId, word: source.word },
    sessionId,
  );
  await rebuildReviewState(supabase, identity);
}

export async function rebuildPendingSpellingStates(supabase: Client, userId: string): Promise<void> {
  const identities = new Map<string, Identity>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("attempts")
      .select("review_word_key")
      .eq("user_id", userId)
      .eq("mode", "word")
      .eq("review_mode", "spelling")
      .is("counted_for_review", null)
      .eq("skipped", false)
      .order("review_word_key", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (row.review_word_key === null) {
        throw new Error("Attempt is missing its generated review word key");
      }
      identities.set(row.review_word_key, { userId, wordKey: row.review_word_key, reviewMode: "spelling" });
    }
    if (!data || data.length < PAGE_SIZE) break;
  }

  for (const identity of identities.values()) await rebuildReviewState(supabase, identity);
}
