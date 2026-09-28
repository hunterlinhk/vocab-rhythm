import type { Json } from "@/integrations/supabase/types";

export type ReviewMode = "recognition" | "spelling";

export type ReviewAttemptEvent = {
  id: string;
  review_mode: ReviewMode | null;
  counted_for_review: boolean;
  correct: boolean;
  skipped: boolean;
  hint_count: number;
  typo_count: number;
  mistouch: boolean;
  duration_ms: number;
  created_at: string;
};

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
};

export interface ReviewScheduler {
  applyAttempt(state: ReviewScheduleState, attempt: ReviewAttemptEvent): ReviewScheduleState;
}

/** Records outcomes only; interval and due-date policy are intentionally supplied later. */
export const eventOnlyReviewScheduler: ReviewScheduler = {
  applyAttempt(state, attempt) {
    const wrong =
      !attempt.mistouch &&
      (!attempt.correct || (attempt.review_mode === "spelling" && attempt.typo_count > 0));
    return {
      ...state,
      lastReviewedAt: attempt.created_at,
      consecutiveCorrect: attempt.mistouch
        ? state.consecutiveCorrect
        : wrong
          ? 0
          : state.consecutiveCorrect + 1,
      totalWrong: state.totalWrong + Number(wrong),
      hintCount: state.hintCount + Math.max(0, attempt.hint_count),
      lastAttemptId: attempt.id,
    };
  },
};

export function projectReviewScheduleState(
  reviewMode: ReviewMode,
  attempts: ReviewAttemptEvent[],
  scheduler: ReviewScheduler = eventOnlyReviewScheduler,
): ReviewScheduleState {
  const state: ReviewScheduleState = {
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
  };
  const seen = new Set<string>();
  const ordered: ReviewAttemptEvent[] = [];
  for (const attempt of attempts) {
    if (
      !attempt.counted_for_review ||
      attempt.skipped ||
      attempt.review_mode !== reviewMode ||
      seen.has(attempt.id)
    )
      continue;
    seen.add(attempt.id);
    ordered.push(attempt);
  }
  ordered.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));

  return ordered.reduce((current, attempt) => scheduler.applyAttempt(current, attempt), state);
}
