import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { authClient } from "@/integrations/auth/client";
import { getBookLearnedCounts } from "@/lib/learning.functions";

export const BOOK_LEARNED_COUNTS_QUERY_KEY = ["book-learned-counts"] as const;

export function useBookLearnedCounts(options: { enabled?: boolean } = {}) {
  const fetchCounts = useServerFn(getBookLearnedCounts);
  const session = authClient.useSession();
  const userId = session.data?.user.id ?? null;
  const cacheKey = useMemo(() => [...BOOK_LEARNED_COUNTS_QUERY_KEY, userId] as const, [userId]);
  const query = useQuery({
    queryKey: cacheKey,
    queryFn: () => fetchCounts(),
    enabled: !session.isPending && !!userId && (options.enabled ?? true),
    staleTime: 5 * 60 * 1000,
  });
  return {
    ...query,
    cacheKey,
    confirmedCounts: query.isFetching || query.isError || query.isStale ? undefined : query.data,
  };
}
