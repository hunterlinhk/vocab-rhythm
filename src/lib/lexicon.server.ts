import type { WordEntry } from "@/data/words";
import type { UserStore } from "@/server/user-store";
import { assembleWordEntry, lexemeKey, parseExtendedExpression, type DictionaryBaseContent, type LexiconContent } from "./lexicon.shared";

type Client = UserStore;
const BATCH = 1000;
const missingLexiconTable = (error: { code?: string }) =>
  error.code === "42P01";

function appendExpression(
  target: NonNullable<WordEntry["extendedExpressions"]>,
  incoming: NonNullable<WordEntry["extendedExpressions"]>[number],
) {
  const existing = target.find((expression) => expression.expression === incoming.expression);
  if (!existing) {
    target.push(incoming);
    return;
  }
  if (existing.partOfSpeech !== incoming.partOfSpeech) existing.partOfSpeech = undefined;
  const known = new Set(existing.senses.map((sense) => `${sense.sourceId}:${sense.sourceEntryRef}:${sense.senseKey}`));
  for (const sense of incoming.senses) {
    const key = `${sense.sourceId}:${sense.sourceEntryRef}:${sense.senseKey}`;
    if (!known.has(key)) existing.senses.push(sense);
  }
}

/** Resolve a whole book/review set in batches; never query Lexicon once per word. */
export async function hydrateEntries(client: Client, entries: WordEntry[]): Promise<WordEntry[]> {
  if (!entries.length) return entries;
  const keys = [...new Set(entries.map((entry) => lexemeKey(entry.word)))];
  const lexemes: { id: string; normalized_word: string }[] = [];
  for (let i = 0; i < keys.length; i += BATCH) {
    const { data, error } = await client
      .table("lexemes")
      .select("id, normalized_word")
      .eq("language", "en")
      .in("normalized_word", keys.slice(i, i + BATCH));
    if (error) {
      // Keep bundled content usable when a local database has not been initialized.
      if (missingLexiconTable(error)) return entries;
      throw new Error(error.message);
    }
    lexemes.push(...(data ?? []));
  }
  const byId = new Map(lexemes.map((row) => [row.id, row.normalized_word]));
  const byWord = new Map<string, LexiconContent[]>();
  const baseByWord = new Map<string, DictionaryBaseContent>();
  const expressionsByWord = new Map<string, NonNullable<WordEntry["extendedExpressions"]>>();
  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += BATCH) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client
        .table("lexicon_entries")
        .select(
          "lexeme_id, source_id, source_entry_ref, sense_key, priority, translation, part_of_speech, phonetic, definition_en, sentence, sentence_translation, subject, verb, object, content_type, sense_role, publication_status, review_decision, related_sense_key, usage_note_zh, editorial_data",
        )
        .in("lexeme_id", ids.slice(i, i + BATCH))
        .eq("publication_status", "published")
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
    const { data: baseRows, error: baseError } = await client
      .table("dictionary_source_entries")
      .select("lexeme_id, source_id, source_entry_ref, phonetic, definition_raw, translation_raw, definition_pos_codes, translation_pos_codes")
      .in("lexeme_id", ids.slice(i, i + BATCH));
    if (baseError && !missingLexiconTable(baseError)) throw new Error(baseError.message);
    for (const row of baseRows ?? []) {
      const key = byId.get(row.lexeme_id);
      if (key) baseByWord.set(key, { ...row, normalized_word: key });
    }
    for (let from = 0; ; from += 1000) {
      const { data: documents, error: documentError } = await client
        .table("lexicon_documents")
        .select("source_id, document_key, parent_lexeme_id, content_json")
        .in("parent_lexeme_id", ids.slice(i, i + BATCH))
        .eq("source_id", "cadence_enhanced_entries")
        .eq("document_type", "expression")
        .eq("publication_status", "published")
        .order("document_key", { ascending: true })
        .range(from, from + 999);
      if (documentError && !missingLexiconTable(documentError)) throw new Error(documentError.message);
      for (const row of documents ?? []) {
        if (!row.parent_lexeme_id) continue;
        const key = byId.get(row.parent_lexeme_id);
        if (!key) continue;
        const expression = parseExtendedExpression(row.content_json, row.source_id, row.document_key);
        if (expression)
          appendExpression(expressionsByWord.get(key) ?? expressionsByWord.set(key, []).get(key)!, expression);
      }
      if (!documents || documents.length < 1000) break;
    }
  }
  return entries.map(
    (entry) =>
      assembleWordEntry(
        entry,
        byWord.get(lexemeKey(entry.word)) ?? [],
        baseByWord.get(lexemeKey(entry.word)),
        expressionsByWord.get(lexemeKey(entry.word)),
      ).entry,
  );
}
