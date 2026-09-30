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
import {
  bookIdForReviewScope,
  reviewScopeForBook,
  type ReviewScopeKey,
} from "@/lib/review-scope.shared";
import {
  findMissingHistoricalReviewStateIdentities,
  type HistoricalReviewStateRepairIdentity,
} from "@/lib/review-state-repair.shared";

type Client = SupabaseClient<Database>;
type WordIdentity = { userId: string; wordKey: string; reviewMode: ReviewMode };
// Review state is keyed by normalized word + mode + selected scope; book id remains provenance in shared mode.
type Identity = WordIdentity & { scopeKey: ReviewScopeKey };
type RebuildIdentity = WordIdentity & { scopeKey?: ReviewScopeKey };
type SessionIdentity = WordIdentity & { bookId: string; word: string };
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
    let query = supabase
      .from("review_session_results")
      .select("*")
      .eq("user_id", identity.userId)
      .eq("word_key", identity.wordKey)
      .eq("review_mode", identity.reviewMode)
      .order("completed_at", { ascending: true })
      .order("book_id", { ascending: true })
      .order("session_id", { ascending: true });
    const sourceBookId = bookIdForReviewScope(identity.scopeKey);
    if (sourceBookId) query = query.eq("book_id", sourceBookId);
    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
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
    const scopeBookId = bookIdForReviewScope(identity.scopeKey);
    if (scopeBookId) query = query.eq("book_id", scopeBookId);
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
      : fetchAttempts(
          supabase,
          { ...identity, scopeKey: "shared" },
          { sessionId, sourceBookId: identity.bookId },
        ),
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
      .eq("scope_key", identity.scopeKey)
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

async function shareReviewProgressForUser(supabase: Client, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("share_review_progress")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.share_review_progress ?? true;
}

type RebuildFilter = { bookId?: string; wordKey?: string; reviewMode?: ReviewMode };

async function collectProjectionIdentities(
  supabase: Client,
  userId: string,
  shareAcrossBooks: boolean,
  filter: RebuildFilter = {},
): Promise<Identity[]> {
  const identities = new Map<string, Identity>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = supabase
      .from("review_session_results")
      .select("book_id, word_key, review_mode")
      .eq("user_id", userId)
      .order("word_key", { ascending: true })
      .order("review_mode", { ascending: true })
      .order("book_id", { ascending: true });
    if (filter.bookId) query = query.eq("book_id", filter.bookId);
    if (filter.wordKey) query = query.eq("word_key", filter.wordKey);
    if (filter.reviewMode) query = query.eq("review_mode", filter.reviewMode);
    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (row.review_mode !== "recognition" && row.review_mode !== "spelling") continue;
      const identity: Identity = {
        userId,
        wordKey: row.word_key,
        reviewMode: row.review_mode,
        scopeKey: reviewScopeForBook(row.book_id, shareAcrossBooks),
      };
      identities.set(JSON.stringify([identity.wordKey, identity.reviewMode, identity.scopeKey]), identity);
    }
    if (!data || data.length < PAGE_SIZE) return [...identities.values()];
  }
}

/** Settings writes may enumerate affected sessions; normal review reads never call this history scan. */
export async function rebuildReviewProjectionsForUser(supabase: Client, userId: string): Promise<void> {
  const shareAcrossBooks = await shareReviewProgressForUser(supabase, userId);
  const identities = await collectProjectionIdentities(supabase, userId, shareAcrossBooks);
  for (const identity of identities) await rebuildReviewState(supabase, identity, { refreshSessionResults: false });
}

/** Rebuild only words sourced by this book, replaying their full active-scope history. */
export async function rebuildReviewProjectionsForBook(
  supabase: Client,
  userId: string,
  bookId: string,
): Promise<void> {
  const shareAcrossBooks = await shareReviewProgressForUser(supabase, userId);
  const identities = await collectProjectionIdentities(supabase, userId, shareAcrossBooks, { bookId });
  for (const identity of identities) await rebuildReviewState(supabase, identity, { refreshSessionResults: false });
}

