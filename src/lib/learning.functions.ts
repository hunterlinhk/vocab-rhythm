import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { entryKey } from "@/lib/entry-identity";
import {
  captureFirstSpellingReviewChoice,
  learningDayAt,
  normalizeReviewWord,
  type ReviewMode,
} from "@/lib/review-scheduler.shared";
import {
  finalizeReviewSession,
  rebuildPendingSpellingStates,
  rebuildReviewProjectionsForBook,
  rebuildReviewProjectionsForUser,
} from "@/lib/review-sessions.server";
import {
  buildLearningProblems,
  buildLearningState,
  buildLearningStats,
  type LearningAttemptRow,
  type LearningProblems,
  type LearningState,
  type LearningStats,
} from "@/lib/learning-state.shared";
import {
  advanceMemorizeSession,
  attemptIdForStage,
  parseMemorizeSession,
  parseSentenceCheckpoint,
  type LearningMode,
  type MemorizeSession,
  type SentenceCheckpoint,
} from "@/lib/learning-session.shared";

export type { LearningProblems, LearningState, LearningStats };

const AttemptInput = z
  .object({
    attemptId: z.string().uuid().optional(),
    mode: z.enum(["word", "sentence", "memorize"]),
    bookId: z.string(),
    word: z.string(),
    translation: z.string().optional(),
    correct: z.boolean(),
    mistouch: z.boolean(),
    typoCount: z.number().int().min(0),
    durationMs: z.number().int().min(0),
    isReview: z.boolean().optional(),
    skipped: z.boolean().optional(),
    sessionId: z.string().uuid().optional(),
    sessionStage: z.enum(["word_spelling", "context", "recall", "spell"]).nullable().optional(),
    timeZone: z.string().min(1).max(100).optional().default("UTC"),
    reviewMode: z.enum(["recognition", "spelling"]).nullable().optional(),
    includeInReview: z.boolean().nullable().optional(),
    hintCount: z.number().int().min(0).optional(),
  })
  .superRefine((value, ctx) => {
    if (!normalizeReviewWord(value.word))
      ctx.addIssue({ code: "custom", path: ["word"], message: "Word must contain non-whitespace characters" });
    const sessionStage = value.sessionStage ?? (value.mode === "word" ? "word_spelling" : null);
    if (value.includeInReview && !value.reviewMode)
      ctx.addIssue({ code: "custom", path: ["reviewMode"], message: "Review mode is required" });
    if (value.includeInReview === true && value.skipped)
      ctx.addIssue({ code: "custom", path: ["includeInReview"], message: "Skipped attempts cannot be reviewed" });
    if (value.mode === "sentence" && (value.reviewMode || value.includeInReview))
      ctx.addIssue({ code: "custom", path: ["reviewMode"], message: "Sentence attempts are not reviewable" });
    if (value.reviewMode === "spelling" && value.mode !== "word")
      ctx.addIssue({ code: "custom", path: ["reviewMode"], message: "Spelling review belongs to word spelling" });
    if (value.reviewMode === "recognition" && value.mode !== "memorize")
      ctx.addIssue({ code: "custom", path: ["reviewMode"], message: "Recognition review belongs to memorize" });
    if (value.mode === "word" && (value.reviewMode !== "spelling" || sessionStage !== "word_spelling"))
      ctx.addIssue({ code: "custom", path: ["reviewMode"], message: "Word spelling attempts require spelling review mode" });
    if (
      value.mode === "memorize" &&
      !(
        (value.reviewMode === "recognition" && (sessionStage === "context" || sessionStage === "recall")) ||
        (value.reviewMode === null && sessionStage === "spell")
      )
    )
      ctx.addIssue({ code: "custom", path: ["reviewMode"], message: "Memorize stages have fixed review ownership" });
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value.timeZone });
    } catch {
      ctx.addIssue({ code: "custom", path: ["timeZone"], message: "Invalid time zone" });
    }
  });

