import type { WordEntry } from "@/data/words";
import { assembleWordEntry, lexemeKey, type LexiconContent } from "./lexicon.shared";

type Client = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const BATCH = 250;
const missingLexiconTable = (error: { code?: string }) =>
  error.code === "42P01" || error.code === "PGRST205";

/** Resolve a whole book/review set in batches; never query Lexicon once per word. */
export async function hydrateEntries(client: Client, entries: WordEntry[]): Promise<WordEntry[]> {
  if (!entries.length) return entries;
  const keys = [...new Set(entries.map((entry) => lexemeKey(entry.word)))];
  const lexemes: { id: string; normalized_word: string }[] = [];
  for (let i = 0; i < keys.length; i += BATCH) {
    const { data, error } = await client
      .from("lexemes")
      .select("id, normalized_word")
      .eq("language", "en")
      .in("normalized_word", keys.slice(i, i + BATCH));
    if (error) {
      // The application may be published before migration 0006 is applied.
      if (missingLexiconTable(error)) return entries;
      throw new Error(error.message);
    }
    lexemes.push(...(data ?? []));
  }
  const byId = new Map(lexemes.map((row) => [row.id, row.normalized_word]));
  const byWord = new Map<string, LexiconContent[]>();
  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += BATCH) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client
        .from("lexicon_entries")
        .select(
          "lexeme_id, source_id, source_entry_ref, sense_key, priority, translation, part_of_speech, phonetic, definition_en, sentence, sentence_translation, subject, verb, object",
        )
        .in("lexeme_id", ids.slice(i, i + BATCH))
        // Full OEWN senses stay available in Lexicon, while the WordEntry adapter
        // only needs manually reviewed OEWN primaries and other shared sources.
        .or("source_id.neq.oewn-2025,priority.gte.100")
        .order("id", { ascending: true })
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) {
        const key = byId.get(row.lexeme_id);
        if (key)
          (byWord.get(key) ?? byWord.set(key, []).get(key)!).push({ ...row, normalized_word: key });
      }
      if (!data || data.length < 1000) break;
    }
  }
  return entries.map(
    (entry) => assembleWordEntry(entry, byWord.get(lexemeKey(entry.word)) ?? []).entry,
  );
}
