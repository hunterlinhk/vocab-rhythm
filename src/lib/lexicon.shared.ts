import type { LexiconExtendedExpression, LexiconExample, LexiconJsonObject, LexiconPitfall, LexiconSense, LexiconUsageNote, WordEntry } from "@/data/words";

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
  content_type?: "sense" | "usage_note" | undefined;
  sense_role?: "primary" | "supplementary" | "candidate" | null | undefined;
  publication_status?: "pending_review" | "approved" | "published" | "rejected" | undefined;
  review_decision?: "propose_primary" | "defer_no_suitable_sense" | null | undefined;
  related_sense_key?: string | null | undefined;
  usage_note_zh?: string | null | undefined;
  sense_index?: number | undefined;
  editorial_data?: LexiconJsonObject | null | undefined;
};

export type DictionaryBaseContent = {
  normalized_word: string;
  source_id: string;
  source_entry_ref: string;
  phonetic: string | null;
  definition_raw: string;
  translation_raw: string;
  definition_pos_codes: string[];
  translation_pos_codes: string[];
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
const lines = (value: string | null | undefined) =>
  (value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

const asObject = (value: unknown): LexiconJsonObject =>
  value && typeof value === "object" && !Array.isArray(value) ? value as LexiconJsonObject : {};

const examples = (value: unknown): LexiconExample[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const example = asObject(item);
        const en = typeof example["en"] === "string" ? example["en"] : "";
        return en ? [{ en, ...(typeof example["zh"] === "string" ? { zh: example["zh"] } : {}) }] : [];
      })
    : [];

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && !!item.trim()) : [];

const pitfalls = (value: unknown): LexiconPitfall[] =>
  Array.isArray(value)
    ? value.filter((item): item is LexiconPitfall => !!item && typeof item === "object" && !Array.isArray(item))
    : [];

function editorialSense(row: LexiconContent): LexiconSense {
  const data = asObject(row.editorial_data);
  return {
    senseKey: row.sense_key,
    ...(typeof data["index"] === "number" ? { index: data["index"] } : {}),
    ...(typeof data["label_zh"] === "string" ? { labelZh: data["label_zh"] } : {}),
    ...(row.translation ? { translation: row.translation } : {}),
    ...(row.part_of_speech ? { partOfSpeech: row.part_of_speech } : {}),
    ...(row.definition_en ? { definitionEn: row.definition_en } : {}),
    ...(typeof data["definition_zh"] === "string" ? { definitionZh: data["definition_zh"] } : {}),
    ...(examples(data["understanding_examples"]).length ? { understandingExamples: examples(data["understanding_examples"]) } : {}),
    ...(examples(data["usage_examples"]).length ? { usageExamples: examples(data["usage_examples"]) } : {}),
    ...(stringList(data["collocations"]).length ? { collocations: stringList(data["collocations"]) } : {}),
    ...(stringList(data["patterns"]).length ? { patterns: stringList(data["patterns"]) } : {}),
    ...(stringList(data["usage_notes"]).length ? { usageNotes: stringList(data["usage_notes"]) } : {}),
    ...(pitfalls(data["pitfalls"]).length ? { pitfalls: pitfalls(data["pitfalls"]) } : {}),
    ...(Object.keys(data).length ? { editorialData: data } : {}),
    sourceId: row.source_id,
    sourceEntryRef: row.source_entry_ref,
    relatedSenseKey: row.related_sense_key ?? undefined,
  };
}

