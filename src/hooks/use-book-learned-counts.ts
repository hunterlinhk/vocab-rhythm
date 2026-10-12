import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getBookLearnedCounts } from "@/lib/learning.functions";

export const BOOK_LEARNED_COUNTS_QUERY_KEY = ["book-learned-counts"] as const;

export function useBookLearnedCounts(options: { enabled?: boolean } = {}) {
  const fetchCounts = useServerFn(getBookLearnedCounts);
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let observedAuthEvent = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (active && !observedAuthEvent) setUserId(data.session?.user.id ?? null);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      observedAuthEvent = true;
      if (active) setUserId(session?.user.id ?? null);
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);
  const cacheKey = useMemo(() => [...BOOK_LEARNED_COUNTS_QUERY_KEY, userId] as const, [userId]);
  const query = useQuery({
    queryKey: cacheKey,
    queryFn: () => fetchCounts(),
    enabled: !!userId && (options.enabled ?? true),
    staleTime: 5 * 60 * 1000,
  });
  return {
    ...query,
    cacheKey,
    confirmedCounts: query.isFetching || query.isError || query.isStale ? undefined : query.data,
  };
}
