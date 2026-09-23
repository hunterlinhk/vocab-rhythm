import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const AttemptInput = z.object({
  mode: z.enum(["word", "sentence"]),
  bookId: z.string(),
  word: z.string(),
  translation: z.string().optional(),
  correct: z.boolean(),
  mistouch: z.boolean(),
  typoCount: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  isReview: z.boolean().optional(),
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
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type LearningState = {
  dailyGoal: number;
  activeBook: string;
  cursors: Record<string, number>;
  learnedByBook: Record<string, string[]>;
  learnedWords: string[];
  todayWords: string[];
  wrongWords: { word: string; translation: string | null }[];
  troubleWords: { word: string; translation: string | null; typos: number }[];
  mistouchWords: { word: string; translation: string | null; at: string }[];
};

export const getLearningState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LearningState> => {
    const [settingsRes, progressRes, attemptsRes] = await Promise.all([
      context.supabase
        .from("user_settings")
        .select("daily_goal, active_book")
        .eq("user_id", context.userId)
        .maybeSingle(),
      context.supabase.from("book_progress").select("book_id, cursor_index").eq("user_id", context.userId),
      context.supabase
        .from("attempts")
        .select("word, translation, book_id, typo_count, mistouch, correct, created_at")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(2000),
    ]);

    const rows = attemptsRes.data ?? [];
    const today = new Date().toLocaleDateString("en-CA");

    const cursors: Record<string, number> = {};
    for (const p of progressRes.data ?? []) cursors[p.book_id] = p.cursor_index;

    const learnedByBook: Record<string, string[]> = {};
    for (const r of rows) {
      const list = (learnedByBook[r.book_id] ??= []);
      if (!list.includes(r.word)) list.push(r.word);
    }

    const wrong = new Map<string, { word: string; translation: string | null }>();
    const trouble = new Map<string, { word: string; translation: string | null; typos: number }>();
    const mistouch: { word: string; translation: string | null; at: string }[] = [];
    for (const r of rows) {
      if (r.mistouch) {
        if (mistouch.length < 40) mistouch.push({ word: r.word, translation: r.translation, at: r.created_at });
        continue;
      }
      if (r.correct === false) wrong.set(r.word, { word: r.word, translation: r.translation });
      if (r.typo_count > 0) {
        const cur = trouble.get(r.word) ?? { word: r.word, translation: r.translation, typos: 0 };
        cur.typos += r.typo_count;
        trouble.set(r.word, cur);
      }
    }

    return {
      dailyGoal: settingsRes.data?.daily_goal ?? 20,
      activeBook: settingsRes.data?.active_book ?? "core",
      cursors,
      learnedByBook,
      learnedWords: [...new Set(rows.map((r) => r.word))],
      todayWords: [
        ...new Set(rows.filter((r) => new Date(r.created_at).toLocaleDateString("en-CA") === today).map((r) => r.word)),
      ],
      wrongWords: [...wrong.values()].slice(0, 60),
      troubleWords: [...trouble.values()].sort((a, b) => b.typos - a.typos).slice(0, 60),
      mistouchWords: mistouch,
    };
  });

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ dailyGoal: z.number().int().min(5).max(300).optional(), activeBook: z.string().optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const patch: { user_id: string; updated_at: string; daily_goal?: number; active_book?: string } = {
      user_id: context.userId,
      updated_at: new Date().toISOString(),
    };
    if (data.dailyGoal !== undefined) patch.daily_goal = data.dailyGoal;
    if (data.activeBook !== undefined) patch.active_book = data.activeBook;
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

export type LearningStats = {
  todayCount: number;
  todayWords: string[];
  totalCount: number;
  uniqueWords: number;
  cleanRate: number;
  streakDays: number;
  troubleWords: { word: string; translation: string | null; typos: number; times: number }[];
  recent: { word: string; translation: string | null; mode: string; typos: number; mistouch: boolean; at: string }[];
};

export const getStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LearningStats> => {
    const { data, error } = await context.supabase
      .from("attempts")
      .select("word, translation, mode, typo_count, mistouch, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    const rows = data ?? [];

    const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA");
    const today = new Date().toLocaleDateString("en-CA");
    const todayRows = rows.filter((r) => dayKey(r.created_at) === today);

    const trouble = new Map<string, { word: string; translation: string | null; typos: number; times: number }>();
    for (const r of rows) {
      const cur = trouble.get(r.word) ?? { word: r.word, translation: r.translation, typos: 0, times: 0 };
      cur.typos += r.mistouch ? 0 : r.typo_count;
      cur.times += 1;
      trouble.set(r.word, cur);
    }

    const days = new Set(rows.map((r) => dayKey(r.created_at)));
    let streak = 0;
    const cursor = new Date();
    for (;;) {
      const key = cursor.toLocaleDateString("en-CA");
      if (days.has(key)) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
      } else if (streak === 0 && key === today) {
        cursor.setDate(cursor.getDate() - 1);
      } else break;
    }

    const clean = rows.filter((r) => r.typo_count === 0 || r.mistouch).length;

    return {
      todayCount: todayRows.length,
      todayWords: [...new Set(todayRows.map((r) => r.word))],
      totalCount: rows.length,
      uniqueWords: new Set(rows.map((r) => r.word)).size,
      cleanRate: rows.length ? Math.round((clean / rows.length) * 100) : 0,
      streakDays: streak,
      troubleWords: [...trouble.values()].filter((t) => t.typos > 0).sort((a, b) => b.typos - a.typos).slice(0, 8),
      recent: rows.slice(0, 20).map((r) => ({
        word: r.word,
        translation: r.translation,
        mode: r.mode,
        typos: r.typo_count,
        mistouch: r.mistouch,
        at: r.created_at,
      })),
    };
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

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ content: z.string().min(1).max(2000) }).parse(input))
  .handler(async ({ data, context }) => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("AI 服务暂未配置");

    const [{ data: history }, { data: rows }] = await Promise.all([
      context.supabase
        .from("assistant_messages")
        .select("role, content")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: true })
        .limit(40),
      context.supabase
        .from("attempts")
        .select("word, translation, typo_count, mistouch, mode, created_at")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    const attempts = rows ?? [];
    const today = new Date().toLocaleDateString("en-CA");
    const todayWords = [
      ...new Set(attempts.filter((r) => new Date(r.created_at).toLocaleDateString("en-CA") === today).map((r) => r.word)),
    ];
    const wrongWords = [
      ...new Set(attempts.filter((r) => r.typo_count > 0 && !r.mistouch).map((r) => r.word)),
    ].slice(0, 20);
    const learned = [...new Set(attempts.map((r) => r.word))].slice(0, 60);

    const system = [
      "你是一个中文用户的英语学习助手，熟悉用户的真实学习记录。",
      "回答使用简体中文，语气自然、简洁、有条理，必要时用列表。英文单词与例句保留英文。",
      "尽量结合用户真实学过的词汇作答；数据中没有的内容不要编造。",
      `今天学过的词(${todayWords.length})：${todayWords.join(", ") || "暂无"}`,
      `经常出错的词：${wrongWords.join(", ") || "暂无"}`,
      `已学过的词：${learned.join(", ") || "暂无"}`,
      `累计练习次数：${attempts.length}`,
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
