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
