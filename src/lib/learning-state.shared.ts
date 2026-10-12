import { entryKey } from "./entry-identity";
import { normalizeReviewWord } from "./review-scheduler.shared";
import { reviewScopeForBook } from "./review-scope.shared";
import {
  parseMemorizeSession,
  parseSentenceCheckpoint,
  type BookProgressMap,
  type BookRevisionMap,
  type LearningMode,
  type MemorizeSession,
  type SentenceCheckpoint,
} from "./learning-session.shared";

export type LearningState = {
  dailyGoal: number;
  activeBook: string;
  memorizeSpelling: boolean;
  strictSpelling: boolean;
  includeSpellingInReview: boolean | null;
  shareReviewProgress: boolean;
  reviewInclusionByBook: Record<string, boolean>;
  masteredByBook: Record<string, string[]>;
  cursors: BookProgressMap;
  progressRevisions: BookRevisionMap;
  memorizeSessions: Record<string, MemorizeSession | null>;
  sentenceSessions: Record<string, SentenceCheckpoint | null>;
  learnedByBook: Record<string, string[]>;
  learnedWords: string[];
  todayItems: { word: string; bookId: string; translation: string | null }[];
  mistouchWords: { word: string; bookId: string; translation: string | null; at: string }[];
  skippedWords: { word: string; bookId: string; translation: string | null; at: string }[];
};

export type LearningProblems = {
  wrongWords: { word: string; bookId: string; translation: string | null }[];
  troubleWords: {
    word: string;
    bookId: string;
    translation: string | null;
    errorAttempts: number;
  }[];
  wrongKeys: string[];
};

export type LearningStats = {
  todayCount: number;
  todayWords: { word: string; bookId: string }[];
  totalCount: number;
  uniqueWords: number;
  cleanRate: number;
  streakDays: number;
  troubleWords: {
    word: string;
    bookId: string;
    translation: string | null;
    errorAttempts: number;
    times: number;
  }[];
  recent: {
    word: string;
    bookId: string;
    translation: string | null;
    mode: string;
    correct: boolean;
    typos: number;
    mistouch: boolean;
    at: string;
  }[];
};

export type LearningAttemptRow = {
  id?: string;
  word: string;
  book_id: string;
  translation: string | null;
  typo_count: number;
  mistouch: boolean;
  correct: boolean;
  skipped: boolean;
  created_at: string;
  mode?: string;
};

export function countLearnedByBook(rows: { book_id: string; word: string; skipped: boolean }[]): Record<string, number> {
  const wordsByBook = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.skipped) continue;
    const words = wordsByBook.get(row.book_id) ?? new Set<string>();
    words.add(row.word);
    wordsByBook.set(row.book_id, words);
  }
  return Object.fromEntries([...wordsByBook].map(([bookId, words]) => [bookId, words.size]));
}

export function isCurrentAttemptMistouched(
  attemptId: string,
  savedMistouch: boolean,
  markedAttemptIds: ReadonlySet<string>,
): boolean {
  return savedMistouch || markedAttemptIds.has(attemptId);
}

export function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    const resolved = new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone;
    return !resolved.startsWith("+") && !resolved.startsWith("-");
  } catch {
    return false;
  }
}

export function localDayAt(date: Date | string, timeZone: string): string {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.valueOf())) throw new Error("Invalid learning timestamp");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function previousDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** Study problems use Review's word/scope identity, but do not split by review mode. */
export function learningProblemKey(bookId: string, word: string, shareAcrossBooks: boolean): string {
  return JSON.stringify([reviewScopeForBook(bookId, shareAcrossBooks), normalizeReviewWord(word)]);
}

