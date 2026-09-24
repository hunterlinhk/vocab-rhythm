import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { ENTRY_COLS, EntryInput, rowToEntry, type BookMeta, type EntryRow } from "./library.shared";
import type { WordEntry } from "@/data/words";

/** 官方词库（数据库中的正式词库）+ 当前用户的自定义词库 */
export const listLibrary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ official: BookMeta[]; custom: BookMeta[] }> => {
    const { data, error } = await context.supabase
      .from("word_books")
      .select("id, name, description, source, owner_user_id, word_count, created_at, updated_at")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as BookMeta[];
    return {
      official: rows.filter((b) => b.source === "official"),
      custom: rows.filter((b) => b.source === "custom" && b.owner_user_id === context.userId),
    };
  });

export const getBookEntries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ bookId: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }): Promise<WordEntry[]> => {
    const out: WordEntry[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: rows, error } = await context.supabase
        .from("word_entries")
        .select(ENTRY_COLS)
        .eq("book_id", data.bookId)
        .order("position", { ascending: true })
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      out.push(...((rows ?? []) as EntryRow[]).map(rowToEntry));
      if (!rows || rows.length < 1000) break;
    }
    return out;
  });

/** 按 (book_id, word) 取回数据库词条，用于跨词书的复习队列 */
export const resolveEntries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ items: z.array(z.object({ bookId: z.string(), word: z.string() })).max(500) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<WordEntry[]> => {
    const byBook = new Map<string, string[]>();
    for (const it of data.items) (byBook.get(it.bookId) ?? byBook.set(it.bookId, []).get(it.bookId)!).push(it.word);
    const out: WordEntry[] = [];
    for (const [bookId, words] of byBook) {
      const { data: rows } = await context.supabase
        .from("word_entries")
        .select(ENTRY_COLS)
        .eq("book_id", bookId)
        .in("word", words);
      out.push(...((rows ?? []) as EntryRow[]).map(rowToEntry));
    }
    return out;
  });

export const createCustomBook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(60),
        description: z.string().trim().max(200).optional(),
        entries: z.array(EntryInput).min(1).max(5000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { insertEntries } = await import("./library.server");
    const { data: book, error } = await context.supabase
      .from("word_books")
      .insert({
        name: data.name,
        description: data.description || null,
        source: "custom",
        owner_user_id: context.userId,
      })
      .select("id")
      .single();
    if (error || !book) throw new Error(error?.message ?? "创建失败");
    try {
      const count = await insertEntries(context.supabase, book.id, data.entries);
      return { bookId: book.id, count };
    } catch (e) {
      await context.supabase.from("word_books").delete().eq("id", book.id);
      throw e;
    }
  });

export const deleteCustomBook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ bookId: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("word_books")
      .delete()
      .eq("id", data.bookId)
      .eq("source", "custom")
      .eq("owner_user_id", context.userId);
    if (error) throw new Error(error.message);
    // 若删除的是当前词书，回到演示词书
    await context.supabase
      .from("user_settings")
      .update({ active_book: "core" })
      .eq("user_id", context.userId)
      .eq("active_book", data.bookId);
    return { ok: true };
  });
