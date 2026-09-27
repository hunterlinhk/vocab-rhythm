export const SENTENCE_PROGRESS_KEY = "cadence:sentence-cursors";

export type CursorStorage = Pick<Storage, "getItem" | "setItem">;

function readCursors(storage: CursorStorage): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SENTENCE_PROGRESS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([, value]) => Number.isSafeInteger(value) && Number(value) >= 0,
      ),
    ) as Record<string, number>;
  } catch {
    return {};
  }
}

export function loadSentenceCursor(
  storage: CursorStorage,
  bookId: string,
  queueLength?: number,
): number {
  const saved = readCursors(storage)[bookId] ?? 0;
  return queueLength && queueLength > 0 ? saved % queueLength : saved;
}

export function saveSentenceCursor(storage: CursorStorage, bookId: string, cursor: number): void {
  if (!bookId || !Number.isSafeInteger(cursor) || cursor < 0) return;
  const cursors = readCursors(storage);
  cursors[bookId] = cursor;
  try {
    storage.setItem(SENTENCE_PROGRESS_KEY, JSON.stringify(cursors));
  } catch {
    // Private browsing or a full storage quota should not stop sentence practice.
  }
}

export function nextSentenceCursor(cursor: number, queueLength: number): number {
  return queueLength > 0 ? (cursor + 1) % queueLength : 0;
}
