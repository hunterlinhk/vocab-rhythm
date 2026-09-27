import type { WordEntry } from "@/data/words";

export type LexiconContent = {
  normalized_word: string;
  source_id: string;
  source_entry_ref: string | null;
  sense_key: string;
  priority: number;
  translation: string | null;
  part_of_speech: string | null;
  phonetic: string | null;
  definition_en: string | null;
  sentence: string | null;
  sentence_translation: string | null;
  subject: string | null;
  verb: string | null;
  object: string | null;
};

export type FieldOrigin = { sourceId: string; sourceEntryRef: string | null };
export type LexiconResolution = {
  entry: WordEntry;
  /** Only fields supplied by the shared Lexicon have an origin here. */
  origins: Partial<
    Record<"cn" | "partOfSpeech" | "phonetic" | "definitionEn" | "sentence", FieldOrigin>
  >;
};

export const lexemeKey = (word: string) => word.trim().toLowerCase();

/** Book-local content wins. Shared content fills missing fields without changing book identity or statistics. */
export function assembleWordEntry(entry: WordEntry, content: LexiconContent[]): LexiconResolution {
  // The full OEWN import stores every sense at priority 0. Only explicitly reviewed
  // OEWN primaries (including the original 26 pilot senses) may hydrate WordEntry.
  const eligible = content.filter((row) => row.source_id !== "oewn-2025" || row.priority >= 100);
  const ordered = [...eligible].sort(
    (a, b) =>
      b.priority - a.priority ||
      a.source_id.localeCompare(b.source_id) ||
      a.sense_key.localeCompare(b.sense_key),
  );
  const origins: LexiconResolution["origins"] = {};
  const originOf = (row: LexiconContent): FieldOrigin => ({
    sourceId: row.source_id,
    sourceEntryRef: row.source_entry_ref,
  });
  // Meaning fields stay within one source sense until cross-source sense alignment exists.
  const meaning = ordered.find(
    (row) => row.translation?.trim() || row.definition_en?.trim() || row.part_of_speech?.trim(),
  );
  const pickMeaning = (
    local: string | undefined,
    field: "translation" | "part_of_speech" | "definition_en",
    output: keyof LexiconResolution["origins"],
  ) => {
    if (local?.trim()) return local;
    const value = meaning?.[field];
    if (!meaning || !value?.trim()) return undefined;
    origins[output] = originOf(meaning);
    return value;
  };
  const cn = pickMeaning(entry.cn, "translation", "cn");
  const partOfSpeech = pickMeaning(entry.partOfSpeech, "part_of_speech", "partOfSpeech");
  const definitionEn = pickMeaning(entry.definitionEn, "definition_en", "definitionEn");
  const pronunciation = ordered.find((row) => row.phonetic?.trim());
  const phonetic = entry.phonetic?.trim() ? entry.phonetic : (pronunciation?.phonetic ?? undefined);
  if (!entry.phonetic?.trim() && pronunciation) origins.phonetic = originOf(pronunciation);

  // Examples are a unit: never pair one sentence with another source's translation or grammar.
  const localExample = [
    entry.sentence,
    entry.sentenceCn,
    entry.subject,
    entry.verb,
    entry.object,
  ].some((value) => value?.trim());
  const example = localExample ? undefined : ordered.find((row) => row.sentence?.trim());
  if (example) origins.sentence = originOf(example);
  const sentence = entry.sentence || example?.sentence || undefined;
  const sentenceCn = entry.sentenceCn ?? example?.sentence_translation ?? undefined;
  const subject = entry.subject ?? example?.subject ?? undefined;
  const verb = entry.verb ?? example?.verb ?? undefined;
  const object = entry.object ?? example?.object ?? undefined;

  return {
    entry: {
      ...entry,
      cn,
      partOfSpeech,
      phonetic,
      definitionEn,
      sentence,
      sentenceCn,
      subject,
      verb,
      object,
      svo: subject && verb ? { s: subject, v: verb, o: object } : entry.svo,
    },
    origins,
  };
}
