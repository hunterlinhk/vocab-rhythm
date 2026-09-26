import { z } from "zod";
import type { WordEntry } from "@/data/words";

/** 完整字段词条（批量导入 / 自定义词库共用） */
export const EntryInput = z.object({
  word: z.string().trim().min(1).max(80),
  source_rank: z.number().int().positive().nullish(),
  source_sfi: z.number().nonnegative().nullish(),
  source_frequency_per_million: z.number().nonnegative().nullish(),
  translation: z.string().trim().max(300).nullish(),
  part_of_speech: z.string().trim().max(80).nullish(),
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
  source_rank: number | null;
  source_sfi: number | null;
  source_frequency_per_million: number | null;
  translation: string | null;
  part_of_speech: string | null;
  phonetic: string | null;
  sentence: string | null;
  sentence_translation: string | null;
  subject: string | null;
  verb: string | null;
  object: string | null;
};

/** Both full-book reads and review lookups must select every stored learning field. */
export const ENTRY_COLS =
  "book_id, word, source_rank, source_sfi, source_frequency_per_million, translation, part_of_speech, phonetic, sentence, sentence_translation, subject, verb, object";

export const rowToEntry = (r: EntryRow): WordEntry => ({
  word: r.word,
  bookId: r.book_id,
  rank: r.source_rank ?? undefined,
  sfi: r.source_sfi ?? undefined,
  frequencyPerMillion: r.source_frequency_per_million ?? undefined,
  cn: r.translation ?? undefined,
  partOfSpeech: r.part_of_speech ?? undefined,
  phonetic: r.phonetic ?? undefined,
  sentence: r.sentence ?? undefined,
  sentenceCn: r.sentence_translation ?? undefined,
  subject: r.subject ?? undefined,
  verb: r.verb ?? undefined,
  object: r.object ?? undefined,
  svo: r.subject && r.verb ? { s: r.subject, v: r.verb, o: r.object ?? undefined } : undefined,
});

/** 去重（同书内同词只保留第一条）并规整空值 */
export function normalizeEntries(list: (EntryInputT | WordEntry)[]) {
  const seen = new Set<string>();
  const out: (EntryInputT & { position: number })[] = [];
  for (const e of list) {
    const fields = e as EntryInputT & WordEntry;
    const key = e.word.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const normalized = EntryInput.parse({
      word: e.word,
      source_rank: fields.source_rank ?? fields.rank ?? null,
      source_sfi: fields.source_sfi ?? fields.sfi ?? null,
      source_frequency_per_million:
        fields.source_frequency_per_million ?? fields.frequencyPerMillion ?? null,
      translation: fields.translation || fields.cn || null,
      part_of_speech: fields.part_of_speech || fields.partOfSpeech || null,
      phonetic: fields.phonetic || null,
      sentence: fields.sentence || null,
      sentence_translation: fields.sentence_translation || fields.sentenceCn || null,
      subject: fields.subject || fields.svo?.s || null,
      verb: fields.verb || fields.svo?.v || null,
      object: fields.object || fields.svo?.o || null,
    });
    out.push({ ...normalized, position: out.length });
  }
  return out;
}

/**
 * 解析粘贴内容。支持：
 *   apple            （每行一个单词）
 *   apple<Tab>苹果   （单词 + Tab/空格 + 中文释义）
 */
const IMPORT_COLUMNS: Record<string, keyof EntryInputT> = {
  word: "word",
  translation: "translation",
  cn: "translation",
  part_of_speech: "part_of_speech",
  partofspeech: "part_of_speech",
  phonetic: "phonetic",
  sentence: "sentence",
  sentence_translation: "sentence_translation",
  sentencecn: "sentence_translation",
  subject: "subject",
  verb: "verb",
  object: "object",
  source_rank: "source_rank",
  rank: "source_rank",
  source_sfi: "source_sfi",
  sfi: "source_sfi",
  source_frequency_per_million: "source_frequency_per_million",
  frequencypermillion: "source_frequency_per_million",
};

export function parsePastedWords(text: string): EntryInputT[] {
  const seen = new Set<string>();
  const out: EntryInputT[] = [];
  let columns: (keyof EntryInputT)[] | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cells = line.split("\t").map((cell) => cell.trim());
    if (!columns && cells.length > 2 && cells[0]?.toLowerCase() === "word") {
      const headers = cells.map((cell) => IMPORT_COLUMNS[cell.toLowerCase()]);
      if (headers.every(Boolean) && new Set(headers).size === headers.length) {
        columns = headers as (keyof EntryInputT)[];
        continue;
      }
    }
    let word: string;
    let rest = "";
    if (columns) {
      word = cells[0] ?? "";
    } else if (line.includes("\t")) {
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
    if (!columns) {
      out.push({ word, translation: rest || null });
      continue;
    }
    const entry: EntryInputT = { word };
    for (let i = 1; i < columns.length; i++) {
      const column = columns[i]!;
      const value = cells[i];
      if (!value) continue;
      if (
        column === "source_rank" ||
        column === "source_sfi" ||
        column === "source_frequency_per_million"
      ) {
        const number = Number(value);
        if (Number.isFinite(number)) entry[column] = number;
      } else if (column !== "word") {
        entry[column] = value;
      }
    }
    out.push(entry);
  }
  return out;
}
