import { ALL_WORDS, hasMeaning, type WordEntry } from "../data/words";

export function recognitionOptions(
  entry: WordEntry,
  resolved: WordEntry[],
  bundled: WordEntry[] = ALL_WORDS,
): string[] {
  if (!hasMeaning(entry)) return [];
  const distractors = [...resolved, ...bundled]
    .filter(hasMeaning)
    .map((item) => item.cn)
    .filter(
      (meaning, index, meanings) => meaning !== entry.cn && meanings.indexOf(meaning) === index,
    );
  const seed = [...entry.word].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const firstIndex = distractors.length ? seed % distractors.length : -1;
  const secondIndex =
    distractors.length > 1
      ? (firstIndex + 1 + ((seed * 7 + 11) % (distractors.length - 1))) % distractors.length
      : -1;
  const options = [entry.cn];
  if (firstIndex >= 0 && distractors[firstIndex]) options.push(distractors[firstIndex]);
  if (secondIndex >= 0 && distractors[secondIndex]) options.push(distractors[secondIndex]);
  const shift = seed % options.length;
  return [...options.slice(shift), ...options.slice(0, shift)];
}
