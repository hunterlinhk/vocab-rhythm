export type LearningStateQueryStatus = {
  isFetchedAfterMount: boolean;
  isFetching: boolean;
  isError: boolean;
};

export function hasAuthoritativeLearningState(status: LearningStateQueryStatus): boolean {
  return status.isFetchedAfterMount && !status.isFetching && !status.isError;
}

let learningStateWriteQueue: Promise<unknown> = Promise.resolve();
const pendingLearningStateWrites = new Set<Promise<unknown>>();
const pendingWordAttemptKey = (identity: string) =>
  `cadence:pending-word-attempt:${encodeURIComponent(identity)}`;

function getSessionStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function getOrCreatePendingWordAttemptId(
  identity: string,
  storage: Pick<Storage, "getItem" | "setItem"> | null = getSessionStorage(),
): string {
  if (storage) {
    try {
      const pending = storage.getItem(pendingWordAttemptKey(identity));
      if (
        pending &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pending)
      )
        return pending;
    } catch {
      // Replace corrupt temporary retry metadata with a fresh id.
    }
  }

  const attemptId = globalThis.crypto.randomUUID();
  try {
    storage?.setItem(pendingWordAttemptKey(identity), attemptId);
  } catch {
    // Server state remains authoritative; this id only makes an interrupted write retryable.
  }
  return attemptId;
}

export function clearPendingWordAttempt(
  identity: string,
  storage: Pick<Storage, "getItem" | "removeItem"> | null = getSessionStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(pendingWordAttemptKey(identity));
  } catch {
    // Storage can be unavailable in private browsing contexts.
  }
}

/** Keep cursor/session writes ordered and visible to state reads across route unmounts. */
export function queueLearningStateWrite<T>(write: () => Promise<T>): Promise<T> {
  const operation = learningStateWriteQueue.catch(() => undefined).then(write);
  learningStateWriteQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  pendingLearningStateWrites.add(operation);

  const remove = () => pendingLearningStateWrites.delete(operation);
  void operation.then(remove, remove);
  return operation;
}

export function getUserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export async function fetchAfterLearningStateWrites<T>(fetch: () => Promise<T>): Promise<T> {
  while (pendingLearningStateWrites.size > 0) {
    await Promise.allSettled([...pendingLearningStateWrites]);
  }
  return fetch();
}