export const recordAttempt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AttemptInput.parse(input))
  .handler(async ({ data, context }) => {
    const attemptId = data.attemptId ?? globalThis.crypto.randomUUID();
    const sessionId = data.sessionId ?? attemptId;
    const reviewMode = data.mode === "sentence" ? null : (data.reviewMode ?? null);
    const attempt = {
      id: attemptId,
      user_id: context.userId,
      mode: data.mode,
      book_id: data.bookId,
      word: data.word,
      translation: data.translation ?? null,
      correct: data.correct,
      mistouch: data.mistouch,
      typo_count: data.typoCount,
      duration_ms: data.durationMs,
      is_review: data.isReview ?? false,
      skipped: data.skipped ?? false,
      review_mode: reviewMode,
      counted_for_review: data.skipped || data.mode === "sentence" ? false : (data.includeInReview ?? null),
      hint_count: data.hintCount ?? 0,
      review_session_id: reviewMode ? sessionId : null,
      session_stage: data.sessionStage ?? (data.mode === "word" ? "word_spelling" : null),
      time_zone: data.timeZone,
    };
    const { data: inserted, error } = await context.supabase
      .from("attempts")
      .upsert(attempt, { onConflict: "id", ignoreDuplicates: true })
      .select("id, mode, book_id, word, translation, correct, typo_count, duration_ms, is_review, skipped, review_mode, counted_for_review, hint_count, review_session_id, session_stage, time_zone")
      .maybeSingle();
    if (error) throw new Error(error.message);
    let saved = inserted;
    if (!saved) {
      const { data: existing, error: existingError } = await context.supabase
        .from("attempts")
        .select("id, mode, book_id, word, translation, correct, typo_count, duration_ms, is_review, skipped, review_mode, counted_for_review, hint_count, review_session_id, session_stage, time_zone")
        .eq("id", attemptId)
        .eq("user_id", context.userId)
        .single();
      if (existingError) throw new Error(existingError.message);
      saved = existing;
    }
    if (
      !saved ||
      saved.mode !== attempt.mode ||
      saved.book_id !== attempt.book_id ||
      saved.word !== attempt.word ||
      saved.translation !== attempt.translation ||
      saved.correct !== attempt.correct ||
      saved.typo_count !== attempt.typo_count ||
      saved.duration_ms !== attempt.duration_ms ||
      saved.is_review !== attempt.is_review ||
      saved.skipped !== attempt.skipped ||
      saved.review_mode !== attempt.review_mode ||
      saved.counted_for_review !== attempt.counted_for_review ||
      saved.hint_count !== attempt.hint_count ||
      saved.review_session_id !== attempt.review_session_id ||
      saved.session_stage !== attempt.session_stage ||
      saved.time_zone !== attempt.time_zone
    )
      throw new Error("Attempt id is already associated with different learning data");
    if (saved?.review_mode && saved.review_session_id && !data.skipped &&
      (saved.mode !== "memorize" || saved.session_stage === "recall"))
      await finalizeReviewSession(context.supabase, {
        userId: context.userId,
        bookId: saved.book_id,
        word: saved.word,
        reviewMode: saved.review_mode as ReviewMode,
      }, saved.review_session_id);
    return { ok: true };
  });

/** marks the most recent attempt of a word as a mistouch (used by the strict-spelling review panel) */
export const markAttemptMistouch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ word: z.string(), bookId: z.string(), attemptId: z.string().uuid().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const q = context.supabase
      .from("attempts")
      .select("id, book_id, word, mode, typo_count, mistouch, review_mode, review_session_id")
      .eq("user_id", context.userId)
      .eq("word", data.word)
      .eq("book_id", data.bookId);
    const { data: row, error: lookupError } = data.attemptId
      ? await q.eq("id", data.attemptId).maybeSingle()
      : await q
          .eq("mode", "word")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (!row) return { ok: false };
    if (row.book_id !== data.bookId || row.word !== data.word || row.mode !== "word")
      throw new Error("Attempt id is associated with a different learning entry");
    const { data: updated, error } = await context.supabase
      .from("attempts")
      .update({ mistouch: true })
      .eq("id", row.id)
      .select("review_mode, review_session_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (updated?.review_mode && updated.review_session_id)
      await finalizeReviewSession(context.supabase, {
        userId: context.userId,
        bookId: data.bookId,
        word: data.word,
        reviewMode: updated.review_mode as ReviewMode,
      }, updated.review_session_id);
    return { ok: true };
  });

const StartMemorizeInput = z
  .object({
    bookId: z.string().min(1),
    cursorIndex: z.number().int().min(0),
    expectedRevision: z.number().int().min(0),
    bookWordCount: z.number().int().positive(),
    batchWords: z.array(z.string().min(1)).min(1).max(8),
    batchWordIndices: z.array(z.number().int().min(0)).min(1).max(8),
    spellingOnly: z.boolean(),
    spellingEnabled: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.batchWords.length !== value.batchWordIndices.length)
      ctx.addIssue({ code: "custom", message: "Batch words and indices must have equal length" });
    if (value.cursorIndex >= value.bookWordCount)
      ctx.addIssue({ code: "custom", message: "Cursor is outside the book" });
    if (value.batchWordIndices.some((index) => index >= value.bookWordCount))
      ctx.addIssue({ code: "custom", message: "Batch index is outside the book" });
  });

function createMemorizeSession(data: z.infer<typeof StartMemorizeInput>): MemorizeSession {
  return {
    sessionId: globalThis.crypto.randomUUID(),
    status: "active",
    phase: data.spellingOnly ? "spell" : "context",
    itemIndex: 0,
    batchWords: data.batchWords,
    batchWordIndices: data.batchWordIndices,
    bookWordCount: data.bookWordCount,
    spellingOnly: data.spellingOnly,
    spellingEnabled: data.spellingEnabled,
    rightCount: 0,
    masteredCount: 0,
    attemptIds: data.batchWords.map(() => ({
      context: globalThis.crypto.randomUUID(),
      recall: globalThis.crypto.randomUUID(),
      spell: globalThis.crypto.randomUUID(),
    })),
  };
}