export function parseExtendedExpression(
  content: unknown,
  sourceId: string,
  sourceEntryRef: string,
): LexiconExtendedExpression | null {
  const document = asObject(content);
  const expression = typeof document["expression"] === "string" ? document["expression"] : "";
  if (!expression) return null;
  const documentPartOfSpeech = typeof document["part_of_speech"] === "string" ? document["part_of_speech"] : undefined;
  const senses = Array.isArray(document["senses"])
    ? document["senses"].flatMap((value, index) => {
        const data = asObject(value);
        const senseKey = typeof data["id"] === "string" && data["id"] ? data["id"] : `${expression}:${index + 1}`;
        const partOfSpeech = typeof data["part_of_speech"] === "string" ? data["part_of_speech"] : documentPartOfSpeech;
        const labelZh = typeof data["label_zh"] === "string" ? data["label_zh"] : undefined;
        const definitionEn = typeof data["definition_en"] === "string" ? data["definition_en"] : undefined;
        const definitionZh = typeof data["definition_zh"] === "string" ? data["definition_zh"] : undefined;
        return [{
          senseKey,
          ...(typeof data["index"] === "number" ? { index: data["index"] } : {}),
          ...(labelZh ? { labelZh } : {}),
          ...(partOfSpeech ? { partOfSpeech } : {}),
          ...(definitionEn ? { definitionEn } : {}),
          ...(definitionZh ? { definitionZh } : {}),
          ...(examples(data["understanding_examples"]).length ? { understandingExamples: examples(data["understanding_examples"]) } : {}),
          ...(examples(data["usage_examples"]).length ? { usageExamples: examples(data["usage_examples"]) } : {}),
          ...(stringList(data["collocations"]).length ? { collocations: stringList(data["collocations"]) } : {}),
          ...(stringList(data["patterns"]).length ? { patterns: stringList(data["patterns"]) } : {}),
          ...(stringList(data["usage_notes"]).length ? { usageNotes: stringList(data["usage_notes"]) } : {}),
          ...(pitfalls(data["pitfalls"]).length ? { pitfalls: pitfalls(data["pitfalls"]) } : {}),
          ...(Object.keys(data).length ? { editorialData: data } : {}),
          sourceId,
          sourceEntryRef,
        }];
      })
    : [];
  return {
    expression,
    ...(documentPartOfSpeech ? { partOfSpeech: documentPartOfSpeech } : {}),
    senses,
  };
}

