import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getBookLearnedCounts } from "@/lib/learning.functions";

export const BOOK_LEARNED_COUNTS_QUERY_KEY = ["book-learned-counts"] as const;

export function useBookLearnedCounts() {
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
  return useQuery({
    queryKey: [...BOOK_LEARNED_COUNTS_QUERY_KEY, userId],
    queryFn: () => fetchCounts(),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}