export const startMemorizeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => StartMemorizeInput.parse(input))
  .handler(async ({ data, context }) => {
    const [progressRes, wordProgressRes] = await Promise.all([
      context.supabase
        .from("book_progress")
        .select("book_id, cursor_index, mode, revision, session_state")
        .eq("user_id", context.userId)
        .eq("book_id", data.bookId)
        .eq("mode", "memorize")
        .maybeSingle(),
      context.supabase
        .from("book_progress")
        .select("cursor_index")
        .eq("user_id", context.userId)
        .eq("book_id", data.bookId)
        .eq("mode", "word")
        .maybeSingle(),
    ]);
    if (progressRes.error) throw new Error(progressRes.error.message);
    if (wordProgressRes.error) throw new Error(wordProgressRes.error.message);

    const current = progressRes.data;
    const currentSession = parseMemorizeSession(current?.session_state);
    const sameActiveBatch =
      currentSession?.status === "active" &&
      currentSession.bookWordCount === data.bookWordCount &&
      currentSession.spellingOnly === data.spellingOnly &&
      currentSession.batchWords.length === data.batchWords.length &&
      currentSession.batchWords.every((word, index) => word === data.batchWords[index]) &&
      currentSession.batchWordIndices.every(
        (index, offset) => index === data.batchWordIndices[offset],
      );
    if (sameActiveBatch)
      return {
        session: currentSession,
        revision: current!.revision,
        cursorIndex: current!.cursor_index,
        accepted: true,
      };

    const revision = current?.revision ?? 0;
    const rawCursorIndex = current?.cursor_index ?? wordProgressRes.data?.cursor_index ?? 0;
    const cursorIndex = rawCursorIndex % data.bookWordCount;
    if (revision !== data.expectedRevision || cursorIndex !== data.cursorIndex) {
      return {
        session: currentSession,
        revision,
        cursorIndex,
        accepted: false,
      };
    }

    const session = createMemorizeSession(data);
    const row = {
      user_id: context.userId,
      book_id: data.bookId,
      mode: "memorize" as const,
      cursor_index: cursorIndex,
      session_state: session,
      revision: revision + (current ? 1 : 0),
      updated_at: new Date().toISOString(),
    };

    if (!current) {
      const { error } = await context.supabase.from("book_progress").insert(row);
      if (error) {
        if (error.code !== "23505") throw new Error(error.message);
        const { data: winner, error: winnerError } = await context.supabase
          .from("book_progress")
          .select("cursor_index, revision, session_state")
          .eq("user_id", context.userId)
          .eq("book_id", data.bookId)
          .eq("mode", "memorize")
          .single();
        if (winnerError) throw new Error(winnerError.message);
        return {
          session: parseMemorizeSession(winner.session_state),
          revision: winner.revision,
          cursorIndex: winner.cursor_index,
          accepted: true,
        };
      }
      return { session, revision: row.revision, cursorIndex, accepted: true };
    }

    const { data: updated, error } = await context.supabase
      .from("book_progress")
      .update({
        cursor_index: cursorIndex,
        session_state: session,
        revision: row.revision,
        updated_at: row.updated_at,
      })
      .eq("user_id", context.userId)
      .eq("book_id", data.bookId)
      .eq("mode", "memorize")
      .eq("revision", revision)
      .select("cursor_index, revision, session_state")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) {
      const { data: latest, error: latestError } = await context.supabase
        .from("book_progress")
        .select("cursor_index, revision, session_state")
        .eq("user_id", context.userId)
        .eq("book_id", data.bookId)
        .eq("mode", "memorize")
        .single();
      if (latestError) throw new Error(latestError.message);
      return {
        session: parseMemorizeSession(latest.session_state),
        revision: latest.revision,
        cursorIndex: latest.cursor_index,
        accepted: false,
      };
    }
    return {
      session: parseMemorizeSession(updated.session_state),
      revision: updated.revision,
      cursorIndex: updated.cursor_index,
      accepted: true,
    };
  });

const StageInput = z.object({
  word: z.string(),
  bookId: z.string(),
  translation: z.string().optional(),
  stage: z.enum(["context", "recall", "spell"]),
  sessionId: z.string().uuid(),
  attemptId: z.string().uuid(),
  revision: z.number().int().min(0),
  itemIndex: z.number().int().min(0),
  spellingEnabled: z.boolean(),
  timeZone: z.string().min(1).max(100).optional().default("UTC"),
  correct: z.boolean(),
  typoCount: z.number().int().min(0).optional(),
  durationMs: z.number().int().min(0).optional(),
}).superRefine((value, ctx) => {
  if (!normalizeReviewWord(value.word))
    ctx.addIssue({ code: "custom", path: ["word"], message: "Word must contain non-whitespace characters" });
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value.timeZone });
  } catch {
    ctx.addIssue({ code: "custom", path: ["timeZone"], message: "Invalid time zone" });
  }
});

