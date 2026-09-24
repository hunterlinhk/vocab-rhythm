import { z } from "zod";
import type { WordEntry } from "@/data/words";

/** 完整字段词条（批量导入 / 自定义词库共用） */
export const EntryInput = z.object({
  word: z.string().trim().min(1).max(80),
  translation: z.string().trim().max(300).nullish(),
  phonetic: z.string().trim().max(80).nullish(),
  sentence: z.string().trim().max(500).nullish(),
  sentence_translation: z.string().trim().max(500).nullish(),
  subject: z.string().trim().max(120).nullish(),
  verb: z.string().trim().max(120).nullish(),
  object: z.string().trim().max(120).nullish(),
});
export type EntryInputT = z.infer<typeof EntryInput>;

export type BookMeta = {
  id: string;
  name: string;
  description: string | null;
  source: "official" | "custom";
  owner_user_id: string | null;
  word_count: number;
  created_at: string;
  updated_at: string;
};

export type EntryRow = {
  book_id: string;
  word: string;
  translation: string | null;
  phonetic: string | null;
  sentence: string | null;
  sentence_translation: string | null;
  subject: string | null;
  verb: string | null;
  object: string | null;
};

export const rowToEntry = (r: EntryRow): WordEntry => ({
  word: r.word,
  bookId: r.book_id,
  cn: r.translation ?? "",
  phonetic: r.phonetic ?? "",
  sentence: r.sentence ?? "",
  sentenceCn: r.sentence_translation ?? "",
  svo: r.subject && r.verb ? { s: r.subject, v: r.verb, o: r.object ?? undefined } : undefined,
});

/** 去重（同书内同词只保留第一条）并规整空值 */
export function normalizeEntries(list: EntryInputT[]) {
  const seen = new Set<string>();
  const out: (EntryInputT & { position: number })[] = [];
  for (const e of list) {
    const key = e.word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      word: e.word,
      translation: e.translation || null,
      phonetic: e.phonetic || null,
      sentence: e.sentence || null,
      sentence_translation: e.sentence_translation || null,
      subject: e.subject || null,
      verb: e.verb || null,
      object: e.object || null,
      position: out.length,
    });
  }
  return out;
}

/**
 * 解析粘贴内容。支持：
 *   apple            （每行一个单词）
 *   apple<Tab>苹果   （单词 + Tab/空格 + 中文释义）
 */
export function parsePastedWords(text: string): { word: string; translation: string | null }[] {
  const seen = new Set<string>();
  const out: { word: string; translation: string | null }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let word: string;
    let rest = "";
    if (line.includes("\t")) {
      const i = line.indexOf("\t");
      word = line.slice(0, i).trim();
      rest = line.slice(i + 1).trim();
    } else {
      // 英文部分：连续的字母、空格、撇号、连字符，直到遇到非英文字符
      const m = line.match(/^([A-Za-z][A-Za-z'\- ]*?)(?:\s+([^A-Za-z].*))?$/);
      if (!m) continue;
      word = m[1]!.trim();
      rest = (m[2] ?? "").trim();
    }
    if (!/^[A-Za-z][A-Za-z'\- ]*$/.test(word) || word.length > 80) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ word, translation: rest || null });
  }
  return out;
}
