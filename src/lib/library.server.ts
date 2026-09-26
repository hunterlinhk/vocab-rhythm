import { normalizeEntries, type EntryInputT } from "./library.shared";
import type { WordEntry } from "@/data/words";

type Client = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

const CHUNK = 500;

/** 分批写入词条（词数由数据库触发器自动维护） */
export async function insertEntries(client: Client, bookId: string, entries: (EntryInputT | WordEntry)[]) {
  const rows = normalizeEntries(entries).map((e) => ({ ...e, book_id: bookId }));
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await client.from("word_entries").insert(rows.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
  }
  return rows.length;
}

/**
 * 正式授权词库的批量导入服务（仅服务端调用，使用特权连接）。
 * 一次性写入来源统计与完整学习字段：word / translation / part_of_speech / phonetic / sentence /
 * sentence_translation / subject / verb / object。
 * 可选的学习增强字段由调用方提供；缺失时保留为 null。
 */
export async function importOfficialBook(input: {
  id?: string;
  name: string;
  description?: string | null;
  entries: (EntryInputT | WordEntry)[];
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: book, error } = await supabaseAdmin
    .from("word_books")
    .insert({
      ...(input.id ? { id: input.id } : {}),
      name: input.name,
      description: input.description ?? null,
      source: "official",
      owner_user_id: null,
    })
    .select("id")
    .single();
  if (error || !book) throw new Error(error?.message ?? "创建词书失败");
  try {
    const count = await insertEntries(supabaseAdmin as unknown as Client, book.id, input.entries);
    return { bookId: book.id, count };
  } catch (e) {
    await supabaseAdmin.from("word_books").delete().eq("id", book.id);
    throw e;
  }
}
