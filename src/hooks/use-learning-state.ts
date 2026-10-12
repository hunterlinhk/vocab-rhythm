import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getLearningState } from "@/lib/learning.functions";
import {
  fetchAfterLearningStateWrites,
  hasAuthoritativeLearningState,
} from "@/lib/learning-state.runtime";

export const LEARNING_STATE_QUERY_KEY = ["learning-state"] as const;

export function useLearningState(options: { enabled?: boolean } = {}) {
  const fetchState = useServerFn(getLearningState);
  const query = useQuery({
    queryKey: LEARNING_STATE_QUERY_KEY,
    queryFn: () => fetchAfterLearningStateWrites(() => fetchState()),
    enabled: options.enabled ?? true,
    staleTime: 0,
    refetchOnMount: "always",
  });

  return {
    ...query,
    isAuthoritative: hasAuthoritativeLearningState(query),
  };
}