async function fetchBookReviewInclusion(
  supabase: Client,
  userId: string,
  bookIds: string[],
): Promise<Record<string, boolean>> {
  if (bookIds.length === 0) return {};
  const preferences: Record<string, boolean> = {};
  for (let offset = 0; offset < bookIds.length; offset += 100) {
    const { data, error } = await supabase
      .from("user_book_review_settings")
      .select("book_id, include_in_review")
      .eq("user_id", userId)
      .in("book_id", bookIds.slice(offset, offset + 100));
    if (error) throw new Error(error.message);
    for (const row of data ?? []) preferences[row.book_id] = row.include_in_review;
  }
  return preferences;
}

async function rebuildReviewStateOnce(
  supabase: Client,
  identity: Identity,
  refreshSessionResults: boolean,
): Promise<void> {
  const shareAcrossBooks = await shareReviewProgressForUser(supabase, identity.userId);
  if ((identity.scopeKey === "shared") !== shareAcrossBooks) {
    throw new Error("Review scope changed concurrently; retry projection");
  }
  const invalidatedSessions = refreshSessionResults
    ? await rebuildReviewSessionResultsFromAttempts(supabase, identity)
    : [];
  const [sessions, settingResult, stateResult, previousDecisions] = await Promise.all([
    fetchSessions(supabase, identity),
    supabase
      .from("user_settings")
      .select("include_spelling_in_review_first_choice")
      .eq("user_id", identity.userId)
      .maybeSingle(),
    supabase
      .from("review_states")
      .select("revision")
      .eq("user_id", identity.userId)
      .eq("word_key", identity.wordKey)
      .eq("review_mode", identity.reviewMode)
      .eq("scope_key", identity.scopeKey)
      .maybeSingle(),
    fetchLatestDecisions(supabase, identity),
  ]);
  if (settingResult.error) throw new Error(settingResult.error.message);
  if (stateResult.error) throw new Error(stateResult.error.message);

  const firstSpellingPreference = settingResult.data?.include_spelling_in_review_first_choice ?? null;
  const bookInclusionById = await fetchBookReviewInclusion(
    supabase,
    identity.userId,
    [...new Set(sessions.map((session) => session.book_id))],
  );
  const projection = projectReviewScheduleState(
    identity.reviewMode,
    sessions.map(sessionFromRow),
    firstSpellingPreference,
    eventOnlyReviewScheduler,
    { scopeKey: identity.scopeKey, bookInclusionById },
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
        scope_key: identity.scopeKey,
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
      bookInclusionById[invalidated.bookId] === false
        ? false
        : (invalidated.countedForReview ??
          (identity.reviewMode === "spelling" ? firstSpellingPreference : null));
    const inputFingerprint = JSON.stringify({
      schedulerVersion,
      scopeKey: identity.scopeKey,
      sessionId: invalidated.sessionId,
      bookId: invalidated.bookId,
      wordKey: invalidated.wordKey,
      sourceFingerprint: invalidated.sourceFingerprint,
      effectiveInclusion,
      bookIncluded: bookInclusionById[invalidated.bookId] !== false,
      learningDay: invalidated.learningDay,
      invalidated: true,
    });
    if (prior.fingerprint === inputFingerprint) continue;
    const revision = prior.revision + 1;
    const unchangedState = projection.state as unknown as Json;
    const { error } = await supabaseAdmin.from("review_schedule_decisions").insert({
      user_id: identity.userId,
      book_id: invalidated.bookId,
      scope_key: identity.scopeKey,
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
      .eq("scope_key", identity.scopeKey)
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
    // Provenance only; 0013 permits bundled and deleted source book ids.
    source_book_id: lastIncluded.session.bookId,
    word: lastIncluded.session.word,
    word_key: identity.wordKey,
    review_mode: identity.reviewMode,
    scope_key: identity.scopeKey,
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
    .eq("scope_key", identity.scopeKey)
    .eq("revision", stateResult.data.revision)
    .select("revision")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Review state changed concurrently; retry projection");
}

export async function rebuildReviewState(
  supabase: Client,
  identity: RebuildIdentity,
  options: { refreshSessionResults?: boolean } = {},
): Promise<void> {
  const scopes = identity.scopeKey
    ? [{ ...identity, scopeKey: identity.scopeKey }]
    : await collectProjectionIdentities(
        supabase,
        identity.userId,
        await shareReviewProgressForUser(supabase, identity.userId),
        { wordKey: identity.wordKey, reviewMode: identity.reviewMode },
      );
  for (const scopedIdentity of scopes) {
    for (let retry = 0; retry < 6; retry += 1) {
      try {
        await rebuildReviewStateOnce(supabase, scopedIdentity, options.refreshSessionResults ?? true);
        break;
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("changed concurrently")) throw error;
        if (retry === 5) throw new Error("Review state changed concurrently; retry the learning attempt");
      }
    }
  }
}

export async function finalizeReviewSession(
  supabase: Client,
  source: SessionInput,
  sessionId: string,
): Promise<void> {
  const wordKey = normalizeReviewWord(source.word);
  if (!wordKey) throw new Error("A review word must contain non-whitespace characters");
  const identity = { userId: source.userId, wordKey, reviewMode: source.reviewMode };
  await persistSessionResultFromAttempts(
    supabase,
    { ...identity, bookId: source.bookId, word: source.word },
    sessionId,
  );
  // Retry repairs only this current word/session's active scope; source book is not a live-book dependency.
  const shareAcrossBooks = await shareReviewProgressForUser(supabase, source.userId);
  await rebuildReviewState(supabase, {
    ...identity,
    scopeKey: reviewScopeForBook(source.bookId, shareAcrossBooks),
  });
}

export async function rebuildPendingSpellingStates(supabase: Client, userId: string): Promise<void> {
  const identities = new Map<string, Identity>();
  const shareAcrossBooks = await shareReviewProgressForUser(supabase, userId);
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("attempts")
      .select("review_word_key, book_id")
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
      const identity: Identity = {
        userId,
        wordKey: row.review_word_key,
        reviewMode: "spelling",
        scopeKey: reviewScopeForBook(row.book_id, shareAcrossBooks),
      };
      identities.set(JSON.stringify([identity.wordKey, identity.scopeKey]), identity);
    }
    if (!data || data.length < PAGE_SIZE) break;
  }

  for (const identity of identities.values())
    await rebuildReviewState(supabase, identity, { refreshSessionResults: false });
}

