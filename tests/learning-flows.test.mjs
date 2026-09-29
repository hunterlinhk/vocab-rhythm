import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { createServer } from "vite";

const vite = await createServer({ configFile: false, server: { middlewareMode: true } });
after(() => vite.close());

const { buildLearningState, buildLearningStats, nextLearningCursor, shouldRunSpellingRound } =
  await vite.ssrLoadModule("/src/lib/learning-state.shared.ts");
const {
  clearPendingWordAttempt,
  fetchAfterLearningStateWrites,
  getOrCreatePendingWordAttemptId,
  hasAuthoritativeLearningState,
  queueLearningStateWrite,
} = await vite.ssrLoadModule("/src/lib/learning-state.runtime.ts");
const { advanceMemorizeSession, attemptIdForStage, parseMemorizeSession } =
  await vite.ssrLoadModule("/src/lib/learning-session.shared.ts");
const { loadSentenceCursor, nextSentenceCursor, saveSentenceCursor, SENTENCE_PROGRESS_KEY } =
  await vite.ssrLoadModule("/src/lib/sentence-progress.ts");
const {
  aggregateReviewSession,
  captureFirstSpellingReviewChoice,
  learningDayAt,
  normalizeReviewWord,
  projectReviewScheduleState,
  reviewSessionSource,
} = await vite.ssrLoadModule("/src/lib/review-scheduler.shared.ts");
const { findMissingReviewStateIdentities } = await vite.ssrLoadModule("/src/lib/review-state-repair.shared.ts");

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
    state.troubleWords.map(({ bookId, errorAttempts }) => [bookId, errorAttempts]),
    [["book-a", 2]],
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
  assert.deepEqual(stats.troubleWords, []);
});

test("mistakes include typo and wrong-answer attempts; trouble requires two real attempts per book", () => {
  const rows = [
    attempt({ id: "typo-many", word: "typo", typo_count: 8 }),
    attempt({ id: "answer-one", word: "answer", correct: false }),
    attempt({
      id: "answer-two",
      word: "answer",
      correct: false,
      created_at: "2026-09-26T12:00:00Z",
    }),
    attempt({ id: "same-word-other-book", book_id: "book-b", word: "answer", correct: false }),
    attempt({ id: "mistouch-one", word: "mistouch", typo_count: 9, mistouch: true }),
    attempt({ id: "skip-one", word: "skip", correct: false, skipped: true }),
    attempt({ id: "duplicate-attempt", word: "duplicate", typo_count: 5 }),
    attempt({ id: "duplicate-attempt", word: "duplicate", typo_count: 5 }),
  ];
  const state = buildLearningState({
    settings: null,
    progress: [],
    attempts: rows,
    mastery: [],
    now,
  });
  const stats = buildLearningStats(rows, now);
  const identities = (items) => items.map(({ bookId, word }) => `${bookId}:${word}`);

  assert.deepEqual(identities(state.wrongWords), [
    "book-a:typo",
    "book-a:answer",
    "book-b:answer",
    "book-a:duplicate",
  ]);
  assert.deepEqual(
    state.troubleWords.map(({ bookId, word, errorAttempts }) => [bookId, word, errorAttempts]),
    [["book-a", "answer", 2]],
  );
  assert.deepEqual(
    stats.troubleWords.map(({ bookId, word, errorAttempts, times }) => [
      bookId,
      word,
      errorAttempts,
      times,
    ]),
    [["book-a", "answer", 2, 2]],
  );
  assert.equal(
    stats.recent.find((item) => item.word === "answer")?.correct,
    false,
    "wrong recall attempts retain their correctness state for the history UI",
  );
  assert.ok(
    state.troubleWords.every((item) =>
      identities(state.wrongWords).includes(`${item.bookId}:${item.word}`),
    ),
  );
  assert.deepEqual(identities(state.mistouchWords), ["book-a:mistouch"]);
  assert.ok(!identities(state.wrongWords).some((key) => key.endsWith(":skip")));
});

test("learning-state re-entry waits for pending server writes and restores each book and mode", async () => {
  assert.equal(
    hasAuthoritativeLearningState({ isFetchedAfterMount: false, isFetching: true, isError: false }),
    false,
  );
  assert.equal(
    hasAuthoritativeLearningState({ isFetchedAfterMount: true, isFetching: true, isError: false }),
    false,
  );
  assert.equal(
    hasAuthoritativeLearningState({ isFetchedAfterMount: true, isFetching: false, isError: false }),
    true,
  );
  assert.equal(
    hasAuthoritativeLearningState({ isFetchedAfterMount: true, isFetching: false, isError: true }),
    false,
  );

  let cursor = 4;
  let completedAttempt = false;
  let releaseWrite;
  const blocked = new Promise((resolve) => {
    releaseWrite = resolve;
  });
  const write = queueLearningStateWrite(async () => {
    await blocked;
    completedAttempt = true;
    cursor = 5;
  });
  let fetchedAfterWrite = false;
  const recovered = fetchAfterLearningStateWrites(async () => {
    fetchedAfterWrite = true;
    return buildLearningState({
      settings: null,
      progress: [
        { book_id: "book-a", mode: "word", cursor_index: cursor },
        { book_id: "book-b", mode: "word", cursor_index: 9 },
        { book_id: "book-a", mode: "sentence", cursor_index: 2 },
        {
          book_id: "book-a",
          mode: "memorize",
          cursor_index: 5,
          revision: 8,
          session_state: {
            sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            status: "active",
            phase: "recall",
            itemIndex: 0,
            batchWords: ["apple"],
            batchWordIndices: [5],
            bookWordCount: 10,
            spellingOnly: false,
            spellingEnabled: true,
            rightCount: 1,
            masteredCount: 0,
            attemptIds: [
              {
                context: "a1111111-1111-4111-8111-111111111111",
                recall: "a2222222-2222-4222-8222-222222222222",
                spell: "a3333333-3333-4333-8333-333333333333",
              },
            ],
          },
        },
      ],
      attempts: [],
      mastery: [],
      now,
    });
  });

  await Promise.resolve();
  assert.equal(fetchedAfterWrite, false);
  assert.equal(completedAttempt, false);
  releaseWrite();
  await write;
  const state = await recovered;
  assert.equal(completedAttempt, true);
  assert.deepEqual(state.cursors, {
    "book-a": { word: 5, sentence: 2, memorize: 5 },
    "book-b": { word: 9 },
  });
  assert.equal(state.memorizeSessions["book-a"].phase, "recall");
});

