import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getLearningProblems } from "@/lib/learning.functions";
import {
  fetchAfterLearningStateWrites,
  hasAuthoritativeLearningState,
} from "@/lib/learning-state.runtime";

export const LEARNING_PROBLEMS_QUERY_KEY = ["learning-problems"] as const;

export function useLearningProblems(options: { enabled?: boolean } = {}) {
  const fetchProblems = useServerFn(getLearningProblems);
  const query = useQuery({
    queryKey: LEARNING_PROBLEMS_QUERY_KEY,
    queryFn: () => fetchAfterLearningStateWrites(() => fetchProblems()),
    enabled: options.enabled ?? true,
    staleTime: 0,
    refetchOnMount: "always",
  });

  return {
    ...query,
    isAuthoritative: hasAuthoritativeLearningState(query),
  };
}