/** records one reinforcement round of the 背单词 flow (context → recall → spell) */
export const recordMemorizeStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => StageInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: progress, error: progressError } = await context.supabase
      .from("book_progress")
      .select("cursor_index, revision, session_state")
      .eq("user_id", context.userId)
      .eq("book_id", data.bookId)
      .eq("mode", "memorize")
      .maybeSingle();
    if (progressError) throw new Error(progressError.message);
    if (!progress) throw new Error("Memorize session is missing; reload the page");
    const session = parseMemorizeSession(progress.session_state);
    if (!session) throw new Error("Memorize session data is invalid; reload the page");

    const { data: priorAttempt, error: priorError } = await context.supabase
      .from("attempts")
      .select(
        "id, book_id, word, mode, correct, typo_count, duration_ms, review_mode, counted_for_review, hint_count, created_at, review_session_id, session_stage, time_zone",
      )
      .eq("id", data.attemptId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (priorError) throw new Error(priorError.message);

    const currentSessionMatches =
      session.sessionId === data.sessionId &&
      progress.revision === data.revision &&
      session.status === "active" &&
      session.phase === data.stage &&
      session.itemIndex === data.itemIndex &&
      session.batchWords[data.itemIndex] === data.word &&
      attemptIdForStage(session, data.itemIndex, data.stage) === data.attemptId;
    if (!currentSessionMatches) {
      if (
        priorAttempt &&
        priorAttempt.book_id === data.bookId &&
        priorAttempt.word === data.word &&
        priorAttempt.mode === "memorize"
      ) {
        return {
          session,
          revision: progress.revision,
          cursorIndex: progress.cursor_index,
          accepted: false,
          rounds: 0,
        };
      }
      return {
        session,
        revision: progress.revision,
        cursorIndex: progress.cursor_index,
        accepted: false,
        rounds: 0,
      };
    }

    if (
      priorAttempt &&
      (priorAttempt.book_id !== data.bookId ||
        priorAttempt.word !== data.word ||
        priorAttempt.mode !== "memorize")
    )
      throw new Error("Attempt id is already associated with a different learning entry");

    let effectiveAttempt = priorAttempt;
    if (!effectiveAttempt) {
      const { error } = await context.supabase.from("attempts").insert({
        id: data.attemptId,
        user_id: context.userId,
        mode: "memorize",
        book_id: data.bookId,
        word: data.word,
        translation: data.translation ?? null,
        correct: data.correct,
        mistouch: false,
        typo_count: data.typoCount ?? 0,
        duration_ms: data.durationMs ?? 0,
        is_review: data.stage !== "context",
        review_mode: data.stage === "spell" ? null : "recognition",
        counted_for_review: data.stage === "spell" ? false : true,
        hint_count: 0,
        review_session_id: data.stage === "spell" ? null : data.sessionId,
        session_stage: data.stage,
        time_zone: data.timeZone,
      });
      if (error && error.code !== "23505") throw new Error(error.message);
      const { data: stored, error: storedError } = await context.supabase
        .from("attempts")
        .select(
          "id, book_id, word, mode, correct, typo_count, duration_ms, review_mode, counted_for_review, hint_count, created_at, review_session_id, session_stage, time_zone",
        )
        .eq("id", data.attemptId)
        .eq("user_id", context.userId)
        .single();
      if (storedError) throw new Error(storedError.message);
      if (stored.book_id !== data.bookId || stored.word !== data.word || stored.mode !== "memorize")
        throw new Error("Attempt id is already associated with a different learning entry");
      effectiveAttempt = stored;
    }

    if (data.stage === "recall" && effectiveAttempt.review_mode === "recognition")
      await finalizeReviewSession(context.supabase, {
        userId: context.userId,
        bookId: data.bookId,
        word: data.word,
        reviewMode: "recognition",
      }, data.sessionId);

    const { data: existing, error: existingError } = await context.supabase
      .from("word_mastery")
      .select("context_ok, recall_ok, spell_ok")
      .eq("user_id", context.userId)
      .eq("book_id", data.bookId)
      .eq("word", data.word)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    const flags = {
      context_ok: existing?.context_ok ?? false,
      recall_ok: existing?.recall_ok ?? false,
      spell_ok: existing?.spell_ok ?? false,
    };
    if (effectiveAttempt.correct) {
      if (data.stage === "context") flags.context_ok = true;
      if (data.stage === "recall") flags.recall_ok = true;
      if (data.stage === "spell") flags.spell_ok = true;
    }
    const rounds = Number(flags.context_ok) + Number(flags.recall_ok) + Number(flags.spell_ok);

    const { error: masteryError } = await context.supabase.from("word_mastery").upsert(
      {
        user_id: context.userId,
        word: data.word,
        book_id: data.bookId,
        translation: data.translation ?? null,
        ...flags,
        rounds,
        reinforced_at: rounds >= 3 ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,book_id,word" },
    );
    if (masteryError) throw new Error(masteryError.message);

    const advanced = advanceMemorizeSession(session, {
      correct: effectiveAttempt.correct,
      rounds,
      spellingEnabled: data.spellingEnabled,
    });
    const nextRevision = progress.revision + 1;
    const { data: updated, error: updateError } = await context.supabase
      .from("book_progress")
      .update({
        cursor_index:
          advanced.session.status === "completed" ? advanced.cursorIndex : progress.cursor_index,
        session_state: advanced.session,
        revision: nextRevision,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", context.userId)
      .eq("book_id", data.bookId)
      .eq("mode", "memorize")
      .eq("revision", progress.revision)
      .select("cursor_index, revision, session_state")
      .maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (!updated) {
      const { data: latest, error: latestError } = await context.supabase
        .from("book_progress")
        .select("cursor_index, revision, session_state")
        .eq("user_id", context.userId)
        .eq("book_id", data.bookId)
        .eq("mode", "memorize")
        .single();
      if (latestError) throw new Error(latestError.message);
      return {
        session: parseMemorizeSession(latest.session_state),
        revision: latest.revision,
        cursorIndex: latest.cursor_index,
        accepted: false,
        rounds,
      };
    }

    return {
      session: parseMemorizeSession(updated.session_state),
      revision: updated.revision,
      cursorIndex: updated.cursor_index,
      accepted: true,
      rounds,
    };
  });

const StartSentenceInput = z.object({
  bookId: z.string().min(1),
  cursorIndex: z.number().int().min(0),
  expectedRevision: z.number().int().min(0),
  queueLength: z.number().int().positive(),
  activeWord: z.string().min(1),
});

function sentenceProgressResult(
  row: { cursor_index: number; revision: number; session_state: unknown },
  accepted: boolean,
) {
  return {
    cursorIndex: row.cursor_index,
    revision: row.revision,
    checkpoint: parseSentenceCheckpoint(row.session_state),
    accepted,
    attempt: null,
  };
}

export const startSentenceCheckpoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => StartSentenceInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: current, error } = await context.supabase
      .from("book_progress")
      .select("cursor_index, revision, session_state")
      .eq("user_id", context.userId)
      .eq("book_id", data.bookId)
      .eq("mode", "sentence")
      .maybeSingle();
    if (error) throw new Error(error.message);

    const cursorIndex = current
      ? current.cursor_index % data.queueLength
      : data.cursorIndex % data.queueLength;
    const revision = current?.revision ?? 0;
    const checkpoint = parseSentenceCheckpoint(current?.session_state);
    if (current && revision !== data.expectedRevision)
      return sentenceProgressResult(current, false);
    if (
      current &&
      checkpoint &&
      checkpoint.queueLength === data.queueLength &&
      checkpoint.activeWord === data.activeWord &&
      cursorIndex === current.cursor_index
    )
      return sentenceProgressResult(current, true);

    const nextCheckpoint: SentenceCheckpoint = {
      version: 1,
      kind: "sentence",
      attemptId: globalThis.crypto.randomUUID(),
      activeWord: data.activeWord,
      queueLength: data.queueLength,
    };
    const nextRevision = revision + (current ? 1 : 0);
    if (!current) {
      const { error: insertError } = await context.supabase.from("book_progress").insert({
        user_id: context.userId,
        book_id: data.bookId,
        mode: "sentence",
        cursor_index: cursorIndex,
        session_state: nextCheckpoint,
        revision: 0,
        updated_at: new Date().toISOString(),
      });
      if (insertError) {
        if (insertError.code !== "23505") throw new Error(insertError.message);
        const { data: winner, error: winnerError } = await context.supabase
          .from("book_progress")
          .select("cursor_index, revision, session_state")
          .eq("user_id", context.userId)
          .eq("book_id", data.bookId)
          .eq("mode", "sentence")
          .single();
        if (winnerError) throw new Error(winnerError.message);
        return sentenceProgressResult(winner, false);
      }
      return sentenceProgressResult(
        { cursor_index: cursorIndex, revision: 0, session_state: nextCheckpoint },
        true,
      );
    }

    if (revision !== data.expectedRevision) return sentenceProgressResult(current, false);
    const { data: updated, error: updateError } = await context.supabase
      .from("book_progress")
      .update({
        cursor_index: cursorIndex,
        session_state: nextCheckpoint,
        revision: nextRevision,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", context.userId)
      .eq("book_id", data.bookId)
      .eq("mode", "sentence")
      .eq("revision", revision)
      .select("cursor_index, revision, session_state")
      .maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (updated) return sentenceProgressResult(updated, true);
    const { data: latest, error: latestError } = await context.supabase
      .from("book_progress")
      .select("cursor_index, revision, session_state")
      .eq("user_id", context.userId)
      .eq("book_id", data.bookId)
      .eq("mode", "sentence")
      .single();
    if (latestError) throw new Error(latestError.message);
    return sentenceProgressResult(latest, false);
  });

const CompleteSentenceInput = z.object({
  bookId: z.string().min(1),
  word: z.string().min(1),
  nextWord: z.string().min(1),
  translation: z.string().optional(),
  attemptId: z.string().uuid(),
  revision: z.number().int().min(0),
  queueLength: z.number().int().positive(),
  correct: z.boolean(),
  mistouch: z.boolean(),
  typoCount: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  skipped: z.boolean().optional(),
});

export const completeSentenceCheckpoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CompleteSentenceInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: progress, error: progressError } = await context.supabase
      .from("book_progress")
      .select("cursor_index, revision, session_state")
      .eq("user_id", context.userId)
      .eq("book_id", data.bookId)
      .eq("mode", "sentence")
      .maybeSingle();
    if (progressError) throw new Error(progressError.message);
    if (!progress) throw new Error("Sentence checkpoint is missing; reload the page");
    const currentCheckpoint = parseSentenceCheckpoint(progress.session_state);
    const { data: existingAttempt, error: attemptLookupError } = await context.supabase
      .from("attempts")
      .select("id, book_id, word, mode, correct, mistouch, typo_count, duration_ms, skipped")
      .eq("id", data.attemptId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (attemptLookupError) throw new Error(attemptLookupError.message);

    const isCurrent =
      currentCheckpoint?.attemptId === data.attemptId &&
      currentCheckpoint.activeWord === data.word &&
      currentCheckpoint.queueLength === data.queueLength &&
      progress.revision === data.revision;
    if (!isCurrent) {
      if (
        existingAttempt &&
        existingAttempt.book_id === data.bookId &&
        existingAttempt.word === data.word &&
        existingAttempt.mode === "sentence"
      )
        return sentenceProgressResult(progress, false);
      return sentenceProgressResult(progress, false);
    }
    if (
      existingAttempt &&
      (existingAttempt.book_id !== data.bookId ||
        existingAttempt.word !== data.word ||
        existingAttempt.mode !== "sentence")
    )
      throw new Error("Attempt id is already associated with a different learning entry");

    let storedAttempt = existingAttempt;
    if (!storedAttempt) {
      const { error: insertError } = await context.supabase.from("attempts").insert({
        id: data.attemptId,
        user_id: context.userId,
        mode: "sentence",
        book_id: data.bookId,
        word: data.word,
        translation: data.translation ?? null,
        correct: data.correct,
        mistouch: data.mistouch,
        typo_count: data.typoCount,
        duration_ms: data.durationMs,
        is_review: false,
        skipped: data.skipped ?? false,
        review_mode: null,
        counted_for_review: false,
        hint_count: 0,
      });
      if (insertError && insertError.code !== "23505") throw new Error(insertError.message);
      const { data: stored, error: storedError } = await context.supabase
        .from("attempts")
        .select("id, book_id, word, mode, correct, mistouch, typo_count, duration_ms, skipped")
        .eq("id", data.attemptId)
        .eq("user_id", context.userId)
        .single();
      if (storedError) throw new Error(storedError.message);
      storedAttempt = stored;
    }

    const nextCursor = (progress.cursor_index + 1) % data.queueLength;
    const nextCheckpoint: SentenceCheckpoint = {
      version: 1,
      kind: "sentence",
      attemptId: globalThis.crypto.randomUUID(),
      activeWord: data.nextWord,
      queueLength: data.queueLength,
    };
    const { data: updated, error: updateError } = await context.supabase
      .from("book_progress")
      .update({
        cursor_index: nextCursor,
        session_state: nextCheckpoint,
        revision: progress.revision + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", context.userId)
      .eq("book_id", data.bookId)
      .eq("mode", "sentence")
      .eq("revision", progress.revision)
      .select("cursor_index, revision, session_state")
      .maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (updated) return { ...sentenceProgressResult(updated, true), attempt: storedAttempt };
    const { data: latest, error: latestError } = await context.supabase
      .from("book_progress")
      .select("cursor_index, revision, session_state")
      .eq("user_id", context.userId)
      .eq("book_id", data.bookId)
      .eq("mode", "sentence")
      .single();
    if (latestError) throw new Error(latestError.message);
    return { ...sentenceProgressResult(latest, false), attempt: storedAttempt };
  });

export const getLearningState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LearningState> => {
    const [settingsRes, progressRes, attemptsRes, masteryRes, bookReviewSettingsRes] = await Promise.all([
      context.supabase
        .from("user_settings")
        .select(
          "daily_goal, active_book, memorize_spelling, strict_spelling, include_spelling_in_review, share_review_progress",
        )
        .eq("user_id", context.userId)
        .maybeSingle(),
      context.supabase
        .from("book_progress")
        .select("book_id, mode, cursor_index, revision, session_state")
        .eq("user_id", context.userId),
      context.supabase
        .from("attempts")
        .select("id, word, translation, book_id, typo_count, mistouch, correct, skipped, created_at")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(2000),
      context.supabase
        .from("word_mastery")
        .select("word, book_id")
        .eq("user_id", context.userId)
        .gte("rounds", 3),
      context.supabase
        .from("user_book_review_settings")
        .select("book_id, include_in_review")
        .eq("user_id", context.userId),
    ]);

    const errors = [
      settingsRes.error,
      progressRes.error,
      attemptsRes.error,
      masteryRes.error,
      bookReviewSettingsRes.error,
    ].flatMap((error) => (error ? [error.message] : []));
    if (errors.length) throw new Error(errors.join("; "));
    return buildLearningState({
      settings: settingsRes.data,
      progress: (progressRes.data ?? []).map((row) => ({ ...row, mode: row.mode as LearningMode })),
      attempts: (attemptsRes.data ?? []) as LearningAttemptRow[],
      mastery: masteryRes.data ?? [],
      bookReviewSettings: bookReviewSettingsRes.data ?? [],
    });
  });

