import type { Json } from "@/integrations/supabase/types";
import { reviewScopeIncludesBook, type ReviewScopeKey } from "./review-scope.shared";

export type ReviewMode = "recognition" | "spelling";
export type ReviewOutcome = "smooth" | "strained" | "failed";
export type ScheduleAction = "initialize" | "grow" | "hold" | "failure_reset_short" | "none";
export type ScheduleReason =
  | "first_learning"
  | "normal_growth"
  | "same_day_repeat"
  | "failure_reset"
  | "inclusion_pending"
  | "excluded_by_choice"
  | "excluded_by_preference"
  | "excluded_by_book_setting"
  | "no_valid_attempts";

/** Review identity is shared across books; trim edge whitespace and preserve display spelling. */
export function normalizeReviewWord(word: string): string {
  return word.replace(/[\u2018\u2019]/gu, "'").trim().replace(/\s+/gu, " ").toLowerCase();
}

/** First explicit spelling inclusion choice resolves pending history permanently. */
export function captureFirstSpellingReviewChoice(
  previous: boolean | null | undefined,
  selected: boolean | null | undefined,
): boolean | null {
  return previous ?? selected ?? null;
}

export type ReviewAttemptEvent = {
  id: string;
  book_id: string;
  word: string;
  review_word_key: string;
  review_session_id: string | null;
  review_mode: ReviewMode | null;
  session_stage: string | null;
  counted_for_review: boolean | null;
  correct: boolean;
  skipped: boolean;
  hint_count: number;
  typo_count: number;
  mistouch: boolean;
  duration_ms: number;
  time_zone: string | null;
  created_at: string;
};

export type ReviewSessionResult = {
  sessionId: string;
  /** Source book for this session; review state itself is shared across books. */
  bookId: string;
  /** Original spelling is retained for display/provenance; wordKey is canonical. */
  word: string;
  wordKey: string;
  reviewMode: ReviewMode;
  outcome: ReviewOutcome | null;
  countedForReview: boolean | null;
  finalCorrect: boolean | null;
  hadRealError: boolean;
  realWrongCount: number;
  usedHint: boolean;
  hintCount: number;
  attemptCount: number;
  validAttemptCount: number;
  lastAttemptId: string | null;
  completedAt: string;
  timeZone: string;
  learningDay: string;
  sourceFingerprint: string;
};

export type ReviewSessionSource = Pick<
  ReviewSessionResult,
  | "sessionId"
  | "bookId"
  | "word"
  | "wordKey"
  | "countedForReview"
  | "completedAt"
  | "timeZone"
  | "learningDay"
  | "sourceFingerprint"
>;

export type ReviewScheduleState = {
  reviewMode: ReviewMode;
  lastReviewedAt: string | null;
  nextDueAt: string | null;
  intervalSeconds: number | null;
  consecutiveCorrect: number;
  totalWrong: number;
  hintCount: number;
  difficulty: number | null;
  schedulerData: Json;
  lastAttemptId: string | null;
  lastSessionId: string | null;
  lastLearningDay: string | null;
  successfulGrowthDay: string | null;
  pendingAction: ScheduleAction;
  lastOutcome: ReviewOutcome | null;
  lastDecisionReason: ScheduleReason | null;
  schedulerVersion: string | null;
};

export type ReviewDecision = {
  session: ReviewSessionResult;
  effectiveInclusion: boolean | null;
  isInitialLearning: boolean;
  stateAdvanced: boolean;
  intervalAdvanced: boolean;
  action: ScheduleAction;
  reason: ScheduleReason;
  schedulerVersion: string;
  inputFingerprint: string;
  beforeState: ReviewScheduleState;
  afterState: ReviewScheduleState;
};

export type ReviewSchedulerContext = {
  isInitialLearning: boolean;
  successAlreadyAdvancedToday: boolean;
  effectiveInclusion: boolean | null;
  bookIncluded: boolean;
};

export type ReviewProjectionOptions = {
  scopeKey?: ReviewScopeKey;
  bookInclusionById?: Readonly<Record<string, boolean>>;
};

