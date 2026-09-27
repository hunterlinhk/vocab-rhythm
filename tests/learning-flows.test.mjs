import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "vite";

const vite = await createServer({ configFile: false, server: { middlewareMode: true } });
after(() => vite.close());

const { buildLearningState, buildLearningStats, nextLearningCursor, shouldRunSpellingRound } =
  await vite.ssrLoadModule("/src/lib/learning-state.shared.ts");
const { loadSentenceCursor, nextSentenceCursor, saveSentenceCursor, SENTENCE_PROGRESS_KEY } =
  await vite.ssrLoadModule("/src/lib/sentence-progress.ts");

const now = new Date("2026-09-27T12:00:00.000Z");
const today = now.toISOString();

function attempt(overrides = {}) {
  return {
    word: "apple",
    book_id: "book-a",
    translation: "苹果（新版）",
    typo_count: 0,
    mistouch: false,
    correct: true,
    skipped: false,
    created_at: today,
    mode: "word",
    ...overrides,
  };
}

test("learning queues isolate the same word by book and keep skips out of study queues", () => {
  const state = buildLearningState({
    settings: null,
    progress: [
      { book_id: "book-a", cursor_index: 4 },
      { book_id: "book-b", cursor_index: 8 },
    ],
    attempts: [
      attempt({ book_id: "book-a", correct: false, typo_count: 2 }),
      attempt({
        book_id: "book-a",
        translation: "苹果（旧版）",
        correct: false,
        typo_count: 3,
        created_at: "2026-09-26T12:00:00Z",
      }),
      attempt({ book_id: "book-b", translation: "苹果（词书二）", typo_count: 1, mistouch: true }),
      attempt({ book_id: "book-a", word: "skip", skipped: true, correct: true }),
    ],
    mastery: [
      { book_id: "book-a", word: "apple" },
      { book_id: "book-b", word: "apple" },
    ],
    now,
  });

  assert.deepEqual(state.cursors, { "book-a": 4, "book-b": 8 });
  assert.deepEqual(state.masteredByBook, { "book-a": ["apple"], "book-b": ["apple"] });
  assert.deepEqual(state.learnedWords, ["apple"]);
  assert.deepEqual(state.learnedByBook, { "book-a": ["apple"], "book-b": ["apple"] });
  assert.deepEqual(
    state.todayItems.map(({ bookId, word }) => [bookId, word]),
    [
      ["book-a", "apple"],
      ["book-b", "apple"],
    ],
  );
  assert.deepEqual(state.wrongWords, [
    { word: "apple", bookId: "book-a", translation: "苹果（新版）" },
  ]);
  assert.deepEqual(
    state.troubleWords.map(({ bookId, typos }) => [bookId, typos]),
    [["book-a", 5]],
  );
  assert.deepEqual(
    state.mistouchWords.map(({ bookId, word }) => [bookId, word]),
    [["book-b", "apple"]],
  );
  assert.deepEqual(
    state.skippedWords.map(({ bookId, word }) => [bookId, word]),
    [["book-a", "skip"]],
  );
});

test("stats exclude skips, separate per-book trouble, and do not count wrong recall as clean", () => {
  const stats = buildLearningStats(
    [
      attempt({ book_id: "book-a", correct: false }),
      attempt({ book_id: "book-b", typo_count: 2, mistouch: true }),
      attempt({ book_id: "book-a", word: "orange", typo_count: 1 }),
      attempt({ book_id: "book-a", word: "orange" }),
      attempt({ book_id: "book-b", word: "skip", skipped: true }),
    ],
    now,
  );

  assert.equal(stats.totalCount, 4);
  assert.equal(stats.todayCount, 4);
  assert.equal(stats.uniqueWords, 2);
  assert.equal(stats.cleanRate, 50);
  assert.deepEqual(
    stats.todayWords.map(({ bookId, word }) => [bookId, word]),
    [
      ["book-a", "apple"],
      ["book-b", "apple"],
      ["book-a", "orange"],
    ],
  );
  assert.deepEqual(
    stats.troubleWords.map(({ bookId, word, typos }) => [bookId, word, typos]),
    [["book-a", "orange", 1]],
  );
});

test("three-round recall still proceeds to spelling after an incorrect answer and advances cursor safely", () => {
  assert.equal(shouldRunSpellingRound("recall", true), true);
  assert.equal(shouldRunSpellingRound("context", true), false);
  assert.equal(shouldRunSpellingRound("recall", false), false);
  assert.equal(nextLearningCursor(6, 1, 8), 7);
  assert.equal(nextLearningCursor(7, 1, 8), 0);
  assert.equal(nextLearningCursor(0, 4, 0), 0);
});

test("sentence cursors persist independently for each selected book and wrap to the current queue", () => {
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
  saveSentenceCursor(storage, "book-a", 3);
  saveSentenceCursor(storage, "book-b", 1);

  assert.equal(loadSentenceCursor(storage, "book-a", 4), 3);
  assert.equal(loadSentenceCursor(storage, "book-a", 2), 1);
  assert.equal(loadSentenceCursor(storage, "book-b", 4), 1);
  assert.equal(nextSentenceCursor(3, 4), 0);
  assert.equal(nextSentenceCursor(0, 0), 0);
  assert.deepEqual(JSON.parse(values.get(SENTENCE_PROGRESS_KEY)), { "book-a": 3, "book-b": 1 });
});
