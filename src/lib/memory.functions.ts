import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { isValidIanaTimeZone } from "@/lib/learning-state.shared";
import { learningDayAt, normalizeReviewWord } from "@/lib/review-scheduler.shared";
import { planMemory, projectMemory, MEMORY_MODEL_VERSION, type MemoryObservation } from "@/lib/memory-engine.shared";

/** Read-only, authenticated v2 shadow model API. Never mutates the legacy scheduler. */
const SnapshotInput = z.object({
  timeZone: z.string().min(1).max(100).refine(isValidIanaTimeZone).default("UTC"),
  timeBudgetMinutes: z.number().int().min(1).max(180).default(15),
  targetRetention: z.number().min(0.75).max(0.97).default(0.9),
  word: z.string().trim().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

export const getMemorySnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SnapshotInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString();
    const [{ data: settings, error: settingsError }, { data: bookSettings, error: bookError }] = await Promise.all([
      context.supabase.from("user_settings").select("daily_goal, active_book, share_review_progress")
        .eq("user_id", context.userId).maybeSingle(),
      context.supabase.from("user_book_review_settings").select("book_id, include_in_review")
        .eq("user_id", context.userId),
    ]);
    if (settingsError) throw new Error(settingsError.message);
    if (bookError) throw new Error(bookError.message);
    const excludedBooks = new Set((bookSettings ?? []).filter((r) => !r.include_in_review).map((r) => r.book_id));
    const shareAcrossBooks = settings?.share_review_progress ?? true;
    const observations: MemoryObservation[] = [];
    let todayCompleted = 0;
    let reviewedRawRows = 0;
    // Bounded scan: coverage explicitly reports if complete history was unavailable.
    const PAGE = 1000;
    const MAX_ROWS = 10000;
    const today = learningDayAt(now, data.timeZone);
    let hasMore = false;
    for (let offset = 0; offset <= MAX_ROWS; offset += PAGE) {
      const { data: rows, error } = await context.supabase.from("attempts")
        .select("id, word, book_id, mode, session_stage, review_mode, counted_for_review, correct, skipped, mistouch, typo_count, hint_count, duration_ms, prompt_visibility, created_at, time_zone")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false }).order("id", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(error.message);
      if (offset === MAX_ROWS) { hasMore = (rows?.length ?? 0) > 0; break; }
      if (!rows?.length) break;
      reviewedRawRows += rows.length;
      for (const r of rows) {
        if (r.skipped || r.mistouch) continue;
        if (learningDayAt(r.created_at, data.timeZone) === today) todayCompleted++;
        if (r.counted_for_review === false || excludedBooks.has(r.book_id)) continue;
        const wordKey = normalizeReviewWord(r.word);
        if (!wordKey) continue;
        const skill = r.review_mode === "recognition" && r.session_stage === "recall" ? "recognition" :
          r.review_mode === "spelling" && r.mode === "word" ? "spelling" : null;
        if (!skill) continue;
        observations.push({
          id: r.id, word: r.word, bookId: r.book_id,
          scopeKey: shareAcrossBooks ? "shared" : "book:" + r.book_id,
          skill, at: r.created_at, correct: r.correct,
          typoCount: Math.max(0, r.typo_count), hintCount: Math.max(0, r.hint_count),
          durationMs: r.duration_ms > 0 ? r.duration_ms : null,
          prompt: skill === "recognition" ? "choice" :
            r.prompt_visibility === "masked" ? "masked" : r.prompt_visibility === "visible" ? "visible" : "unknown",
        });
      }
      if (rows.length < PAGE) break;
    }
    const projected = projectMemory(observations, now, data.targetRetention);
    const dailyGoal = settings?.daily_goal ?? 20;
    const plan = planMemory({ states: projected.states, now, dailyGoal, todayCompleted,
      timeBudgetMinutes: data.timeBudgetMinutes, targetRetention: data.targetRetention });
    const word = data.word ? normalizeReviewWord(data.word) : null;
    const requested = word ? projected.states.filter((s) => normalizeReviewWord(s.word) === word) : projected.states;
    return {
      schemaVersion: 1 as const,
      modelVersion: MEMORY_MODEL_VERSION,
      generatedAt: now,
      learningScope: shareAcrossBooks ? "shared" as const : "per_book" as const,
      states: requested.slice(0, data.limit),
      totalModeledStates: projected.states.length,
      calibration: projected.calibration,
      plan,
      dataCoverage: {
        scannedAttempts: reviewedRawRows,
        truncated: hasMore,
        excludedVisibleOrUnknownSpelling: projected.ignoredCopyEvents,
        predictionIsValidated: projected.calibration.some((s) => s.sampleSize >= 30),
        limitations: [
          "Recognition is multiple-choice success, not free recall; guessing remains possible.",
          "Independent spelling requires prompt_visibility=masked. Earlier visible/unknown attempts are excluded.",
          "Only first clean unassisted responses after >=24h contribute to forward-calibration; missing attempts cannot be inferred.",
        ],
      },
    };
  });