export const getLearningProblems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LearningProblems> => {
    const { data: settings, error: settingsError } = await context.supabase
      .from("user_settings")
      .select("share_review_progress")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (settingsError) throw new Error(settingsError.message);

    const errors: LearningAttemptRow[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await context.supabase
        .from("attempts")
        .select("id, word, book_id, translation, typo_count, mistouch, correct, skipped, created_at")
        .eq("user_id", context.userId)
        .eq("skipped", false)
        .eq("mistouch", false)
        .or("correct.eq.false,typo_count.gt.0")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + 999);
      if (error) throw new Error(error.message);
      errors.push(...((data ?? []) as LearningAttemptRow[]));
      if (!data || data.length < 1000) break;
    }
    return buildLearningProblems(errors, settings?.share_review_progress ?? true);
  });

export const getDueReviewItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        reviewMode: z.enum(["recognition", "spelling"]),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: settings, error: settingsError } = await context.supabase
      .from("user_settings")
      .select("share_review_progress")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (settingsError) throw new Error(settingsError.message);
    let query = context.supabase
      .from("review_states")
      .select(
        "word, word_key, review_mode, scope_key, source_book_id, last_reviewed_at, next_due_at, interval_seconds, consecutive_correct, total_wrong, hint_count, difficulty, scheduler_data, last_attempt_id, revision, updated_at",
      )
      .eq("user_id", context.userId)
      .eq("review_mode", data.reviewMode);
    query = settings?.share_review_progress === false
      ? query.like("scope_key", "book:%")
      : query.eq("scope_key", "shared");
    const { data: dueItems, error } = await query
      .lte("next_due_at", new Date().toISOString())
      .order("next_due_at", { ascending: true })
      .limit(data.limit ?? 100);
    if (error) throw new Error(error.message);
    // The source is provenance, not part of Review identity. It may name a bundled or deleted book.
    return (dueItems ?? []).map((item) => ({
      ...item,
      bookId: item.source_book_id ??
        (item.scope_key.startsWith("book:") ? item.scope_key.slice(5) : null) ?? "review:unattributed",
    }));
  });

