import { normalizeEntries, type EntryInputT } from "./library.shared";
import type { WordEntry } from "@/data/words";
import { getDatabase } from "@/server/db";
import type { UserStore } from "@/server/user-store";
import { wordBooks, wordEntries } from "../../drizzle/schema";

type Client = UserStore;

const CHUNK = 500;

/** 分批写入词条（词数由数据库触发器自动维护） */
export async function insertEntries(client: Client, bookId: string, entries: (EntryInputT | WordEntry)[]) {
  const rows = normalizeEntries(entries).map((e) => ({ ...e, book_id: bookId }));
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await client.table("word_entries").insert(rows.slice(i, i + CHUNK));
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
  const db = getDatabase();
  return db.transaction(async (tx) => {
    const [book] = await tx.insert(wordBooks).values({
      ...(input.id ? { id: input.id } : {}),
      name: input.name,
      description: input.description ?? null,
      source: "official",
      ownerUserId: null,
    }).returning({ id: wordBooks.id });
    if (!book) throw new Error("创建词书失败");
    const rows = normalizeEntries(input.entries).map((entry) => ({
      bookId: book.id,
      position: entry.position,
      word: entry.word,
      sourceRank: entry.source_rank,
      sourceSfi: entry.source_sfi?.toString() ?? null,
      sourceFrequencyPerMillion: entry.source_frequency_per_million?.toString() ?? null,
      translation: entry.translation,
      partOfSpeech: entry.part_of_speech,
      phonetic: entry.phonetic,
      sentence: entry.sentence,
      sentenceTranslation: entry.sentence_translation,
      subject: entry.subject,
      verb: entry.verb,
      object: entry.object,
    }));
    for (let start = 0; start < rows.length; start += CHUNK)
      await tx.insert(wordEntries).values(rows.slice(start, start + CHUNK));
    return { bookId: book.id, count: rows.length };
  });
}
