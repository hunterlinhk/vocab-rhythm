import type { ReviewMode } from "@/lib/review-scheduler.shared";

export type ReviewStateRepairIdentity = {
  wordKey: string;
  reviewMode: ReviewMode;
};

type SessionCandidate = {
  word_key: string;
  review_mode: string;
  counted_for_review: boolean | null;
  outcome: string | null;
};

type ExistingState = Pick<ReviewStateRepairIdentity, "wordKey" | "reviewMode">;

type HistoricalSessionCandidate = SessionCandidate & { user_id: string };
type HistoricalExistingState = { user_id: string; word_key: string; review_mode: string };
type HistoricalSpellingPreference = {
  user_id: string;
  include_spelling_in_review_first_choice: boolean | null;
};

export type HistoricalReviewStateRepairIdentity = ReviewStateRepairIdentity & { userId: string };

/** Only completed, effectively included Review v1 sessions can justify a state row. */
export function findMissingReviewStateIdentities(
  sessions: SessionCandidate[],
  existingStates: ExistingState[],
  firstSpellingChoice: boolean | null,
): ReviewStateRepairIdentity[] {
  const existing = new Set(
    existingStates.map(({ wordKey, reviewMode }) => JSON.stringify([wordKey, reviewMode])),
  );
  const missing = new Map<string, ReviewStateRepairIdentity>();

  for (const session of sessions) {
    if (!session.word_key || session.outcome === null) continue;
    if (session.review_mode !== "recognition" && session.review_mode !== "spelling") continue;
    const reviewMode: ReviewMode = session.review_mode;

    const effectiveInclusion =
      session.counted_for_review ?? (reviewMode === "spelling" ? firstSpellingChoice : null);
    if (effectiveInclusion !== true) continue;

    const identity = { wordKey: session.word_key, reviewMode };
    const key = JSON.stringify([identity.wordKey, identity.reviewMode]);
    if (!existing.has(key)) missing.set(key, identity);
  }

  return [...missing.values()];
}

/** Plan only identities represented by the caller's bounded historical session window. */
export function findMissingHistoricalReviewStateIdentities(
  sessions: HistoricalSessionCandidate[],
  existingStates: HistoricalExistingState[],
  spellingPreferences: HistoricalSpellingPreference[],
): HistoricalReviewStateRepairIdentity[] {
  const sessionsByUser = new Map<string, SessionCandidate[]>();
  const statesByUser = new Map<string, ExistingState[]>();
  const firstSpellingChoiceByUser = new Map(
    spellingPreferences.map(({ user_id, include_spelling_in_review_first_choice }) => [
      user_id,
      include_spelling_in_review_first_choice,
    ]),
  );

  for (const session of sessions) {
    const userSessions = sessionsByUser.get(session.user_id) ?? [];
    userSessions.push(session);
    sessionsByUser.set(session.user_id, userSessions);
  }

  for (const state of existingStates) {
    const userStates = statesByUser.get(state.user_id) ?? [];
    if (state.review_mode === "recognition" || state.review_mode === "spelling") {
      userStates.push({ wordKey: state.word_key, reviewMode: state.review_mode });
    }
    statesByUser.set(state.user_id, userStates);
  }

  const repairs: HistoricalReviewStateRepairIdentity[] = [];
  for (const [userId, userSessions] of sessionsByUser) {
    const missing = findMissingReviewStateIdentities(
      userSessions,
      statesByUser.get(userId) ?? [],
      firstSpellingChoiceByUser.get(userId) ?? null,
    );
    repairs.push(...missing.map((identity) => ({ userId, ...identity })));
  }

  return repairs.sort(
    (left, right) =>
      left.userId.localeCompare(right.userId) ||
      left.wordKey.localeCompare(right.wordKey) ||
      left.reviewMode.localeCompare(right.reviewMode),
  );
}