export const getDueReviewCount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: settings, error: settingsError } = await context.supabase
      .from("user_settings")
      .select("share_review_progress")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (settingsError) throw new Error(settingsError.message);
    let query = context.supabase
      .from("review_states")
      .select("word_key", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .lte("next_due_at", new Date().toISOString());
    query = settings?.share_review_progress === false
      ? query.like("scope_key", "book:%")
      : query.eq("scope_key", "shared");
    const { count, error } = await query;
    if (error) throw new Error(error.message);
    return count ?? 0;
  });

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        dailyGoal: z.number().int().min(5).max(300).optional(),
        activeBook: z.string().optional(),
        memorizeSpelling: z.boolean().optional(),
        strictSpelling: z.boolean().optional(),
        includeSpellingInReview: z.boolean().nullable().optional(),
        shareReviewProgress: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const patch: {
      user_id: string;
      updated_at: string;
      daily_goal?: number;
      active_book?: string;
      memorize_spelling?: boolean;
      strict_spelling?: boolean;
      include_spelling_in_review?: boolean | null;
      include_spelling_in_review_first_choice?: boolean | null;
      share_review_progress?: boolean;
    } = {
      user_id: context.userId,
      updated_at: new Date().toISOString(),
    };
    if (data.dailyGoal !== undefined) patch.daily_goal = data.dailyGoal;
    if (data.activeBook !== undefined) patch.active_book = data.activeBook;
    if (data.memorizeSpelling !== undefined) patch.memorize_spelling = data.memorizeSpelling;
    if (data.strictSpelling !== undefined) patch.strict_spelling = data.strictSpelling;
    if (data.includeSpellingInReview !== undefined)
      patch.include_spelling_in_review = data.includeSpellingInReview;
    let shouldRebuildPendingSpelling = false;
    let shouldRebuildAllReviewScopes = false;
    if (data.includeSpellingInReview !== undefined) {
      const { data: previousSettings, error: previousError } = await context.supabase
        .from("user_settings")
        .select("include_spelling_in_review_first_choice")
        .eq("user_id", context.userId)
        .maybeSingle();
      if (previousError) throw new Error(previousError.message);
      const firstChoice = captureFirstSpellingReviewChoice(
        previousSettings?.include_spelling_in_review_first_choice,
        data.includeSpellingInReview,
      );
      patch.include_spelling_in_review_first_choice = firstChoice;
      // Explicit retry remains self-healing if a prior projection write failed after saving the preference.
      shouldRebuildPendingSpelling = true;
    }
    if (data.shareReviewProgress !== undefined) {
      patch.share_review_progress = data.shareReviewProgress;
      shouldRebuildAllReviewScopes = true;
    }
    const { error } = await context.supabase
      .from("user_settings")
      .upsert(patch, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    if (shouldRebuildPendingSpelling)
      await rebuildPendingSpellingStates(context.supabase, context.userId);
    if (shouldRebuildAllReviewScopes)
      await rebuildReviewProjectionsForUser(context.supabase, context.userId);
    return { ok: true };
  });