export interface ReviewScheduler {
  readonly version: string;
  applySession(
    state: ReviewScheduleState,
    session: ReviewSessionResult,
    context: ReviewSchedulerContext,
  ): Omit<ReviewDecision, "session" | "effectiveInclusion" | "isInitialLearning" | "inputFingerprint" | "beforeState">;
}

export function emptyReviewScheduleState(reviewMode: ReviewMode): ReviewScheduleState {
  return {
    reviewMode,
    lastReviewedAt: null,
    nextDueAt: null,
    intervalSeconds: null,
    consecutiveCorrect: 0,
    totalWrong: 0,
    hintCount: 0,
    difficulty: null,
    schedulerData: {},
    lastAttemptId: null,
    lastSessionId: null,
    lastLearningDay: null,
    successfulGrowthDay: null,
    pendingAction: "none",
    lastOutcome: null,
    lastDecisionReason: null,
    schedulerVersion: null,
  };
}

function formatterParts(date: Date, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
}

/** The persisted learning day uses the user's local calendar with a 04:00 boundary. */
export function learningDayAt(timestamp: string | Date, timeZone: string): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.valueOf())) throw new Error("Invalid review timestamp");
  const parts = formatterParts(date, timeZone);
  const localHour = Number(parts["hour"]);
  const day = Date.UTC(
    Number(parts["year"]),
    Number(parts["month"]) - 1,
    Number(parts["day"]) - (localHour < 4 ? 1 : 0),
  );
  return new Date(day).toISOString().slice(0, 10);
}