export type HistoricalReviewStateRepairPlan = {
  fromInclusive: string;
  untilExclusive: string;
  scannedSessionResults: number;
  affectedUsers: number;
  missingStates: HistoricalReviewStateRepairIdentity[];
};

function normalizeRepairBoundary(value: string, label: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new Error(`${label} must be an ISO timestamp with a timezone`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} is not a valid timestamp`);
  return new Date(milliseconds).toISOString();
}

/**
 * One-off repair for sessions completed inside the explicit 0011-to-0013 incident window.
 * Normal reads never call this; each selected identity is replayed across its complete history.
 */
export async function planMissingReviewStatesInWindow(
  supabase: Client,
  fromInclusive: string,
  untilExclusive: string,
): Promise<HistoricalReviewStateRepairPlan> {
  const from = normalizeRepairBoundary(fromInclusive, "fromInclusive");
  const until = normalizeRepairBoundary(untilExclusive, "untilExclusive");
  if (Date.parse(from) >= Date.parse(until)) {
    throw new Error("fromInclusive must be earlier than untilExclusive");
  }

  const sessions = await readAllPages((fromRow, toRow) =>
    supabase
      .from("review_session_results")
      .select("user_id, word_key, review_mode, counted_for_review, outcome, completed_at, book_id, session_id")
      .gte("completed_at", from)
      .lt("completed_at", until)
      .order("completed_at", { ascending: true })
      .order("user_id", { ascending: true })
      .order("word_key", { ascending: true })
      .order("review_mode", { ascending: true })
      .order("book_id", { ascending: true })
      .order("session_id", { ascending: true })
      .range(fromRow, toRow),
  );
  const candidateSessions = sessions.filter(
    (session) =>
      session.outcome !== null &&
      (session.counted_for_review === true ||
        (session.review_mode === "spelling" && session.counted_for_review === null)),
  );

  const candidateUsers = [...new Set(candidateSessions.map((session) => session.user_id))];
  const spellingPreferences: Array<{
    user_id: string;
    include_spelling_in_review_first_choice: boolean | null;
    share_review_progress: boolean | null;
  }> = [];
  for (let offset = 0; offset < candidateUsers.length; offset += 100) {
    const userIds = candidateUsers.slice(offset, offset + 100);
    const { data, error } = await supabase
      .from("user_settings")
      .select("user_id, include_spelling_in_review_first_choice, share_review_progress")
      .in("user_id", userIds);
    if (error) throw new Error(error.message);
    spellingPreferences.push(...(data ?? []));
  }

  const booksByUser = new Map<string, Set<string>>();
  for (const session of candidateSessions) {
    const books = booksByUser.get(session.user_id) ?? new Set<string>();
    books.add(session.book_id);
    booksByUser.set(session.user_id, books);
  }
  const bookPreferences: Array<{ user_id: string; book_id: string; include_in_review: boolean }> = [];
  for (const [userId, bookSet] of booksByUser) {
    const bookIds = [...bookSet];
    for (let offset = 0; offset < bookIds.length; offset += 100) {
      const { data, error } = await supabase
        .from("user_book_review_settings")
        .select("user_id, book_id, include_in_review")
        .eq("user_id", userId)
        .in("book_id", bookIds.slice(offset, offset + 100));
      if (error) throw new Error(error.message);
      bookPreferences.push(...(data ?? []));
    }
  }

  const wordKeysByUser = new Map<string, Set<string>>();
  for (const session of candidateSessions) {
    if (session.review_mode !== "recognition" && session.review_mode !== "spelling") continue;
    const keys = wordKeysByUser.get(session.user_id) ?? new Set<string>();
    keys.add(session.word_key);
    wordKeysByUser.set(session.user_id, keys);
  }

  const existingStates: Array<{ user_id: string; word_key: string; review_mode: string; scope_key: string }> = [];
  for (const [userId, wordKeys] of wordKeysByUser) {
    const keys = [...wordKeys];
    for (let offset = 0; offset < keys.length; offset += 100) {
      const { data, error } = await supabase
        .from("review_states")
        .select("user_id, word_key, review_mode, scope_key")
        .eq("user_id", userId)
        .in("word_key", keys.slice(offset, offset + 100));
      if (error) throw new Error(error.message);
      existingStates.push(...(data ?? []));
    }
  }

  const missingStates = findMissingHistoricalReviewStateIdentities(
    candidateSessions,
    existingStates,
    spellingPreferences,
    bookPreferences,
  );
  return {
    fromInclusive: from,
    untilExclusive: until,
    scannedSessionResults: sessions.length,
    affectedUsers: new Set(missingStates.map((identity) => identity.userId)).size,
    missingStates,
  };
}

export async function applyMissingReviewStateRepairs(
  supabase: Client,
  identities: HistoricalReviewStateRepairIdentity[],
): Promise<number> {
  let repaired = 0;
  for (const identity of identities) {
    await rebuildReviewState(supabase, identity);
    repaired += 1;
  }
  return repaired;
}

async function readAllPages<T>(
  queryPage: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await queryPage(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}