test("an interrupted word completion reuses its id across refresh retries", () => {
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
  const identity = "learn:book-a:apple:4";
  const attemptId = getOrCreatePendingWordAttemptId(identity, storage);

  assert.equal(getOrCreatePendingWordAttemptId(identity, storage), attemptId);
  assert.notEqual(getOrCreatePendingWordAttemptId("learn:book-b:apple:4", storage), attemptId);
  clearPendingWordAttempt(identity, storage);
  assert.notEqual(getOrCreatePendingWordAttemptId(identity, storage), attemptId);
});

test("mistouch data remains stored while review navigation no longer exposes its queue", async () => {
  const [review, shell] = await Promise.all([
    readFile(new URL("../src/routes/_authenticated/review.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/AppShell.tsx", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(review, /误触记录/);
  assert.doesNotMatch(shell, /误触记录/);
});

test("learning modes share one book picker without explanatory copy", async () => {
  const [learn, memorize, sentence, picker] = await Promise.all([
    readFile(new URL("../src/routes/_authenticated/learn.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/_authenticated/memorize.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/_authenticated/sentence.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/BookPicker.tsx", import.meta.url), "utf8"),
  ]);

  for (const page of [learn, memorize, sentence]) {
    assert.match(
      page,
      /BookPicker books=\{allBooks\} selectedBookId=\{bookId\} onSelect=\{switchBook\}/,
    );
  }
  assert.match(picker, /role="group" aria-label="选择词书"/);
  assert.match(picker, /aria-pressed=\{book\.id === selectedBookId\}/);
  assert.doesNotMatch(memorize, /当前词书：|缺少中文释义，当前只能进行单词拼写/);
  assert.doesNotMatch(sentence, /当前词书：/);
});

test("word completion shows the result before saving and keeps failed progress retryable", async () => {
  const learn = await readFile(new URL("../src/routes/_authenticated/learn.tsx", import.meta.url), "utf8");
  const completeStart = learn.indexOf("const onComplete = useCallback(");
  const completeEnd = learn.indexOf("const retryCompletion = useCallback(", completeStart);
  const completionHandler = learn.slice(completeStart, completeEnd);

  assert.ok(completeStart >= 0 && completeEnd > completeStart);
  assert.ok(completionHandler.indexOf("setDone(r)") < completionHandler.indexOf("persistCompletion(completion)"));
  assert.match(learn, /completionRetries\[0\]/);
  assert.match(learn, /clearPendingWordAttempt\(nextCompletion\.identity\)/);
  assert.match(learn, /if \(persisted && completionQueueRef\.current\[0\]\)/);
  assert.doesNotMatch(learn, /正在保存学习进度/);
});

function rawReviewAttempt(id, overrides = {}) {
  const raw = {
    id,
    book_id: "book-a",
    word: "apple",
    review_word_key: "apple",
    review_session_id: "session-a",
    review_mode: "recognition",
    session_stage: "recall",
    counted_for_review: true,
    correct: true,
    skipped: false,
    hint_count: 0,
    typo_count: 0,
    mistouch: false,
    duration_ms: 900,
    time_zone: "America/Los_Angeles",
    created_at: "2026-09-28T18:00:00.000Z",
    ...overrides,
  };
  raw.review_word_key = overrides.review_word_key ?? normalizeReviewWord(raw.word);
  return raw;
}

function reviewSession(sessionId, overrides = {}) {
  const completedAt = overrides.completedAt ?? "2026-09-28T18:00:00.000Z";
  return {
    sessionId,
    bookId: "book-a",
    word: "apple",
    wordKey: "apple",
    reviewMode: "recognition",
    outcome: "smooth",
    countedForReview: true,
    finalCorrect: true,
    hadRealError: false,
    realWrongCount: 0,
    usedHint: false,
    hintCount: 0,
    attemptCount: 1,
    validAttemptCount: 1,
    lastAttemptId: `${sessionId}-attempt`,
    completedAt,
    timeZone: "America/Los_Angeles",
    learningDay: "2026-09-28",
    sourceFingerprint: sessionId,
    ...overrides,
  };
}

test("review session outcome is rebuilt from attempts after mistouches are removed", () => {
  const wrong = rawReviewAttempt("wrong", { correct: false });
  const final = rawReviewAttempt("final", {
    created_at: "2026-09-28T18:01:00.000Z",
  });
  const beforeMistouch = aggregateReviewSession("recognition", [wrong, final]);
  assert.equal(beforeMistouch.outcome, "strained");
  assert.equal(beforeMistouch.realWrongCount, 1);

  const rebuilt = aggregateReviewSession("recognition", [
    { ...wrong, mistouch: true },
    final,
  ]);
  assert.equal(rebuilt.outcome, "smooth");
  assert.equal(rebuilt.realWrongCount, 0);
  assert.equal(rebuilt.hadRealError, false);

  const hinted = aggregateReviewSession("recognition", [
    rawReviewAttempt("hinted", { hint_count: 1 }),
  ]);
  assert.equal(hinted.outcome, "strained");
  assert.equal(hinted.usedHint, true);

  const selectionAppliedDuringSession = aggregateReviewSession("spelling", [
    rawReviewAttempt("before-choice", {
      counted_for_review: null,
      review_mode: "spelling",
      session_stage: "word_spelling",
    }),
    rawReviewAttempt("after-choice", {
      id: "after-choice",
      counted_for_review: true,
      review_mode: "spelling",
      session_stage: "word_spelling",
      created_at: "2026-09-28T18:01:00.000Z",
    }),
  ]);
  assert.equal(selectionAppliedDuringSession.countedForReview, true);

  const voided = aggregateReviewSession("recognition", [{ ...wrong, mistouch: true }]);
  assert.equal(voided, null);

  const hintOnMistouch = aggregateReviewSession("recognition", [
    { ...wrong, mistouch: true, hint_count: 1 },
    { ...final, correct: true },
  ]);
  assert.equal(hintOnMistouch.outcome, "smooth");
  assert.equal(hintOnMistouch.hintCount, 0);

  const spellingSmooth = aggregateReviewSession("spelling", [
    rawReviewAttempt("typo", {
      review_session_id: "spelling-session",
      review_mode: "spelling",
      session_stage: "word_spelling",
      typo_count: 2,
    }),
    rawReviewAttempt("mistouch", {
      review_session_id: "spelling-session",
      review_mode: "spelling",
      session_stage: "word_spelling",
      typo_count: 1,
      mistouch: true,
      created_at: "2026-09-28T18:01:00.000Z",
    }),
  ]);
  assert.equal(spellingSmooth.outcome, "strained");
  assert.equal(spellingSmooth.realWrongCount, 1);
});

test("a post-hoc mistouch changes the rebuilt session and scheduling fingerprint", () => {
  const wrong = rawReviewAttempt("post-hoc-wrong", { correct: false });
  const final = rawReviewAttempt("post-hoc-final", {
    created_at: "2026-09-28T18:01:00.000Z",
  });
  const before = aggregateReviewSession("recognition", [wrong, final]);
  const after = aggregateReviewSession("recognition", [{ ...wrong, mistouch: true }, final]);
  assert.equal(before.outcome, "strained");
  assert.equal(after.outcome, "smooth");
  assert.notEqual(before.sourceFingerprint, after.sourceFingerprint);
  assert.notEqual(
    projectReviewScheduleState("recognition", [before], null).decisions[0].inputFingerprint,
    projectReviewScheduleState("recognition", [after], null).decisions[0].inputFingerprint,
  );
});

test("fully mistouched sessions retain source provenance without an empty or failed result", () => {
  const voidedAttempts = [
    rawReviewAttempt("void-context", { session_stage: "context", mistouch: true }),
    rawReviewAttempt("void-recall", {
      session_stage: "recall",
      mistouch: true,
      created_at: "2026-09-28T18:01:00.000Z",
    }),
  ];
  assert.equal(aggregateReviewSession("recognition", voidedAttempts), null);
  assert.deepEqual(
    (({ sessionId, bookId, wordKey }) => ({ sessionId, bookId, wordKey }))(
      reviewSessionSource("recognition", voidedAttempts),
    ),
    { sessionId: "session-a", bookId: "book-a", wordKey: "apple" },
  );
});

test("review word identity normalizes case, spacing, and apostrophes for custom entries", () => {
  assert.equal(normalizeReviewWord("  APPle \t"), "apple");
  assert.equal(normalizeReviewWord("  DON’T\t  WORRY  "), "don't worry");
  assert.equal(normalizeReviewWord("don't worry"), normalizeReviewWord("don’t worry"));
  assert.equal(normalizeReviewWord(" \t\n "), "");
  const fromOfficial = aggregateReviewSession("recognition", [
    rawReviewAttempt("official-case", {
      book_id: "official-book",
      word: "Apple",
      review_session_id: "official-session",
    }),
  ]);
  const fromCustom = aggregateReviewSession("recognition", [
    rawReviewAttempt("custom-spacing", {
      book_id: "custom-book",
      word: " apple ",
      review_session_id: "custom-session",
      created_at: "2026-09-28T18:01:00.000Z",
    }),
  ]);
  assert.equal(fromOfficial.wordKey, fromCustom.wordKey);
  assert.deepEqual([fromOfficial.bookId, fromCustom.bookId], ["official-book", "custom-book"]);
  const combinedState = projectReviewScheduleState("recognition", [fromOfficial, fromCustom], null);
  assert.equal(combinedState.decisions.length, 2);
  assert.equal(combinedState.decisions[0].reason, "first_learning");
  assert.equal(combinedState.decisions[1].reason, "normal_growth");
});

test("recognition grading evaluates each round's final valid answer", () => {
  const smooth = aggregateReviewSession("recognition", [
    rawReviewAttempt("context", { session_stage: "context" }),
    rawReviewAttempt("recall", { session_stage: "recall", created_at: "2026-09-28T18:01:00.000Z" }),
  ]);
  const correctedWithinRound = aggregateReviewSession("recognition", [
    rawReviewAttempt("context-wrong", { session_stage: "context", correct: false }),
    rawReviewAttempt("context-final", {
      session_stage: "context",
      created_at: "2026-09-28T18:00:30.000Z",
    }),
    rawReviewAttempt("recall-final", { session_stage: "recall", created_at: "2026-09-28T18:01:00.000Z" }),
  ]);
  const failedContext = aggregateReviewSession("recognition", [
    rawReviewAttempt("context", { session_stage: "context", correct: false }),
    rawReviewAttempt("recall", { session_stage: "recall", created_at: "2026-09-28T18:01:00.000Z" }),
  ]);
  const failedRecall = aggregateReviewSession("recognition", [
    rawReviewAttempt("context", { session_stage: "context" }),
    rawReviewAttempt("recall", {
      session_stage: "recall",
      correct: false,
      created_at: "2026-09-28T18:01:00.000Z",
    }),
  ]);
  assert.equal(smooth.outcome, "smooth");
  assert.equal(correctedWithinRound.outcome, "strained");
  assert.equal(failedContext.outcome, "failed");
  assert.equal(failedRecall.outcome, "failed");
});

test("learning day uses the user's local zone and a 04:00 boundary across DST", () => {
  assert.equal(learningDayAt("2026-09-28T09:30:00.000Z", "America/Los_Angeles"), "2026-09-27");
  assert.equal(learningDayAt("2026-09-28T11:00:00.000Z", "America/Los_Angeles"), "2026-09-28");
  assert.equal(learningDayAt("2026-09-28T10:00:00.000Z", "America/Los_Angeles"), "2026-09-27");
  assert.equal(learningDayAt("2026-09-28T10:00:00.000Z", "Asia/Tokyo"), "2026-09-28");
  assert.equal(learningDayAt("2026-03-08T10:30:00.000Z", "America/Los_Angeles"), "2026-03-07");
  assert.equal(learningDayAt("2026-03-08T11:00:00.000Z", "America/Los_Angeles"), "2026-03-08");
});

test("daily scheduler permits one success growth, but every failure resets immediately", () => {
  const day = "2026-09-28";
  const sessions = [
    reviewSession("initial"),
    reviewSession("growth", { completedAt: "2026-09-28T19:00:00.000Z", sourceFingerprint: "2" }),
    reviewSession("repeat", { completedAt: "2026-09-28T20:00:00.000Z", sourceFingerprint: "3" }),
    reviewSession("failure", {
      completedAt: "2026-09-28T21:00:00.000Z",
      outcome: "failed",
      finalCorrect: false,
      realWrongCount: 1,
      hadRealError: true,
      sourceFingerprint: "4",
    }),
    reviewSession("after-failure", { completedAt: "2026-09-28T22:00:00.000Z", sourceFingerprint: "5" }),
    reviewSession("second-failure", {
      completedAt: "2026-09-28T23:00:00.000Z",
      outcome: "failed",
      finalCorrect: false,
      realWrongCount: 1,
      hadRealError: true,
      sourceFingerprint: "6",
    }),
  ].map((session) => ({ ...session, learningDay: day }));
  const projected = projectReviewScheduleState("recognition", sessions, null);
  const decisions = projected.decisions;
  assert.equal(decisions[0].reason, "first_learning");
  assert.equal(decisions[0].intervalAdvanced, false);
  assert.equal(decisions[1].reason, "normal_growth");
  assert.equal(decisions[1].intervalAdvanced, true);
  assert.equal(decisions[2].reason, "same_day_repeat");
  assert.equal(decisions[2].intervalAdvanced, false);
  assert.equal(decisions[3].reason, "failure_reset");
  assert.equal(decisions[4].reason, "same_day_repeat");
  assert.equal(decisions[4].afterState.pendingAction, "failure_reset_short");
  assert.equal(decisions[5].reason, "failure_reset");
  assert.equal(projected.state.totalWrong, 2);
  assert.equal(projected.state.consecutiveCorrect, 0);
  assert.equal(projected.state.successfulGrowthDay, day);
});

test("a success after failure can grow if the learning day has no earlier growth", () => {
  const sessions = [
    reviewSession("first-failure", {
      outcome: "failed",
      finalCorrect: false,
      hadRealError: true,
      realWrongCount: 1,
    }),
    reviewSession("recovered", { completedAt: "2026-09-28T19:00:00.000Z" }),
  ];
  const projected = projectReviewScheduleState("recognition", sessions, null);
  assert.equal(projected.decisions[0].reason, "failure_reset");
  assert.equal(projected.decisions[1].reason, "normal_growth");
  assert.equal(projected.state.successfulGrowthDay, "2026-09-28");
  assert.equal(projected.state.pendingAction, "grow");
});

test("review state is shared across source books but remains independent by mode", () => {
  const day = "2026-09-28";
  const sharedAcrossBooks = projectReviewScheduleState(
    "recognition",
    [
      reviewSession("initial-a", {
        bookId: "book-a",
        completedAt: "2026-09-27T18:00:00.000Z",
        learningDay: "2026-09-27",
      }),
      reviewSession("growth-a", {
        bookId: "book-a",
        completedAt: "2026-09-28T19:00:00.000Z",
        learningDay: day,
      }),
      reviewSession("repeat-b", {
        bookId: "book-b",
        completedAt: "2026-09-28T20:00:00.000Z",
        learningDay: day,
      }),
    ],
    null,
  );
  assert.deepEqual(
    sharedAcrossBooks.decisions.map(({ reason, intervalAdvanced }) => [reason, intervalAdvanced]),
    [["first_learning", false], ["normal_growth", true], ["same_day_repeat", false]],
  );
  assert.equal(sharedAcrossBooks.decisions[2].session.bookId, "book-b");

  const failureThenOtherBookSuccess = projectReviewScheduleState(
    "recognition",
    [
      reviewSession("failure-a", {
        bookId: "book-a",
        outcome: "failed",
        finalCorrect: false,
        hadRealError: true,
        realWrongCount: 1,
        learningDay: day,
      }),
      reviewSession("recovery-b", {
        bookId: "book-b",
        completedAt: "2026-09-28T19:00:00.000Z",
        learningDay: day,
      }),
    ],
    null,
  );
  assert.deepEqual(
    failureThenOtherBookSuccess.decisions.map(({ reason, intervalAdvanced }) => [reason, intervalAdvanced]),
    [["failure_reset", false], ["normal_growth", true]],
  );

  const independentMode = projectReviewScheduleState(
    "spelling",
    [reviewSession("spelling-b", {
      bookId: "book-b",
      reviewMode: "spelling",
      learningDay: day,
    })],
    true,
  );
  assert.equal(independentMode.decisions[0].reason, "first_learning");
});

test("missing review states are repairable once per included word and mode from v1 session results", () => {
  const sessions = [
    {
      book_id: "book-a",
      word_key: "apple",
      review_mode: "recognition",
      counted_for_review: true,
      outcome: "smooth",
    },
    {
      book_id: "book-b",
      word_key: "apple",
      review_mode: "recognition",
      counted_for_review: true,
      outcome: "strained",
    },
    {
      book_id: "bundled-ngsl",
      word_key: "apple",
      review_mode: "spelling",
      counted_for_review: true,
      outcome: "smooth",
    },
    { word_key: "banana", review_mode: "spelling", counted_for_review: null, outcome: "failed" },
    { word_key: "grape", review_mode: "spelling", counted_for_review: false, outcome: "failed" },
    { word_key: "pear", review_mode: "recognition", counted_for_review: null, outcome: "smooth" },
    { word_key: "plum", review_mode: "recognition", counted_for_review: true, outcome: null },
  ];
  const existingStates = [{ wordKey: "apple", reviewMode: "recognition" }];

  const missing = findMissingReviewStateIdentities(sessions, existingStates, true);
  assert.deepEqual(missing, [
    { wordKey: "apple", reviewMode: "spelling" },
    { wordKey: "banana", reviewMode: "spelling" },
  ]);
  assert.deepEqual(findMissingReviewStateIdentities(sessions, [...existingStates, ...missing], true), []);
  assert.deepEqual(findMissingReviewStateIdentities(sessions, existingStates, false), [
    { wordKey: "apple", reviewMode: "spelling" },
  ]);
});

test("changing an earlier session recalculates later decisions during full-history replay", async () => {
  const sessions = [
    reviewSession("early", {
      completedAt: "2026-09-27T18:00:00.000Z",
      learningDay: "2026-09-27",
    }),
    reviewSession("middle", {
      completedAt: "2026-09-28T18:00:00.000Z",
      learningDay: "2026-09-28",
    }),
    reviewSession("latest", {
      completedAt: "2026-09-29T18:00:00.000Z",
      learningDay: "2026-09-29",
    }),
  ];
  const before = projectReviewScheduleState("recognition", sessions, null);
  const after = projectReviewScheduleState(
    "recognition",
    [
      { ...sessions[0], outcome: "failed", finalCorrect: false, hadRealError: true, realWrongCount: 1 },
      ...sessions.slice(1),
    ],
    null,
  );
  assert.notEqual(before.decisions[1].inputFingerprint, after.decisions[1].inputFingerprint);
  assert.notEqual(before.decisions[2].inputFingerprint, after.decisions[2].inputFingerprint);

  const persistence = await readFile(new URL("../src/lib/review-sessions.server.ts", import.meta.url), "utf8");
  assert.match(persistence, /const attempts = await fetchAttempts\(supabase, identity\)/);
  assert.match(persistence, /const projection = projectReviewScheduleState\([\s\S]*sessions\.map\(sessionFromRow\)/);
  assert.match(persistence, /for \(const decision of projection\.decisions\)/);
  assert.match(persistence, /if \(prior\?\.fingerprint === decision\.inputFingerprint\) continue/);
  assert.match(persistence, /supersedes_decision_id: prior\?\.decisionId/);
  assert.match(persistence, /decision_revision: revision/);
});

test("a post-hoc mistouch replays later sessions and supersedes changed decisions", async () => {
  const raw = [
    rawReviewAttempt("retroactive-error", {
      review_session_id: "early",
      session_stage: "context",
      correct: false,
      created_at: "2026-09-27T17:00:00.000Z",
    }),
    rawReviewAttempt("early-context-final", {
      review_session_id: "early",
      session_stage: "context",
      created_at: "2026-09-27T17:01:00.000Z",
    }),
    rawReviewAttempt("early-recall-final", {
      review_session_id: "early",
      session_stage: "recall",
      created_at: "2026-09-27T17:02:00.000Z",
    }),
  ];
  const beforeSession = aggregateReviewSession("recognition", raw);
  const afterSession = aggregateReviewSession(
    "recognition",
    raw.map((item) => (item.id === "retroactive-error" ? { ...item, mistouch: true } : item)),
  );
  assert.equal(beforeSession.outcome, "strained");
  assert.equal(afterSession.outcome, "smooth");

  const historyBefore = [
    beforeSession,
    reviewSession("later-one", { completedAt: "2026-09-28T18:00:00.000Z", learningDay: "2026-09-28" }),
    reviewSession("later-two", { completedAt: "2026-09-29T18:00:00.000Z", learningDay: "2026-09-29" }),
  ];
  const historyAfter = [afterSession, ...historyBefore.slice(1)];
  const oldDecisions = projectReviewScheduleState("recognition", historyBefore, null).decisions;
  const rebuiltDecisions = projectReviewScheduleState("recognition", historyAfter, null).decisions;
  assert.notEqual(oldDecisions[1].inputFingerprint, rebuiltDecisions[1].inputFingerprint);
  assert.notEqual(oldDecisions[2].inputFingerprint, rebuiltDecisions[2].inputFingerprint);

  const persistence = await readFile(new URL("../src/lib/review-sessions.server.ts", import.meta.url), "utf8");
  assert.match(persistence, /const attempts = await fetchAttempts\(supabase, identity\)/);
  assert.match(persistence, /supersedes_decision_id: prior\?\.decisionId/);
});

test("pending spelling inclusion stays replayable and review modes keep independent day limits", () => {
  const pending = reviewSession("pending", {
    reviewMode: "spelling",
    countedForReview: null,
    sourceFingerprint: "pending",
  });
  const unanswered = projectReviewScheduleState("spelling", [pending], null);
  const included = projectReviewScheduleState("spelling", [pending], true);
  const excluded = projectReviewScheduleState("spelling", [pending], false);
  assert.equal(unanswered.decisions[0].reason, "inclusion_pending");
  assert.equal(unanswered.state.lastReviewedAt, null);
  assert.equal(included.decisions[0].reason, "first_learning");
  assert.equal(included.state.lastReviewedAt, pending.completedAt);
  assert.equal(excluded.decisions[0].reason, "excluded_by_preference");
  assert.equal(excluded.state.lastReviewedAt, null);

  const explicitlyIncluded = reviewSession("explicit-include", {
    reviewMode: "spelling",
    countedForReview: true,
  });
  const explicitlyExcluded = reviewSession("explicit-exclude", {
    reviewMode: "spelling",
    countedForReview: false,
  });
  assert.equal(
    projectReviewScheduleState("spelling", [explicitlyIncluded], false).decisions[0].effectiveInclusion,
    true,
  );
  assert.equal(
    projectReviewScheduleState("spelling", [explicitlyExcluded], true).decisions[0].effectiveInclusion,
    false,
  );

  const recognition = projectReviewScheduleState("recognition", [reviewSession("recognition")], null);
  assert.equal(recognition.decisions[0].reason, "first_learning");
  const spelling = projectReviewScheduleState("spelling", [reviewSession("spelling", {
    reviewMode: "spelling",
    learningDay: "2026-09-28",
  })], null);
  assert.equal(spelling.decisions[0].reason, "first_learning");
});

test("only the first spelling preference resolves unset history", () => {
  const firstInclude = captureFirstSpellingReviewChoice(undefined, true);
  assert.equal(firstInclude, true);
  assert.equal(captureFirstSpellingReviewChoice(firstInclude, false), true);

  const firstExclude = captureFirstSpellingReviewChoice(null, false);
  assert.equal(firstExclude, false);
  assert.equal(captureFirstSpellingReviewChoice(firstExclude, true), false);

  const stillUnset = captureFirstSpellingReviewChoice(null, null);
  assert.equal(stillUnset, null);
  assert.equal(captureFirstSpellingReviewChoice(stillUnset, true), true);
});

test("first spelling choice resolves pending sessions; later changes affect only new attempts", () => {
  const sessions = [
    reviewSession("legacy-unset", {
      reviewMode: "spelling",
      countedForReview: null,
      completedAt: "2026-09-26T18:00:00.000Z",
      learningDay: "2026-09-26",
    }),
    reviewSession("after-first-include", {
      reviewMode: "spelling",
      countedForReview: true,
      completedAt: "2026-09-27T18:00:00.000Z",
      learningDay: "2026-09-27",
    }),
    reviewSession("after-switch-to-exclude", {
      reviewMode: "spelling",
      countedForReview: false,
      completedAt: "2026-09-28T18:00:00.000Z",
      learningDay: "2026-09-28",
    }),
  ];
  const firstChoice = captureFirstSpellingReviewChoice(null, true);
  const switchedPreference = false;
  const projection = projectReviewScheduleState("spelling", sessions, firstChoice);
  assert.deepEqual(
    projection.decisions.map(({ effectiveInclusion }) => effectiveInclusion),
    [true, true, false],
  );
  assert.equal(projectReviewScheduleState("spelling", [sessions[0]], firstChoice).decisions[0].reason, "first_learning");
  assert.equal(projectReviewScheduleState("spelling", [sessions[2]], switchedPreference).decisions[0].reason, "excluded_by_choice");
});

test("review integration separates raw attempts, session results, and append-only decisions", async () => {
  const [learn, memorize, functions, persistence, migration] = await Promise.all([
    readFile(new URL("../src/routes/_authenticated/learn.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/_authenticated/memorize.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/learning.functions.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/review-sessions.server.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/migrations/0011_review_system_v1_foundation.sql", import.meta.url), "utf8"),
  ]);
  const dueQuery = functions.slice(
    functions.indexOf("export const getDueReviewItems"),
    functions.indexOf("export const saveSettings"),
  );
  const sessionRead = persistence.slice(
    persistence.indexOf("async function fetchSessions"),
    persistence.indexOf("async function fetchAttempts"),
  );
  const stateProjection = persistence.slice(
    persistence.indexOf("async function rebuildReviewStateOnce"),
    persistence.indexOf("export async function rebuildReviewState("),
  );

  assert.match(learn, /sessionId: nextCompletion\.attemptId/);
  assert.match(learn, /includeInReview: includeSpellingInReview/);
  assert.match(memorize, /stage: "spell" as const/);
  assert.match(memorize, /timeZone: getUserTimeZone\(\)/);
  assert.match(functions, /review_mode: data\.stage === "spell" \? null : "recognition"/);
  assert.match(functions, /counted_for_review: data\.stage === "spell" \? false : true/);
  assert.match(functions, /data\.stage === "recall" && effectiveAttempt\.review_mode === "recognition"/);
  assert.match(functions, /review_session_id: data\.stage === "spell" \? null : data\.sessionId/);
  assert.match(functions, /\.update\(\{ mistouch: true \}\)/);
  assert.match(functions, /await finalizeReviewSession\(context\.supabase,\s*\{/);
  assert.match(functions, /export const getDueReviewItems/);
  assert.match(persistence, /\.from\("review_session_results"\)/);
  assert.match(persistence, /\.from\("review_schedule_decisions"\)/);
  assert.match(persistence, /input_fingerprint: decision\.inputFingerprint/);
  assert.match(persistence, /include_spelling_in_review_first_choice/);
  assert.match(functions, /include_spelling_in_review_first_choice/);
  assert.match(functions, /captureFirstSpellingReviewChoice\(/);
  assert.match(persistence, /\.from\("review_session_results"\)[\s\S]*\.delete\(\)/);
  assert.match(persistence, /decision_reason: "no_valid_attempts"/);
  assert.match(migration, /include_spelling_in_review_first_choice boolean/);
  assert.match(migration, /counted_for_review boolean,/);
  assert.ok(
    migration.includes("review_word_key text GENERATED ALWAYS AS (") &&
      migration.includes("lower(btrim(regexp_replace(regexp_replace(word, '[[:space:]]+', ' ', 'g'), '[‘’]', chr(39), 'g')))") &&
      migration.includes("word_key = lower(btrim(regexp_replace(regexp_replace(word, '[[:space:]]+', ' ', 'g'), '[‘’]', chr(39), 'g')))"),
  );
  assert.match(migration, /PRIMARY KEY \(user_id, book_id, word_key, review_mode, session_id\)/);
  assert.match(migration, /PRIMARY KEY \(user_id, word_key, review_mode\)/);
  assert.match(migration, /source_book_id text REFERENCES public\.word_books\(id\) ON DELETE SET NULL/);
  assert.match(migration, /book_id text NOT NULL/);
  assert.match(migration, /ON public\.attempts \(user_id, review_word_key, review_mode, review_session_id, created_at, id\)/);
  assert.match(migration, /UNIQUE \(user_id, book_id, word_key, review_mode, session_id, decision_revision\)/);
  assert.match(migration, /supersedes_decision_id uuid REFERENCES public\.review_schedule_decisions/);
  assert.match(migration, /review_mode = 'recognition' AND mode = 'memorize'/);
  assert.match(migration, /review_mode = 'spelling' AND mode = 'word'/);
  assert.match(migration, /attempts_review_stage_owner_check/);
  assert.ok(migration.includes("session_stage IS NOT NULL AND session_stage IN ('context', 'recall')"));
  assert.doesNotMatch(migration, /REFERENCES public\.review_session_results/);
  assert.match(persistence, /supersedes_decision_id: prior\?\.decisionId/);
  assert.match(persistence, /supersedes_decision_id: prior\.decisionId/);
  assert.match(persistence, /\.order\("decision_revision", \{ ascending: false \}\)/);
  assert.match(persistence, /if \(!latest\.has\(key\)\)/);
  assert.match(persistence, /sessionIdentityKey\(row\.book_id, row\.session_id\)/);
  assert.match(persistence, /normalizeReviewWord\(source\.word\)/);
  assert.match(persistence, /\.eq\("review_word_key", identity\.wordKey\)/);
  assert.match(sessionRead, /\.eq\("word_key", identity\.wordKey\)/);
  assert.doesNotMatch(sessionRead, /\.eq\("book_id"/);
  assert.doesNotMatch(stateProjection, /\.eq\("book_id"/);
  assert.match(functions, /Memorize stages have fixed review ownership/);
  assert.match(functions, /Attempt id is already associated with different learning data/);
  assert.match(persistence, /book_id: decision\.session\.bookId/);
  assert.match(persistence, /source_book_id: lastIncluded\.session\.bookId/);
  assert.match(persistence, /onConflict: "user_id,book_id,word_key,review_mode,session_id"/);
  assert.match(persistence, /import \{ supabaseAdmin \} from "@\/integrations\/supabase\/client\.server"/);
  assert.match(persistence, /supabaseAdmin\s*\.from\("review_session_results"\)\s*\.delete/);
  assert.match(persistence, /supabaseAdmin\s*\.from\("review_session_results"\)\s*\.upsert/);
  assert.match(persistence, /supabaseAdmin\s*\.from\("review_schedule_decisions"\)\s*\.insert/);
  assert.match(persistence, /supabaseAdmin\s*\.from\("review_states"\)\s*\.delete/);
  assert.match(persistence, /supabaseAdmin\s*\.from\("review_states"\)\s*\.insert/);
  assert.match(persistence, /supabaseAdmin\s*\.from\("review_states"\)\s*\.update/);
  assert.match(persistence, /export async function finalizeReviewSession\(\s*supabase: Client,[\s\S]*source:/);
  assert.match(persistence, /export async function rebuildPendingSpellingStates\(supabase: Client, userId:/);
  assert.match(functions, /finalizeReviewSession\(context\.supabase,/);
  assert.match(functions, /rebuildPendingSpellingStates\(context\.supabase, context\.userId\)/);
  assert.match(dueQuery, /"word, word_key, review_mode/);
  assert.doesNotMatch(dueQuery, /source_book_id|bookId|\.eq\("book_id"/);
  assert.doesNotMatch(migration, /UPDATE public\.attempts/);
  assert.match(migration, /review_session_id uuid,/);
  assert.match(migration, /counted_for_review boolean,/);
  const sessionTable = migration.split("CREATE TABLE IF NOT EXISTS public.review_session_results (")[1].split("\n);")[0];
  const decisionTable = migration.split("CREATE TABLE IF NOT EXISTS public.review_schedule_decisions (")[1].split("\n);")[0];
  assert.match(sessionTable, /book_id text NOT NULL,/);
  assert.doesNotMatch(sessionTable, /book_id text NOT NULL REFERENCES/);
  assert.match(decisionTable, /book_id text NOT NULL,/);
  assert.doesNotMatch(decisionTable, /book_id text NOT NULL REFERENCES/);
});

test("review tables have owner-scoped RLS and immutable decision history", async () => {
  const migration = (
    await readFile(
      new URL("../drizzle/migrations/0011_review_system_v1_foundation.sql", import.meta.url),
      "utf8",
    )
  ).replace(/\r\n/g, "\n");
  for (const table of ["review_session_results", "review_schedule_decisions", "review_states"]) {
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`));
    assert.match(
      migration,
      new RegExp(`CREATE POLICY "own [^\\n]+" ON public\\.${table} FOR SELECT TO authenticated\\n  USING \\(auth\\.uid\\(\\) = user_id\\);`),
    );
    assert.doesNotMatch(
      migration,
      new RegExp(`CREATE POLICY "own [^\\n]+" ON public\\.${table} FOR (INSERT|UPDATE|DELETE) TO authenticated`),
    );
  }
  assert.match(
    migration,
    /REVOKE ALL ON public\.review_session_results, public\.review_schedule_decisions, public\.review_states FROM PUBLIC, anon, authenticated/,
  );
  assert.match(
    migration,
    /GRANT SELECT ON public\.review_session_results, public\.review_schedule_decisions, public\.review_states TO authenticated/,
  );
  assert.match(migration, /ALTER TABLE public\.attempts ENABLE ROW LEVEL SECURITY/);
  assert.match(
    migration,
    /CREATE POLICY "own attempts insert" ON public\.attempts FOR INSERT TO authenticated\n  WITH CHECK \(auth\.uid\(\) = user_id\)/,
  );
  assert.match(
    migration,
    /CREATE POLICY "own attempts update" ON public\.attempts FOR UPDATE TO authenticated\n  USING \(auth\.uid\(\) = user_id\) WITH CHECK \(auth\.uid\(\) = user_id\)/,
  );
  assert.match(migration, /GRANT ALL ON public\.review_session_results, public\.review_schedule_decisions, public\.review_states TO service_role/);
});

test("review source book ids remain provenance and v1 states have an idempotent recovery path", async () => {
  const [
    migration,
    persistence,
    functions,
    reviewRoute,
    types,
    journalText,
    snapshotText,
    priorSnapshotText,
  ] = await Promise.all([
    readFile(new URL("../drizzle/migrations/0013_review_source_provenance.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/review-sessions.server.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/learning.functions.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/_authenticated/review.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/integrations/supabase/types.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/migrations/meta/_journal.json", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/migrations/meta/0013_snapshot.json", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/migrations/meta/0012_snapshot.json", import.meta.url), "utf8"),
  ]);
  const recovery = persistence.slice(
    persistence.indexOf("export async function rebuildMissingReviewStates"),
    persistence.indexOf("async function readAllPages"),
  );
  const dueQuery = functions.slice(
    functions.indexOf("export const getDueReviewItems"),
    functions.indexOf("export const saveSettings"),
  );
  const reviewStateTypes = types.slice(types.indexOf("review_states:"), types.indexOf("user_settings:"));
  const journal = JSON.parse(journalText);
  const snapshot = JSON.parse(snapshotText);
  const priorSnapshot = JSON.parse(priorSnapshotText);

  assert.deepEqual(journal.entries.at(-1), {
    idx: 13,
    version: "7",
    when: journal.entries.at(-1).when,
    tag: "0013_review_source_provenance",
    breakpoints: true,
  });
  assert.equal(snapshot.prevId, priorSnapshot.id);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS review_states_source_book_id_fkey/);
  assert.match(migration, /provenance only, may identify a bundled or deleted book/);
  assert.doesNotMatch(migration, /REFERENCES public\.word_books/);
  assert.match(recovery, /\.from\("review_session_results"\)/);
  assert.match(recovery, /\.from\("review_states"\)/);
  assert.doesNotMatch(recovery, /\.from\("attempts"\)/);
  assert.match(recovery, /findMissingReviewStateIdentities\(/);
  assert.match(recovery, /await rebuildReviewState\(supabase, \{ userId, \.\.\.identity \}\)/);
  assert.match(persistence, /if \(prior\?\.fingerprint === decision\.inputFingerprint\) continue/);
  assert.match(functions, /export const repairMissingReviewStates = createServerFn\(\{ method: "POST" \}\)/);
  assert.match(functions, /await rebuildMissingReviewStates\(context\.supabase, context\.userId\)/);
  assert.match(reviewRoute, /useMutation\(\{/);
  assert.match(reviewRoute, /recoverReviewStates\(\)/);
  assert.match(reviewRoute, /useServerFn\(repairMissingReviewStates\)/);
  assert.match(dueQuery, /"word, word_key, review_mode/);
  assert.doesNotMatch(dueQuery, /source_book_id|\.eq\("book_id"/);
  assert.doesNotMatch(reviewStateTypes, /review_states_source_book_id_fkey/);
});

test("local review RLS runner uses only an isolated disposable PostgreSQL container", async () => {
  const runner = await readFile(new URL("../scripts/verify-review-v1-rls.ps1", import.meta.url), "utf8");
  assert.match(runner, /--network none/);
  assert.match(runner, /--rm --name \$containerName/);
  assert.match(runner, /POSTGRES_DB=review_test/);
  assert.match(runner, /Invoke-PostgresFile[\s\S]*?-SingleTransaction/);
  assert.doesNotMatch(runner, /LOVABLE_DB_MIGRATION_URL|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_URL/);
});

test("spelling review inclusion keeps the tri-state setting", () => {
  const base = {
    daily_goal: null,
    active_book: null,
    memorize_spelling: null,
    strict_spelling: null,
  };
  const state = (include) =>
    buildLearningState({
      settings: include === undefined ? base : { ...base, include_spelling_in_review: include },
      progress: [],
      attempts: [],
      mastery: [],
      now,
    });

  assert.equal(state(undefined).includeSpellingInReview, null);
  assert.equal(state(false).includeSpellingInReview, false);
  assert.equal(state(true).includeSpellingInReview, true);
});

test("cursor writes queued before and after navigation cannot land out of order", async () => {
  const writes = [];
  let releaseFirst;
  const firstBlocked = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const first = queueLearningStateWrite(async () => {
    await firstBlocked;
    writes.push(3);
  });
  const second = queueLearningStateWrite(async () => {
    writes.push(4);
  });

  await Promise.resolve();
  assert.deepEqual(writes, []);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(writes, [3, 4]);
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