export const saveBookReviewSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ bookId: z.string().trim().min(1), includeInReview: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("user_book_review_settings").upsert(
      {
        user_id: context.userId,
        book_id: data.bookId,
        include_in_review: data.includeInReview,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,book_id" },
    );
    if (error) throw new Error(error.message);
    await rebuildReviewProjectionsForBook(context.supabase, context.userId, data.bookId);
    return { ok: true };
  });

export const saveBookCursor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        bookId: z.string(),
        mode: z.enum(["word", "sentence", "memorize"]),
        cursorIndex: z.number().int().min(0),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("book_progress").upsert(
      {
        user_id: context.userId,
        book_id: data.bookId,
        mode: data.mode,
        cursor_index: data.cursorIndex,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,book_id,mode" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LearningStats> => {
    const settings = await context.supabase
      .from("user_settings")
      .select("share_review_progress")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (settings.error) throw new Error(settings.error.message);

    const attempts: LearningAttemptRow[] = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await context.supabase
        .from("attempts")
        .select(
          "id, word, book_id, translation, mode, typo_count, mistouch, correct, skipped, created_at",
        )
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + 999);
      if (page.error) throw new Error(page.error.message);
      attempts.push(...((page.data ?? []) as LearningAttemptRow[]));
      if (!page.data || page.data.length < 1000) break;
    }
    return buildLearningStats(
      attempts,
      new Date(),
      settings.data?.share_review_progress ?? true,
    );
  });

