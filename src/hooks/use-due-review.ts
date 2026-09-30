import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDueReviewItems } from "@/lib/learning.functions";

export type DueReviewMode = "recognition" | "spelling";

export function useDueReview(mode: DueReviewMode, enabled = true) {
  const fetchDue = useServerFn(getDueReviewItems);
  return useQuery({
    queryKey: ["due-review", mode],
    queryFn: () => fetchDue({ data: { reviewMode: mode, limit: 500 } }),
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
  });
}