export function assembleWordEntry(
  entry: WordEntry,
  content: LexiconContent[],
  dictionaryBase?: DictionaryBaseContent,
  extendedExpressions?: LexiconExtendedExpression[],
): LexiconResolution {
  const published = content.filter(
    (row) => row.publication_status == null || row.publication_status === "published",
  );
  const senses = published.filter(
    (row) => row.content_type !== "usage_note" && row.sense_role !== "candidate",
  );
  // The full OEWN import stores every sense at priority 0. Only explicitly reviewed
  // OEWN primaries (including the original 26 pilot senses) may hydrate WordEntry.
  const eligible = senses.filter((row) => row.source_id !== "oewn-2025" || row.priority >= 100);
  const ordered = [...eligible].sort(
    (a, b) =>
      b.priority - a.priority ||
      a.source_id.localeCompare(b.source_id) ||
      a.sense_key.localeCompare(b.sense_key),
  );
  const primary = ordered.filter((row) => row.sense_role !== "supplementary");
  const supplementary = ordered.filter((row) => row.sense_role === "supplementary");
  const hasAuthoredHeadword = primary.some((row) => row.source_id === "cadence_enhanced_entries");
  const usageNotes = published.filter(
    (row) => row.content_type === "usage_note" && row.usage_note_zh?.trim(),
  );
  const origins: LexiconResolution["origins"] = {};
  const originOf = (row: LexiconContent): FieldOrigin => ({
    sourceId: row.source_id,
    sourceEntryRef: row.source_entry_ref,
  });
  // Meaning fields stay within one source sense until cross-source sense alignment exists.
  const meaning = primary.find(
    (row) => row.translation?.trim() || row.definition_en?.trim() || row.part_of_speech?.trim(),
  );
  const baseTranslation = dictionaryBase && !hasAuthoredHeadword ? lines(dictionaryBase.translation_raw).join("；") : "";
  const baseDefinition = dictionaryBase && !hasAuthoredHeadword ? lines(dictionaryBase.definition_raw).join(" / ") : "";
  const basePosCodes = dictionaryBase && !hasAuthoredHeadword
    ? [...new Set([...dictionaryBase.definition_pos_codes, ...dictionaryBase.translation_pos_codes])]
        .map((code) => code.endsWith(".") ? code : `${code}.`)
        .join(" / ")
    : "";
  const baseOrigin = dictionaryBase && !hasAuthoredHeadword ? originOf({
    ...({} as LexiconContent),
    source_id: dictionaryBase.source_id,
    source_entry_ref: dictionaryBase.source_entry_ref,
  }) : undefined;
  let usedBaseCandidates = false;
  const pickMeaning = (
    local: string | undefined,
    field: "translation" | "part_of_speech" | "definition_en",
    output: keyof LexiconResolution["origins"],
  ) => {
    if (local?.trim()) return local;
    const value = meaning?.[field];
    if (meaning && value?.trim()) {
      origins[output] = originOf(meaning);
      return value;
    }
    const fallback = field === "translation" ? baseTranslation
      : field === "definition_en" ? baseDefinition
        : basePosCodes;
    if (fallback && baseOrigin) {
      origins[output] = baseOrigin;
      usedBaseCandidates = true;
      return fallback;
    }
    return undefined;
  };
  const cn = pickMeaning(entry.cn, "translation", "cn");
  const partOfSpeech = pickMeaning(entry.partOfSpeech, "part_of_speech", "partOfSpeech");
  const definitionEn = pickMeaning(entry.definitionEn, "definition_en", "definitionEn");
  const pronunciation = primary.find((row) => row.phonetic?.trim());
  const phonetic = entry.phonetic?.trim()
    ? entry.phonetic
    : pronunciation?.phonetic?.trim() || dictionaryBase?.phonetic?.trim() || undefined;
  if (!entry.phonetic?.trim() && pronunciation) origins.phonetic = originOf(pronunciation);
  else if (!entry.phonetic?.trim() && !pronunciation?.phonetic?.trim() && dictionaryBase?.phonetic?.trim() && baseOrigin) {
    origins.phonetic = baseOrigin;
    usedBaseCandidates = true;
  }

  // Examples are a unit: never pair one sentence with another source's translation or grammar.
  const localExample = [
    entry.sentence,
    entry.sentenceCn,
    entry.subject,
    entry.verb,
    entry.object,
  ].some((value) => value?.trim());
  const example = localExample ? undefined : primary.find((row) => row.sentence?.trim());
  if (example) origins.sentence = originOf(example);
  const sentence = entry.sentence || example?.sentence || undefined;
  const sentenceCn = entry.sentenceCn ?? example?.sentence_translation ?? undefined;
  const subject = entry.subject ?? example?.subject ?? undefined;
  const verb = entry.verb ?? example?.verb ?? undefined;
  const object = entry.object ?? example?.object ?? undefined;
  const additionalSenses: LexiconSense[] = supplementary
    .filter(
      (row) => row.translation?.trim() || row.definition_en?.trim() || row.part_of_speech?.trim(),
    )
    .map(editorialSense);
  const notes: LexiconUsageNote[] = usageNotes.map((row) => {
    const relatedSense = ordered.find(
      (candidate) => candidate.content_type !== "usage_note" && candidate.sense_key === row.related_sense_key,
    );
    return {
      text: row.usage_note_zh!.trim(),
      sourceId: row.source_id,
      sourceEntryRef: row.source_entry_ref,
      relatedSenseKey: row.related_sense_key ?? undefined,
      relatedTranslation: relatedSense?.translation ?? undefined,
      relatedPartOfSpeech: relatedSense?.part_of_speech ?? undefined,
      relatedDefinitionEn: relatedSense?.definition_en ?? undefined,
    };
  });

  return {
    entry: {
      ...entry,
      senseKey: entry.senseKey ?? meaning?.sense_key,
      cn,
      partOfSpeech,
      phonetic,
      definitionEn,
      primarySenseDetails:
        entry.primarySenseDetails ??
        (meaning?.editorial_data ? editorialSense(meaning) : undefined),
      dictionarySource:
        usedBaseCandidates && !hasAuthoredHeadword && dictionaryBase
          ? {
              sourceId: dictionaryBase.source_id,
              sourceEntryRef: dictionaryBase.source_entry_ref,
              definitionCandidatesEn: lines(dictionaryBase.definition_raw),
              translationCandidatesZh: lines(dictionaryBase.translation_raw),
              partOfSpeechCandidates: [...new Set([
                ...dictionaryBase.definition_pos_codes,
                ...dictionaryBase.translation_pos_codes,
              ])],
            }
          : entry.dictionarySource,
      extendedExpressions: entry.extendedExpressions?.length
        ? entry.extendedExpressions
        : extendedExpressions?.length
          ? extendedExpressions
          : undefined,
      sentence,
      sentenceCn,
      subject,
      verb,
      object,
      svo: subject && verb ? { s: subject, v: verb, o: object } : entry.svo,
      additionalSenses: entry.additionalSenses?.length
        ? entry.additionalSenses
        : additionalSenses.length
          ? additionalSenses
          : undefined,
      usageNotes: entry.usageNotes?.length ? entry.usageNotes : notes.length ? notes : undefined,
    },
    origins,
  };
}