export const getMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("assistant_messages")
      .select("id, role, content, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const clearMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("assistant_messages")
      .delete()
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** AI 助手总开关：false 时完全不调用任何模型 */
export const AI_ASSISTANT_ENABLED = false;

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ content: z.string().min(1).max(2000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    // AI 助手已暂停：不调用任何模型
    if (AI_ASSISTANT_ENABLED === false) {
      void data;
      void context;
      throw new Error("AI 助手已暂停");
    }
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("AI 服务暂未配置");

    const [{ data: history }, { data: rows }, { data: mastery }] = await Promise.all([
      context.supabase
        .from("assistant_messages")
        .select("role, content")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: true })
        .limit(40),
      context.supabase
        .from("attempts")
        .select("id, word, book_id, translation, correct, typo_count, mistouch, mode, skipped, created_at")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(200),
      context.supabase
        .from("word_mastery")
        .select("word, book_id, translation, rounds, context_ok, recall_ok, spell_ok")
        .eq("user_id", context.userId)
        .order("updated_at", { ascending: false })
        .limit(120),
    ]);

    const allRows = rows ?? [];
    const attempts = allRows.filter((r) => !r.skipped);
    const distinctEntries = (items: { book_id: string; word: string }[]) => [
      ...new Map(
        items.map((r) => [
          entryKey({ bookId: r.book_id, word: r.word }),
          `${r.book_id} / ${r.word}`,
        ]),
      ).values(),
    ];
    const skippedWords = distinctEntries(allRows.filter((r) => r.skipped)).slice(0, 30);
    const today = new Date().toLocaleDateString("en-CA");
    const todayWords = distinctEntries(
      attempts.filter((r) => new Date(r.created_at).toLocaleDateString("en-CA") === today),
    );
    const wrongWords = distinctEntries(
      attempts.filter((r) => (r.typo_count > 0 || !r.correct) && !r.mistouch),
    ).slice(0, 20);
    const learned = distinctEntries(attempts).slice(0, 60);
    const masteryRows = mastery ?? [];
    const mastered = masteryRows
      .filter((m) => m.rounds >= 3)
      .map((m) => `${m.book_id} / ${m.word}`);
    const inProgress = masteryRows
      .filter((m) => m.rounds > 0 && m.rounds < 3)
      .map((m) => {
        const missing = [
          m.context_ok ? null : "语境选义",
          m.recall_ok ? null : "词义回忆",
          m.spell_ok ? null : "拼写",
        ].filter(Boolean);
        return `${m.book_id} / ${m.word}(还差：${missing.join("、")})`;
      })
      .slice(0, 30);

    const system = [
      "你是一个中文用户的英语学习助手，熟悉用户的真实学习记录。",
      "回答使用简体中文，语气自然、简洁、有条理，必要时用列表。英文单词与例句保留英文。",
      "尽量结合用户真实学过的词汇作答；数据中没有的内容不要编造。",
      `今天学过的词(${todayWords.length})：${todayWords.join(", ") || "暂无"}`,
      `经常出错的词：${wrongWords.join(", ") || "暂无"}`,
      `主动跳过(skipped)的词：${skippedWords.join(", ") || "暂无"}（跳过不算错误，也不算误触）`,
      `已学过的词：${learned.join(", ") || "暂无"}`,
      `累计练习次数：${attempts.length}`,
      "背单词模式共三轮强化：1) 语境中选中文释义 2) 只看单词选中文释义 3) 拼写。",
      `已完成三轮强化学习的词(${mastered.length})：${mastered.slice(0, 40).join(", ") || "暂无"}`,
      `三轮尚未完成的词：${inProgress.join(", ") || "暂无"}`,
      "回答中可以据此判断哪些词已被真正巩固、哪些还需要再练。",
    ].join("\n");

    await context.supabase
      .from("assistant_messages")
      .insert({ user_id: context.userId, role: "user", content: data.content });

    const { streamText } = await import("ai");
    const { createOpenAI } = await import("@ai-sdk/openai");
    const lovable = createOpenAI({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey: key,
      headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    });

    const result = streamText({
      model: lovable.responses("openai/gpt-6-astra"),
      system,
      messages: [
        ...(history ?? []).map((m) => ({
          role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: m.content,
        })),
        { role: "user" as const, content: data.content },
      ],
      providerOptions: {
        openai: {
          forceReasoning: true,
          reasoningEffort: "low",
          reasoningSummary: "auto",
          store: false,
          include: ["reasoning.encrypted_content"],
        },
      },
    });

    const text = (await result.text) || "（这次没有生成内容，请再试一次）";

    await context.supabase
      .from("assistant_messages")
      .insert({ user_id: context.userId, role: "assistant", content: text });

    return { reply: text };
  });
