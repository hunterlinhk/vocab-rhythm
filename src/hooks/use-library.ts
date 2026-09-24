import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { WORD_BOOKS, getBook, isBundledBook, type WordBook } from "@/data/words";
import { getBookEntries, listLibrary } from "@/lib/library.functions";

export type BookSummary = {
  id: string;
  name: string;
  desc: string;
  source: "official" | "custom";
  demo: boolean;
  wordCount: number;
};

/** Bundled official books and demos, database official books, and custom books. */
export function useLibrary() {
  const fetchLib = useServerFn(listLibrary);
  const q = useQuery({ queryKey: ["library"], queryFn: () => fetchLib() });
  const books = useMemo(() => {
    const demo: BookSummary[] = WORD_BOOKS.map((b) => ({
      id: b.id,
      name: b.name,
      desc: b.desc,
      source: "official",
      demo: !!b.demo,
      wordCount: b.words.length,
    }));
    const map = (b: { id: string; name: string; description: string | null; source: "official" | "custom"; word_count: number }): BookSummary => ({
      id: b.id,
      name: b.name,
      desc: b.description ?? "",
      source: b.source,
      demo: false,
      wordCount: b.word_count,
    });
    const official = [...demo, ...(q.data?.official ?? []).filter((b) => !isBundledBook(b.id)).map(map)];
    const custom = (q.data?.custom ?? []).map(map);
    return { official, custom, all: [...official, ...custom] };
  }, [q.data]);
  return { ...books, isLoading: q.isLoading, refetch: q.refetch };
}

/** 取一本词书的完整词条；演示词书直接读本地，其余从数据库加载 */
export function useBook(bookId: string | null | undefined) {
  const fetchEntries = useServerFn(getBookEntries);
  const { all } = useLibrary();
  const bundled = !!bookId && isBundledBook(bookId);
  const q = useQuery({
    queryKey: ["book-entries", bookId],
    queryFn: () => fetchEntries({ data: { bookId: bookId! } }),
    enabled: !!bookId && !bundled,
    staleTime: 5 * 60_000,
  });
  const book: WordBook | undefined = useMemo(() => {
    if (!bookId) return undefined;
    if (bundled) return getBook(bookId);
    const meta = all.find((b) => b.id === bookId);
    if (!q.data) return undefined;
    return {
      id: bookId,
      name: meta?.name ?? "词库",
      desc: meta?.desc ?? "",
      source: meta?.source ?? "custom",
      words: q.data,
    };
  }, [bookId, bundled, q.data, all]);
  return { book, loading: !!bookId && !bundled && q.isLoading, missing: !!bookId && !bundled && q.isFetched && !q.data?.length };
}
