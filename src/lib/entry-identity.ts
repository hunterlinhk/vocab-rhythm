export type EntryIdentity = { bookId: string; word: string };

export const entryKey = ({ bookId, word }: EntryIdentity): string => JSON.stringify([bookId, word]);

/** Older favorites stored only the word. Assign each to the book the old queue would have used. */
export function parseFavorites(
  raw: string | null,
  legacyBookId: (word: string) => string,
): EntryIdentity[] {
  try {
    const values: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(values)) return [];
    const entries = values.flatMap((value): EntryIdentity[] => {
      if (typeof value === "string" && value) return [{ word: value, bookId: legacyBookId(value) }];
      if (
        value &&
        typeof value === "object" &&
        "bookId" in value &&
        typeof value.bookId === "string" &&
        value.bookId &&
        "word" in value &&
        typeof value.word === "string" &&
        value.word
      )
        return [{ bookId: value.bookId, word: value.word }];
      return [];
    });
    return [...new Map(entries.map((entry) => [entryKey(entry), entry])).values()];
  } catch {
    return [];
  }
}
