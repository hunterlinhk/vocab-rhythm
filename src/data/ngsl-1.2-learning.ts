import type { WordEntry } from "./words";

/** Editorial learning fields only. Keep NGSL's published rankings and frequencies in the source CSV. */
export const NGSL_LEARNING_DATA: Record<
  string,
  Partial<Pick<WordEntry, "cn" | "partOfSpeech" | "phonetic" | "sentence" | "sentenceCn" | "svo">>
> = {};
