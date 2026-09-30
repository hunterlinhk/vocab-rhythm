import type { ReviewMode } from "@/lib/review-scheduler.shared";
import { reviewScopeForBook, type ReviewScopeKey } from "./review-scope.shared";

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

type HistoricalSessionCandidate = SessionCandidate & { user_id: string; book_id?: string };
type HistoricalExistingState = { user_id: string; word_key: string; review_mode: string; scope_key?: string };
type HistoricalSpellingPreference = {
  user_id: string;
  include_spelling_in_review_first_choice: boolean | null;
  share_review_progress?: boolean | null;
};
type HistoricalBookPreference = { user_id: string; book_id: string; include_in_review: boolean };

export type HistoricalReviewStateRepairIdentity = ReviewStateRepairIdentity & {
  userId: string;
  scopeKey: ReviewScopeKey;
};

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
  bookPreferences: HistoricalBookPreference[] = [],
): HistoricalReviewStateRepairIdentity[] {
  const sessionsByUser = new Map<string, SessionCandidate[]>();
  const preferencesByUser = new Map(spellingPreferences.map((preference) => [preference.user_id, preference]));
  const existing = new Set(
    existingStates.map(({ user_id, word_key, review_mode, scope_key }) =>
      JSON.stringify([user_id, word_key, review_mode, scope_key ?? "shared"]),
    ),
  );
  const bookInclusion = new Map(
    bookPreferences.map(({ user_id, book_id, include_in_review }) => [
      JSON.stringify([user_id, book_id]),
      include_in_review,
    ]),
  );

  for (const session of sessions) {
    const userSessions = sessionsByUser.get(session.user_id) ?? [];
    userSessions.push(session);
    sessionsByUser.set(session.user_id, userSessions);
  }

  const repairs: HistoricalReviewStateRepairIdentity[] = [];
  for (const [userId, userSessions] of sessionsByUser) {
    const userPreference = preferencesByUser.get(userId);
    const shareAcrossBooks = userPreference?.share_review_progress ?? true;
    for (const session of userSessions as HistoricalSessionCandidate[]) {
      if (!session.word_key || session.outcome === null) continue;
      if (session.review_mode !== "recognition" && session.review_mode !== "spelling") continue;
      const reviewMode: ReviewMode = session.review_mode;
      const effectiveInclusion =
        session.counted_for_review ??
        (reviewMode === "spelling" ? userPreference?.include_spelling_in_review_first_choice ?? null : null);
      if (effectiveInclusion !== true) continue;
      if (
        session.book_id &&
        bookInclusion.get(JSON.stringify([userId, session.book_id])) === false
      )
        continue;
      if (!shareAcrossBooks && !session.book_id) continue;

      const scopeKey = session.book_id
        ? reviewScopeForBook(session.book_id, shareAcrossBooks)
        : "shared";
      const identity = { userId, wordKey: session.word_key, reviewMode, scopeKey };
      const key = JSON.stringify([userId, identity.wordKey, identity.reviewMode, identity.scopeKey]);
      if (!existing.has(key)) repairs.push(identity);
    }
  }

  const unique = new Map(
    repairs.map((identity) => [
      JSON.stringify([identity.userId, identity.wordKey, identity.reviewMode, identity.scopeKey]),
      identity,
    ]),
  );
  return [...unique.values()].sort(
    (left, right) =>
      left.userId.localeCompare(right.userId) ||
      left.wordKey.localeCompare(right.wordKey) ||
      left.reviewMode.localeCompare(right.reviewMode) ||
      left.scopeKey.localeCompare(right.scopeKey),
  );
}