function collectErrorWords(rows: LearningAttemptRow[], shareAcrossBooks: boolean) {
  const wrong = new Map<string, { word: string; bookId: string; translation: string | null }>();
  const errorAttempts = new Map<
    string,
    { word: string; bookId: string; translation: string | null; errorAttempts: number }
  >();
  const seenAttempts = new Set<string>();

  rows.forEach((row, index) => {
    const attemptId = row.id ? `id:${row.id}` : `row:${index}`;
    if (row.skipped || row.mistouch || (row.correct && row.typo_count <= 0)) return;
    if (seenAttempts.has(attemptId)) return;
    seenAttempts.add(attemptId);

    const key = learningProblemKey(row.book_id, row.word, shareAcrossBooks);
    if (!wrong.has(key))
      wrong.set(key, { word: row.word, bookId: row.book_id, translation: row.translation });
    const current = errorAttempts.get(key) ?? {
      word: row.word,
      bookId: row.book_id,
      translation: row.translation,
      errorAttempts: 0,
    };
    current.errorAttempts += 1;
    errorAttempts.set(key, current);
  });

  return {
    wrongWords: [...wrong.values()],
    troubleWords: [...errorAttempts.values()]
      .filter((item) => item.errorAttempts >= 2)
      .sort((a, b) => b.errorAttempts - a.errorAttempts),
  };
}

export function buildLearningProblems(rows: LearningAttemptRow[], shareAcrossBooks: boolean): LearningProblems {
  const errorWords = collectErrorWords(rows, shareAcrossBooks);
  const wrongKeys = errorWords.wrongWords.map((item) => learningProblemKey(item.bookId, item.word, shareAcrossBooks));
  const wrongWords = errorWords.wrongWords.slice(0, 60);
  const visibleWrongKeys = new Set(wrongKeys.slice(0, 60));
  return {
    wrongKeys,
    wrongWords,
    troubleWords: errorWords.troubleWords
      .filter((item) => visibleWrongKeys.has(learningProblemKey(item.bookId, item.word, shareAcrossBooks)))
      .slice(0, 60),
  };
}

export function shouldRunSpellingRound(phase: string, spellingEnabled: boolean): boolean {
  return phase === "recall" && spellingEnabled;
}

export function nextLearningCursor(start: number, batchLength: number, bookLength: number): number {
  if (bookLength <= 0) return 0;
  return (start + batchLength) % bookLength;
}

export function buildLearningState(input: {
  settings?: {
    daily_goal: number | null;
    active_book: string | null;
    memorize_spelling: boolean | null;
    strict_spelling: boolean | null;
    include_spelling_in_review?: boolean | null;
    share_review_progress?: boolean | null;
  } | null;
  progress: {
    book_id: string;
    mode?: LearningMode | null;
    cursor_index: number;
    revision?: number | null;
    session_state?: unknown;
  }[];
  attempts: LearningAttemptRow[];
  mastery: { book_id: string; word: string }[];
  bookReviewSettings?: { book_id: string; include_in_review: boolean }[];
  now?: Date;
  timeZone: string;
}): LearningState {
  const rows = input.attempts;
  const studied = rows.filter((row) => !row.skipped);
  const today = localDayAt(input.now ?? new Date(), input.timeZone);
  const cursors: BookProgressMap = {};
  const progressRevisions: BookRevisionMap = {};
  const memorizeSessions: Record<string, MemorizeSession | null> = {};
  const sentenceSessions: Record<string, SentenceCheckpoint | null> = {};
  for (const progress of input.progress) {
    const mode = progress.mode ?? "word";
    const bookCursors = (cursors[progress.book_id] ??= {});
    bookCursors[mode] = progress.cursor_index;
    (progressRevisions[progress.book_id] ??= {})[mode] = progress.revision ?? 0;
    if (mode === "memorize")
      memorizeSessions[progress.book_id] = parseMemorizeSession(progress.session_state);
    if (mode === "sentence")
      sentenceSessions[progress.book_id] = parseSentenceCheckpoint(progress.session_state);
  }

  const learnedByBook: Record<string, string[]> = {};
  for (const row of studied) {
    const words = (learnedByBook[row.book_id] ??= []);
    if (!words.includes(row.word)) words.push(row.word);
  }

  const identity = (row: { book_id: string; word: string }) =>
    entryKey({ bookId: row.book_id, word: row.word });
  const shareAcrossBooks = input.settings?.share_review_progress ?? true;
  const mistouch: LearningState["mistouchWords"] = [];
  for (const row of studied) {
    if (row.mistouch) {
      if (mistouch.length < 40)
        mistouch.push({
          word: row.word,
          bookId: row.book_id,
          translation: row.translation,
          at: row.created_at,
        });
      continue;
    }
  }

  const masteredByBook: Record<string, string[]> = {};
  for (const mastery of input.mastery) (masteredByBook[mastery.book_id] ??= []).push(mastery.word);

  const todayItems = new Map<
    string,
    { word: string; bookId: string; translation: string | null }
  >();
  for (const row of studied) {
    if (localDayAt(row.created_at, input.timeZone) === today && !todayItems.has(identity(row)))
      todayItems.set(identity(row), {
        word: row.word,
        bookId: row.book_id,
        translation: row.translation,
      });
  }

  return {
    dailyGoal: input.settings?.daily_goal ?? 20,
    activeBook: input.settings?.active_book ?? "core",
    memorizeSpelling: input.settings?.memorize_spelling ?? true,
    strictSpelling: input.settings?.strict_spelling ?? false,
    includeSpellingInReview: input.settings?.include_spelling_in_review ?? null,
    shareReviewProgress: shareAcrossBooks,
    reviewInclusionByBook: Object.fromEntries(
      (input.bookReviewSettings ?? []).map(({ book_id, include_in_review }) => [book_id, include_in_review]),
    ),
    masteredByBook,
    cursors,
    progressRevisions,
    memorizeSessions,
    sentenceSessions,
    learnedByBook,
    learnedWords: [...new Set(studied.map((row) => row.word))],
    todayItems: [...todayItems.values()],
    mistouchWords: mistouch,
    skippedWords: rows
      .filter((row) => row.skipped)
      .slice(0, 40)
      .map((row) => ({
        word: row.word,
        bookId: row.book_id,
        translation: row.translation,
        at: row.created_at,
      })),
  };
}

