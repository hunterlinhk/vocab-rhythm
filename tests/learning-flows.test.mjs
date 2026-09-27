import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { createServer } from "vite";

const vite = await createServer({ configFile: false, server: { middlewareMode: true } });
after(() => vite.close());

const { buildLearningState, buildLearningStats, nextLearningCursor, shouldRunSpellingRound } =
  await vite.ssrLoadModule("/src/lib/learning-state.shared.ts");
const { advanceMemorizeSession, attemptIdForStage, parseMemorizeSession } =
  await vite.ssrLoadModule("/src/lib/learning-session.shared.ts");
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
      { book_id: "book-a", mode: "word", cursor_index: 4, revision: 0, session_state: {} },
      { book_id: "book-b", mode: "word", cursor_index: 8, revision: 0, session_state: {} },
      {
        book_id: "book-a",
        mode: "sentence",
        cursor_index: 2,
        revision: 3,
        session_state: {
          version: 1,
          kind: "sentence",
          attemptId: "11111111-1111-4111-8111-111111111111",
          activeWord: "apple",
          queueLength: 4,
        },
      },
      {
        book_id: "book-a",
        mode: "memorize",
        cursor_index: 4,
        revision: 7,
        session_state: {
          sessionId: "22222222-2222-4222-8222-222222222222",
          status: "active",
          phase: "recall",
          itemIndex: 0,
          batchWords: ["apple"],
          batchWordIndices: [4],
          bookWordCount: 12,
          spellingOnly: false,
          spellingEnabled: true,
          rightCount: 1,
          masteredCount: 0,
          attemptIds: [
            {
              context: "33333333-3333-4333-8333-333333333333",
              recall: "44444444-4444-4444-8444-444444444444",
              spell: "55555555-5555-4555-8555-555555555555",
            },
          ],
        },
      },
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

  assert.deepEqual(state.cursors, {
    "book-a": { word: 4, sentence: 2, memorize: 4 },
    "book-b": { word: 8 },
  });
  assert.deepEqual(state.progressRevisions, {
    "book-a": { word: 0, sentence: 3, memorize: 7 },
    "book-b": { word: 0 },
  });
  assert.equal(state.memorizeSessions["book-a"].phase, "recall");
  assert.equal(state.sentenceSessions["book-a"].activeWord, "apple");
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

test("memorize session resumes its stage and reuses the same attempt id until server progress advances", () => {
  const initial = {
    sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status: "active",
    phase: "context",
    itemIndex: 1,
    batchWords: ["apple", "orange"],
    batchWordIndices: [4, 6],
    bookWordCount: 7,
    spellingOnly: false,
    spellingEnabled: true,
    rightCount: 0,
    masteredCount: 0,
    attemptIds: [
      {
        context: "a1111111-1111-4111-8111-111111111111",
        recall: "a2222222-2222-4222-8222-222222222222",
        spell: "a3333333-3333-4333-8333-333333333333",
      },
      {
        context: "b1111111-1111-4111-8111-111111111111",
        recall: "b2222222-2222-4222-8222-222222222222",
        spell: "b3333333-3333-4333-8333-333333333333",
      },
    ],
  };
  const restored = parseMemorizeSession(JSON.parse(JSON.stringify(initial)));
  assert.equal(restored.phase, "context");
  assert.equal(restored.itemIndex, 1);
  assert.equal(attemptIdForStage(restored, 1, "context"), "b1111111-1111-4111-8111-111111111111");
  assert.equal(
    attemptIdForStage(parseMemorizeSession(JSON.parse(JSON.stringify(restored))), 1, "context"),
    "b1111111-1111-4111-8111-111111111111",
  );

  const next = advanceMemorizeSession(restored, {
    correct: true,
    rounds: 0,
    spellingEnabled: true,
  });
  assert.equal(next.session.phase, "recall");
  assert.equal(next.session.itemIndex, 0);
  assert.equal(next.session.rightCount, 1);
  assert.equal(
    attemptIdForStage(next.session, 1, "context"),
    "b1111111-1111-4111-8111-111111111111",
  );
});

test("memorize stages persist one stage at a time, retain wrong recalls, and advance the cursor only after the batch", () => {
  const session = {
    sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    status: "active",
    phase: "recall",
    itemIndex: 0,
    batchWords: ["apple", "orange"],
    batchWordIndices: [4, 6],
    bookWordCount: 7,
    spellingOnly: false,
    spellingEnabled: true,
    rightCount: 1,
    masteredCount: 0,
    attemptIds: [
      {
        context: "c1111111-1111-4111-8111-111111111111",
        recall: "c2222222-2222-4222-8222-222222222222",
        spell: "c3333333-3333-4333-8333-333333333333",
      },
      {
        context: "d1111111-1111-4111-8111-111111111111",
        recall: "d2222222-2222-4222-8222-222222222222",
        spell: "d3333333-3333-4333-8333-333333333333",
      },
    ],
  };
  const wrongRecall = advanceMemorizeSession(session, {
    correct: false,
    rounds: 1,
    spellingEnabled: true,
  });
  assert.equal(wrongRecall.session.phase, "spell");
  assert.equal(wrongRecall.session.itemIndex, 0);
  assert.equal(wrongRecall.session.rightCount, 1);
  assert.equal(wrongRecall.cursorIndex, 4);

  const spellAtTwoRounds = advanceMemorizeSession(wrongRecall.session, {
    correct: true,
    rounds: 2,
    spellingEnabled: true,
  });
  assert.equal(spellAtTwoRounds.session.phase, "recall");
  assert.equal(spellAtTwoRounds.session.itemIndex, 1);
  assert.equal(spellAtTwoRounds.session.masteredCount, 0);
  assert.equal(spellAtTwoRounds.cursorIndex, 4);

  const lastRecall = advanceMemorizeSession(spellAtTwoRounds.session, {
    correct: true,
    rounds: 2,
    spellingEnabled: true,
  });
  const completed = advanceMemorizeSession(lastRecall.session, {
    correct: true,
    rounds: 3,
    spellingEnabled: true,
  });
  assert.equal(completed.session.status, "completed");
  assert.equal(completed.session.phase, "done");
  assert.equal(completed.session.masteredCount, 1);
  assert.equal(completed.cursorIndex, 0);
});

test("0009 isolates progress per mode while preserving legacy rows as word progress", async () => {
  const migration = await readFile(
    new URL("../drizzle/migrations/0009_book_progress_modes_and_sessions.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /ADD COLUMN mode text NOT NULL DEFAULT 'word'/);
  assert.match(migration, /ADD COLUMN session_state jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(migration, /PRIMARY KEY \(user_id, book_id, mode\)/);
  assert.match(migration, /mode IN \('word', 'sentence', 'memorize'\)/);
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
