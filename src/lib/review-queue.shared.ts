import { ALL_WORDS, hasMeaning, type WordEntry } from "../data/words";

export function recognitionOptions(entry: WordEntry, resolved: WordEntry[]): string[] {
  if (!hasMeaning(entry)) return [];
  const distractors = [...resolved, ...ALL_WORDS]
    .filter(hasMeaning)
    .map((item) => item.cn)
    .filter(
      (meaning, index, meanings) => meaning !== entry.cn && meanings.indexOf(meaning) === index,
    );
  const seed = [...entry.word].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const first = distractors[seed % distractors.length];
  const second = distractors[(seed * 7 + 11) % distractors.length];
  const options = [
    entry.cn,
    ...new Set([first, second].filter((value): value is string => !!value)),
  ];
  const shift = seed % options.length;
  return [...options.slice(shift), ...options.slice(0, shift)];
}
