import { entryKey } from "./entry-identity";
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
  masteredByBook: Record<string, string[]>;
  cursors: BookProgressMap;
  progressRevisions: BookRevisionMap;
  memorizeSessions: Record<string, MemorizeSession | null>;
  sentenceSessions: Record<string, SentenceCheckpoint | null>;
  learnedByBook: Record<string, string[]>;
  learnedWords: string[];
  todayItems: { word: string; bookId: string; translation: string | null }[];
  wrongWords: { word: string; bookId: string; translation: string | null }[];
  troubleWords: {
    word: string;
    bookId: string;
    translation: string | null;
    errorAttempts: number;
  }[];
  mistouchWords: { word: string; bookId: string; translation: string | null; at: string }[];
  skippedWords: { word: string; bookId: string; translation: string | null; at: string }[];
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

const dayKey = (date: Date) => date.toLocaleDateString("en-CA");

function collectErrorWords(rows: LearningAttemptRow[]) {
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

    const key = entryKey({ bookId: row.book_id, word: row.word });
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
  now?: Date;
}): LearningState {
  const rows = input.attempts;
  const studied = rows.filter((row) => !row.skipped);
  const today = dayKey(input.now ?? new Date());
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
  const errorWords = collectErrorWords(rows);
  const wrongWords = errorWords.wrongWords.slice(0, 60);
  const visibleWrongKeys = new Set(wrongWords.map(entryKey));
  const troubleWords = errorWords.troubleWords
    .filter((item) => visibleWrongKeys.has(entryKey(item)))
    .slice(0, 60);
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
    if (dayKey(new Date(row.created_at)) === today && !todayItems.has(identity(row)))
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
    masteredByBook,
    cursors,
    progressRevisions,
    memorizeSessions,
    sentenceSessions,
    learnedByBook,
    learnedWords: [...new Set(studied.map((row) => row.word))],
    todayItems: [...todayItems.values()],
    wrongWords,
    troubleWords,
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

export function buildLearningStats(rows: LearningAttemptRow[], now = new Date()): LearningStats {
  const attempts = rows.filter((row) => !row.skipped);
  const today = dayKey(now);
  const todayRows = attempts.filter((row) => dayKey(new Date(row.created_at)) === today);

  const practiceAttempts = new Map<string, number>();
  for (const row of attempts) {
    const key = entryKey({ bookId: row.book_id, word: row.word });
    practiceAttempts.set(key, (practiceAttempts.get(key) ?? 0) + 1);
  }
  const troubleWords = collectErrorWords(rows).troubleWords.map((item) => ({
    ...item,
    times: practiceAttempts.get(entryKey(item)) ?? 0,
  }));

  const days = new Set(attempts.map((row) => dayKey(new Date(row.created_at))));
  let streak = 0;
  const cursor = new Date(now);
  for (;;) {
    const key = dayKey(cursor);
    if (days.has(key)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else if (streak === 0 && key === today) {
      cursor.setDate(cursor.getDate() - 1);
    } else break;
  }

  // A wrong recall answer is not a clean pass, even though it has no spelling typos.
  // A confirmed mistouch is exempt from the typo count when the attempt itself was correct.
  const clean = attempts.filter(
    (row) => row.correct && (row.mistouch || row.typo_count === 0),
  ).length;

  return {
    todayCount: todayRows.length,
    todayWords: [
      ...new Map(
        todayRows.map((row) => [
          entryKey({ bookId: row.book_id, word: row.word }),
          { word: row.word, bookId: row.book_id },
        ]),
      ).values(),
    ],
    totalCount: attempts.length,
    uniqueWords: new Set(attempts.map((row) => row.word)).size,
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