export function buildLearningStats(
  rows: LearningAttemptRow[],
  timeZone: string,
  now = new Date(),
  shareAcrossBooks = true,
): LearningStats {
  const attempts = rows.filter((row) => !row.skipped);
  const today = localDayAt(now, timeZone);
  const todayRows = attempts.filter((row) => localDayAt(row.created_at, timeZone) === today);

  const practiceAttempts = new Map<string, number>();
  const seenPracticeAttempts = new Set<string>();
  for (const [index, row] of attempts.entries()) {
    const attemptId = row.id ? `id:${row.id}` : `row:${index}`;
    if (seenPracticeAttempts.has(attemptId)) continue;
    seenPracticeAttempts.add(attemptId);
    const key = learningProblemKey(row.book_id, row.word, shareAcrossBooks);
    practiceAttempts.set(key, (practiceAttempts.get(key) ?? 0) + 1);
  }
  const troubleWords = collectErrorWords(rows, shareAcrossBooks).troubleWords.map((item) => ({
    ...item,
    times: practiceAttempts.get(learningProblemKey(item.bookId, item.word, shareAcrossBooks)) ?? 0,
  }));

  const todayWords = new Map<string, { word: string; bookId: string }>();
  for (const row of todayRows) {
    const key = learningProblemKey(row.book_id, row.word, shareAcrossBooks);
    if (!todayWords.has(key)) todayWords.set(key, { word: row.word, bookId: row.book_id });
  }

  const days = new Set(attempts.map((row) => localDayAt(row.created_at, timeZone)));
  let streak = 0;
  let cursor = today;
  for (;;) {
    if (days.has(cursor)) {
      streak += 1;
      cursor = previousDay(cursor);
    } else if (streak === 0 && cursor === today) {
      cursor = previousDay(cursor);
    } else break;
  }

  // A wrong recall answer is not a clean pass, even though it has no spelling typos.
  // A confirmed mistouch is exempt from the typo count when the attempt itself was correct.
  const clean = attempts.filter(
    (row) => row.correct && (row.mistouch || row.typo_count === 0),
  ).length;

  return {
    todayCount: todayRows.length,
    todayWords: [...todayWords.values()],
    totalCount: attempts.length,
    uniqueWords: new Set(attempts.map((row) => learningProblemKey(row.book_id, row.word, shareAcrossBooks))).size,
    cleanRate: attempts.length ? Math.round((clean / attempts.length) * 100) : 0,
    streakDays: streak,
    troubleWords: troubleWords.slice(0, 8),
    recent: attempts.slice(0, 20).map((row) => ({
      word: row.word,
      bookId: row.book_id,
      translation: row.translation,
      mode: row.mode ?? "word",
      correct: row.correct,
      typos: row.typo_count,
      mistouch: row.mistouch,
      at: row.created_at,
    })),
  };
}
