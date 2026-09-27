import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { entryKey } from "@/lib/entry-identity";
import { buildLearningState, buildLearningStats, type LearningAttemptRow, type LearningState, type LearningStats } from "@/lib/learning-state.shared";

export type { LearningState, LearningStats };

const AttemptInput = z.object({
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
});

export const recordAttempt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AttemptInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("attempts").insert({
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
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** marks the most recent attempt of a word as a mistouch (used by the strict-spelling review panel) */
export const markAttemptMistouch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ word: z.string(), bookId: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const q = context.supabase
      .from("attempts")
      .select("id, typo_count")
      .eq("user_id", context.userId)
      .eq("word", data.word)
      .eq("book_id", data.bookId);
    const { data: row } = await q
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!row) return { ok: false };
    const { error } = await context.supabase
      .from("attempts")
      .update({ mistouch: true, typo_count: Math.max(0, (row.typo_count ?? 0) - 1) })
      .eq("id", row.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const StageInput = z.object({
  word: z.string(),
  bookId: z.string(),
  translation: z.string().optional(),
  stage: z.enum(["context", "recall", "spell"]),
  correct: z.boolean(),
  typoCount: z.number().int().min(0).optional(),
  durationMs: z.number().int().min(0).optional(),
});

/** records one reinforcement round of the 背单词 flow (context → recall → spell) */
export const recordMemorizeStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => StageInput.parse(input))
  .handler(async ({ data, context }) => {
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
    if (data.correct) {
      if (data.stage === "context") flags.context_ok = true;
      if (data.stage === "recall") flags.recall_ok = true;
      if (data.stage === "spell") flags.spell_ok = true;
    }
    const rounds = Number(flags.context_ok) + Number(flags.recall_ok) + Number(flags.spell_ok);

    const { data: attempt, error: attemptError } = await context.supabase
      .from("attempts")
      .insert({
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
      })
      .select("id")
      .single();
    if (attemptError) throw new Error(attemptError.message);

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
    if (masteryError) {
      const { error: rollbackError } = await context.supabase
        .from("attempts")
        .delete()
        .eq("id", attempt.id)
        .eq("user_id", context.userId);
      if (rollbackError)
        throw new Error(`${masteryError.message}; attempt rollback also failed: ${rollbackError.message}`);
      throw new Error(masteryError.message);
    }

    return { rounds };
  });

export const getLearningState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LearningState> => {
    const [settingsRes, progressRes, attemptsRes, masteryRes] = await Promise.all([
      context.supabase
        .from("user_settings")
        .select("daily_goal, active_book, memorize_spelling, strict_spelling")
        .eq("user_id", context.userId)
        .maybeSingle(),
      context.supabase.from("book_progress").select("book_id, cursor_index").eq("user_id", context.userId),
      context.supabase
        .from("attempts")
        .select("word, translation, book_id, typo_count, mistouch, correct, skipped, created_at")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(2000),
      context.supabase
        .from("word_mastery")
        .select("word, book_id")
        .eq("user_id", context.userId)
        .gte("rounds", 3),
    ]);

    const errors = [settingsRes.error, progressRes.error, attemptsRes.error, masteryRes.error]
      .flatMap((error) => error ? [error.message] : []);
    if (errors.length) throw new Error(errors.join("; "));
    return buildLearningState({
      settings: settingsRes.data,
      progress: progressRes.data ?? [],
      attempts: (attemptsRes.data ?? []) as LearningAttemptRow[],
      mastery: masteryRes.data ?? [],
    });
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
    } = {
      user_id: context.userId,
      updated_at: new Date().toISOString(),
    };
    if (data.dailyGoal !== undefined) patch.daily_goal = data.dailyGoal;
    if (data.activeBook !== undefined) patch.active_book = data.activeBook;
    if (data.memorizeSpelling !== undefined) patch.memorize_spelling = data.memorizeSpelling;
    if (data.strictSpelling !== undefined) patch.strict_spelling = data.strictSpelling;
    const { error } = await context.supabase.from("user_settings").upsert(patch, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveBookCursor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ bookId: z.string(), cursorIndex: z.number().int().min(0) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("book_progress").upsert(
      {
        user_id: context.userId,
        book_id: data.bookId,
        cursor_index: data.cursorIndex,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,book_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LearningStats> => {
    const { data, error } = await context.supabase
      .from("attempts")
      .select("word, book_id, translation, mode, typo_count, mistouch, correct, skipped, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    return buildLearningStats((data ?? []) as LearningAttemptRow[]);
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
    const { error } = await context.supabase.from("assistant_messages").delete().eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** AI 助手总开关：false 时完全不调用任何模型 */
export const AI_ASSISTANT_ENABLED = false;

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ content: z.string().min(1).max(2000) }).parse(input))
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
        .select("word, book_id, translation, typo_count, mistouch, mode, skipped, created_at")
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
    const distinctEntries = (items: { book_id: string; word: string }[]) =>
      [...new Map(items.map((r) => [entryKey({ bookId: r.book_id, word: r.word }), `${r.book_id} / ${r.word}`])).values()];
    const skippedWords = distinctEntries(allRows.filter((r) => r.skipped)).slice(0, 30);
    const today = new Date().toLocaleDateString("en-CA");
    const todayWords = distinctEntries(attempts.filter((r) => new Date(r.created_at).toLocaleDateString("en-CA") === today));
    const wrongWords = distinctEntries(attempts.filter((r) => r.typo_count > 0 && !r.mistouch)).slice(0, 20);
    const learned = distinctEntries(attempts).slice(0, 60);
    const masteryRows = mastery ?? [];
    const mastered = masteryRows.filter((m) => m.rounds >= 3).map((m) => `${m.book_id} / ${m.word}`);
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