function orderedAttempts(reviewMode: ReviewMode, attempts: ReviewAttemptEvent[]): ReviewAttemptEvent[] {
  return attempts
    .filter((attempt) => attempt.review_mode === reviewMode && !attempt.skipped)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

/** Stable session provenance, including attempts later voided as mistouches. */
export function reviewSessionSource(
  reviewMode: ReviewMode,
  attempts: ReviewAttemptEvent[],
  persisted?: Pick<ReviewSessionResult, "completedAt" | "timeZone" | "learningDay">,
): ReviewSessionSource | null {
  const ordered = orderedAttempts(reviewMode, attempts);
  if (!ordered.length) return null;

  const sessionIds = new Set(ordered.map((attempt) => attempt.review_session_id).filter(Boolean));
  if (sessionIds.size !== 1) throw new Error("Aggregate one review session at a time");
  const sessionId = [...sessionIds][0];
  if (!sessionId) return null;
  const sessionAttempts = ordered.filter((attempt) => attempt.review_session_id === sessionId);
  const bookId = sessionAttempts[0]?.book_id;
  if (!bookId || sessionAttempts.some((attempt) => attempt.book_id !== bookId))
    throw new Error("A review session cannot span source books");
  const word = sessionAttempts[0]?.word;
  const wordKey = sessionAttempts[0]?.review_word_key;
  if (
    !word ||
    !wordKey ||
    normalizeReviewWord(word) !== wordKey ||
    sessionAttempts.some(
      (attempt) => attempt.review_word_key !== wordKey || normalizeReviewWord(attempt.word) !== wordKey,
    )
  )
    throw new Error("Review attempt word key does not match its normalized word");
  const explicitInclusions = sessionAttempts
    .map((attempt) => attempt.counted_for_review)
    .filter((value): value is boolean => value !== null);
  const completedAt = persisted?.completedAt ?? sessionAttempts.at(-1)!.created_at;
  const timeZone = persisted?.timeZone ?? sessionAttempts.at(-1)!.time_zone ?? "UTC";

  return {
    sessionId,
    bookId,
    word,
    wordKey,
    countedForReview: explicitInclusions.at(-1) ?? null,
    completedAt,
    timeZone,
    learningDay: persisted?.learningDay ?? learningDayAt(completedAt, timeZone),
    sourceFingerprint: JSON.stringify(
      sessionAttempts.map((attempt) => [
        attempt.id,
        attempt.book_id,
        attempt.word,
        attempt.review_word_key,
        attempt.correct,
        attempt.skipped,
        attempt.mistouch,
        attempt.typo_count,
        attempt.hint_count,
        attempt.counted_for_review,
        attempt.review_mode,
        attempt.session_stage,
        attempt.duration_ms,
        attempt.time_zone,
        attempt.created_at,
      ]),
    ),
  };
}

/** Rebuilds one session result; fully voided sessions have no result row. */
export function aggregateReviewSession(
  reviewMode: ReviewMode,
  attempts: ReviewAttemptEvent[],
  persisted?: Pick<ReviewSessionResult, "completedAt" | "timeZone" | "learningDay">,
): ReviewSessionResult | null {
  const ordered = orderedAttempts(reviewMode, attempts);
  if (!ordered.length) return null;
  const source = reviewSessionSource(reviewMode, ordered, persisted);
  if (!source) return null;
  const sessionAttempts = ordered.filter((attempt) => attempt.review_session_id === source.sessionId);
  const valid = sessionAttempts.filter((attempt) => !attempt.mistouch);
  if (!valid.length) return null;
  const finalAttempt = valid.at(-1);
  const realWrongCount = valid.filter(
    (attempt) =>
      !attempt.correct || (reviewMode === "spelling" && attempt.typo_count > 0),
  ).length;
  const hadRealError = realWrongCount > 0;
  // A mistouched attempt is removed from grading as a whole, including its hints.
  const hintCount = valid.reduce((sum, attempt) => sum + Math.max(0, attempt.hint_count), 0);
  const usedHint = hintCount > 0;
  const finalByStage = new Map<string, ReviewAttemptEvent>();
  for (const attempt of valid) finalByStage.set(attempt.session_stage ?? "unknown", attempt);
  const finalCorrect =
    finalByStage.size === 0 ? null : [...finalByStage.values()].every((attempt) => attempt.correct);
  const outcome: ReviewOutcome | null =
    finalCorrect === null
      ? null
      : !finalCorrect
        ? "failed"
        : hadRealError || usedHint
          ? "strained"
          : "smooth";

  return {
    sessionId: source.sessionId,
    bookId: source.bookId,
    word: source.word,
    wordKey: source.wordKey,
    reviewMode,
    outcome,
    countedForReview: source.countedForReview,
    finalCorrect,
    hadRealError,
    realWrongCount,
    usedHint,
    hintCount,
    attemptCount: sessionAttempts.length,
    validAttemptCount: valid.length,
    lastAttemptId: finalAttempt?.id ?? null,
    completedAt: source.completedAt,
    timeZone: source.timeZone,
    learningDay: source.learningDay,
    sourceFingerprint: source.sourceFingerprint,
  };
}

function withSessionMetadata(
  state: ReviewScheduleState,
  session: ReviewSessionResult,
  action: ScheduleAction,
  reason: ScheduleReason,
  schedulerVersion: string,
): ReviewScheduleState {
  const schedulerData =
    state.schedulerData && typeof state.schedulerData === "object" && !Array.isArray(state.schedulerData)
      ? state.schedulerData
      : {};
  return {
    ...state,
    lastReviewedAt: session.completedAt,
    hintCount: state.hintCount + session.hintCount,
    totalWrong: state.totalWrong + session.realWrongCount,
    lastAttemptId: session.lastAttemptId,
    lastSessionId: session.sessionId,
    lastLearningDay: session.learningDay,
    pendingAction: action,
    lastOutcome: session.outcome,
    lastDecisionReason: reason,
    schedulerVersion,
    schedulerData: {
      ...(schedulerData as Record<string, Json>),
      lastAction: action,
      lastOutcome: session.outcome,
    },
  };
}

/**
 * Foundation policy records state actions without choosing interval durations.
 * A later scheduler can replace this implementation and fill nextDueAt/intervalSeconds.
 */
export const eventOnlyReviewScheduler: ReviewScheduler = {
  version: "review-foundation-v3",
  applySession(state, session, context) {
    let reason: ScheduleReason;
    let action: ScheduleAction = "none";
    let afterState = state;
    let stateAdvanced = false;
    let intervalAdvanced = false;

    if (!context.bookIncluded) reason = "excluded_by_book_setting";
    else if (context.effectiveInclusion === null) reason = "inclusion_pending";
    else if (!context.effectiveInclusion)
      reason = session.countedForReview === false ? "excluded_by_choice" : "excluded_by_preference";
    else if (!session.outcome) reason = "no_valid_attempts";
    else if (session.outcome === "failed") {
      reason = "failure_reset";
      action = "failure_reset_short";
      afterState = {
        ...withSessionMetadata(state, session, action, reason, this.version),
        consecutiveCorrect: 0,
        intervalSeconds: null,
        nextDueAt: null,
      };
      stateAdvanced = true;
    } else if (context.isInitialLearning) {
      reason = "first_learning";
      action = "initialize";
      afterState = {
        ...withSessionMetadata(state, session, action, reason, this.version),
        consecutiveCorrect: 0,
      };
      stateAdvanced = true;
    } else if (context.successAlreadyAdvancedToday) {
      reason = "same_day_repeat";
      action = "hold";
      // Keep an earlier failure reset/growth action intact while retaining session metrics.
      afterState = {
        ...state,
        lastReviewedAt: session.completedAt,
        hintCount: state.hintCount + session.hintCount,
        totalWrong: state.totalWrong + session.realWrongCount,
        lastSessionId: session.sessionId,
        lastLearningDay: session.learningDay,
        schedulerVersion: this.version,
      };
      stateAdvanced = true;
    } else {
      reason = "normal_growth";
      action = "grow";
      afterState = {
        ...withSessionMetadata(state, session, action, reason, this.version),
        consecutiveCorrect: state.consecutiveCorrect + 1,
        successfulGrowthDay: session.learningDay,
      };
      stateAdvanced = true;
      intervalAdvanced = true;
    }

    return {
      afterState,
      stateAdvanced,
      intervalAdvanced,
      action,
      reason,
      schedulerVersion: this.version,
    };
  },
};

export function projectReviewScheduleState(
  reviewMode: ReviewMode,
  sessions: ReviewSessionResult[],
  firstSpellingChoice: boolean | null,
  scheduler: ReviewScheduler = eventOnlyReviewScheduler,
  options: ReviewProjectionOptions = {},
): { state: ReviewScheduleState; decisions: ReviewDecision[] } {
  const initialState = emptyReviewScheduleState(reviewMode);
  const ordered = [...sessions]
    .filter(
      (session) =>
        session.reviewMode === reviewMode &&
        (!options.scopeKey || reviewScopeIncludesBook(options.scopeKey, session.bookId)),
    )
    .sort(
      (a, b) =>
        a.completedAt.localeCompare(b.completedAt) ||
        a.bookId.localeCompare(b.bookId) ||
        a.sessionId.localeCompare(b.sessionId),
    );
  if (new Set(ordered.map((session) => session.wordKey)).size > 1)
    throw new Error("Review state projection cannot combine different normalized words");
  let state = initialState;
  let hasPriorIncludedSession = false;
  const decisions: ReviewDecision[] = [];

  for (const session of ordered) {
    const bookIncluded = options.bookInclusionById?.[session.bookId] !== false;
    const effectiveInclusion = !bookIncluded
      ? false
      : (session.countedForReview ??
        (reviewMode === "spelling" ? firstSpellingChoice : null));
    const isInitialLearning = effectiveInclusion === true && !hasPriorIncludedSession;
    const successAlreadyAdvancedToday = state.successfulGrowthDay === session.learningDay;
    const beforeState = state;
    const transition = scheduler.applySession(state, session, {
      isInitialLearning,
      successAlreadyAdvancedToday,
      effectiveInclusion,
      bookIncluded,
    });
    const inputFingerprint = JSON.stringify({
      schedulerVersion: transition.schedulerVersion,
      beforeState,
      session,
      effectiveInclusion,
      isInitialLearning,
      successAlreadyAdvancedToday,
      bookIncluded,
      scopeKey: options.scopeKey ?? "shared",
    });
    const decision: ReviewDecision = {
      session,
      effectiveInclusion,
      isInitialLearning,
      stateAdvanced: transition.stateAdvanced,
      intervalAdvanced: transition.intervalAdvanced,
      action: transition.action,
      reason: transition.reason,
      schedulerVersion: transition.schedulerVersion,
      inputFingerprint,
      beforeState,
      afterState: transition.afterState,
    };
    decisions.push(decision);
    state = transition.afterState;
    if (effectiveInclusion === true && session.outcome) hasPriorIncludedSession = true;
  }

  return { state, decisions };
}
