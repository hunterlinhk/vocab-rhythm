export type LearningMode = "word" | "sentence" | "memorize";
export type MemorizeStage = "context" | "recall" | "spell";
export type MemorizePhase = MemorizeStage | "done";

export type MemorizeSession = {
  sessionId: string;
  status: "active" | "completed";
  phase: MemorizePhase;
  itemIndex: number;
  batchWords: string[];
  batchWordIndices: number[];
  bookWordCount: number;
  spellingOnly: boolean;
  spellingEnabled: boolean;
  rightCount: number;
  masteredCount: number;
  attemptIds: { context: string; recall: string; spell: string }[];
};

export type BookProgressMap = Record<string, Partial<Record<LearningMode, number>>>;
export type BookRevisionMap = Record<string, Partial<Record<LearningMode, number>>>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SentenceCheckpoint = {
  version: 1;
  kind: "sentence";
  attemptId: string;
  activeWord: string;
  queueLength: number;
};

export function parseSentenceCheckpoint(value: unknown): SentenceCheckpoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<SentenceCheckpoint>;
  if (
    row.version !== 1 ||
    row.kind !== "sentence" ||
    typeof row.attemptId !== "string" ||
    !UUID_PATTERN.test(row.attemptId) ||
    typeof row.activeWord !== "string" ||
    !Number.isSafeInteger(row.queueLength) ||
    !row.queueLength
  )
    return null;
  return row as SentenceCheckpoint;
}

export function parseMemorizeSession(value: unknown): MemorizeSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<MemorizeSession>;
  if (
    typeof row.sessionId !== "string" ||
    !UUID_PATTERN.test(row.sessionId) ||
    (row.status !== "active" && row.status !== "completed") ||
    !["context", "recall", "spell", "done"].includes(row.phase ?? "") ||
    !Number.isSafeInteger(row.itemIndex) ||
    (row.itemIndex ?? -1) < 0 ||
    !Array.isArray(row.batchWords) ||
    !row.batchWords.every((word) => typeof word === "string") ||
    !Array.isArray(row.batchWordIndices) ||
    !row.batchWordIndices.every((index) => Number.isSafeInteger(index) && index >= 0) ||
    row.batchWords.length === 0 ||
    row.batchWordIndices.length !== row.batchWords.length ||
    (row.phase !== "done" && (row.itemIndex ?? -1) >= row.batchWords.length) ||
    (row.status === "completed" && row.phase !== "done") ||
    (row.status === "active" && row.phase === "done") ||
    !Number.isSafeInteger(row.bookWordCount) ||
    !row.bookWordCount ||
    row.batchWordIndices.some((index) => index >= row.bookWordCount!) ||
    typeof row.spellingOnly !== "boolean" ||
    typeof row.spellingEnabled !== "boolean" ||
    !Number.isSafeInteger(row.rightCount) ||
    !Number.isSafeInteger(row.masteredCount) ||
    (row.rightCount ?? -1) < 0 ||
    (row.masteredCount ?? -1) < 0 ||
    !Array.isArray(row.attemptIds) ||
    row.attemptIds.length !== row.batchWords.length ||
    !row.attemptIds.every(
      (ids) =>
        !!ids &&
        typeof ids.context === "string" &&
        UUID_PATTERN.test(ids.context) &&
        typeof ids.recall === "string" &&
        UUID_PATTERN.test(ids.recall) &&
        typeof ids.spell === "string" &&
        UUID_PATTERN.test(ids.spell),
    )
  )
    return null;
  return row as MemorizeSession;
}

export function attemptIdForStage(
  session: MemorizeSession,
  itemIndex: number,
  stage: MemorizeStage,
): string {
  return session.attemptIds[itemIndex]?.[stage] ?? "";
}

export function advanceMemorizeSession(
  current: MemorizeSession,
  result: { correct: boolean; rounds: number; spellingEnabled: boolean },
): { session: MemorizeSession; cursorIndex: number } {
  if (current.status !== "active" || current.phase === "done")
    throw new Error("Cannot advance a completed memorize session");
  if (current.itemIndex >= current.batchWords.length)
    throw new Error("Memorize session item is outside its batch");

  const next: MemorizeSession = {
    ...current,
    spellingEnabled: result.spellingEnabled,
    rightCount:
      current.rightCount +
      (result.correct && (current.phase === "context" || current.phase === "recall") ? 1 : 0),
    masteredCount:
      current.masteredCount +
      (current.phase === "spell" && (current.spellingOnly || result.rounds >= 3) ? 1 : 0),
  };
  const lastItem = current.batchWords.length - 1;
  let completesBatch = false;

  if (current.phase === "context") {
    if (current.itemIndex < lastItem) {
      next.itemIndex = current.itemIndex + 1;
    } else {
      next.phase = "recall";
      next.itemIndex = 0;
    }
  } else if (current.phase === "recall" && !current.spellingOnly && result.spellingEnabled) {
    next.phase = "spell";
  } else if (current.phase === "spell" && current.itemIndex < lastItem) {
    next.phase = current.spellingOnly ? "spell" : "recall";
    next.itemIndex = current.itemIndex + 1;
  } else if (current.itemIndex < lastItem) {
    next.phase = "recall";
    next.itemIndex = current.itemIndex + 1;
  } else {
    next.status = "completed";
    next.phase = "done";
    next.itemIndex = 0;
    completesBatch = true;
  }

  const cursorIndex = completesBatch
    ? (current.batchWordIndices[lastItem]! + 1) % current.bookWordCount
    : current.batchWordIndices[0]!;
  return { session: next, cursorIndex };
}
