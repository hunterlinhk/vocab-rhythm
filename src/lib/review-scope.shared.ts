/** Scope for Review projections. Book ids are provenance unless per-book sharing is selected. */
export const SHARED_REVIEW_SCOPE = "shared" as const;
export type ReviewScopeKey = typeof SHARED_REVIEW_SCOPE | `book:${string}`;

export function reviewScopeForBook(bookId: string, shareAcrossBooks: boolean): ReviewScopeKey {
  if (shareAcrossBooks) return SHARED_REVIEW_SCOPE;
  const normalizedBookId = bookId.trim();
  if (!normalizedBookId) throw new Error("A book-scoped review state requires a book id");
  return `book:${normalizedBookId}`;
}

export function bookIdForReviewScope(scopeKey: string): string | null {
  if (!scopeKey.startsWith("book:")) return null;
  const bookId = scopeKey.slice("book:".length);
  return bookId || null;
}

export function reviewScopeIncludesBook(scopeKey: string, bookId: string): boolean {
  return scopeKey === SHARED_REVIEW_SCOPE || bookIdForReviewScope(scopeKey) === bookId;
}
