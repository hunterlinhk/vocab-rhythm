import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { hasMeaning } from "@/data/words";
import { useDueReview } from "@/hooks/use-due-review";
import { recordAttempt } from "@/lib/learning.functions";
import { resolveEntries } from "@/lib/library.functions";
import {
  clearPendingWordAttempt,
  getOrCreatePendingWordAttemptId,
  getUserTimeZone,
  queueLearningStateWrite,
} from "@/lib/learning-state.runtime";
import { recognitionOptions } from "@/lib/review-queue.shared";
import { speak } from "@/lib/sound";
import { cn } from "@/lib/utils";

export function RecognitionReview() {
  const due = useDueReview("recognition");
  const resolve = useServerFn(resolveEntries);
  const record = useServerFn(recordAttempt);
  const qc = useQueryClient();
  // Freeze this visit's queue: a successful answer can make a state no longer due.
  const [items, setItems] = useState<NonNullable<typeof due.data> | null>(null);
  useEffect(() => {
    if (due.isFetchedAfterMount && items === null) setItems(due.data ?? []);
  }, [due.isFetchedAfterMount, due.data, items]);
  const identities = useMemo(
    () => (items ?? []).map((item) => ({ bookId: item.bookId, word: item.word })),
    [items],
  );
  const entries = useQuery({
    queryKey: ["due-recognition-entries", identities],
    queryFn: () => resolve({ data: { items: identities } }),
    enabled: identities.length > 0,
  });
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<"context" | "recall">("context");
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryOption, setRetryOption] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const item = items?.[index];
  const entry = entries.data?.find(
    (candidate) => candidate.bookId === item?.bookId && candidate.word === item?.word,
  );
  const options = useMemo(
    () => (entry ? recognitionOptions(entry, entries.data ?? []) : []),
    [entry, entries.data],
  );
  const identity = item ? `recognition:${item.scope_key}:${item.word_key}:${item.next_due_at}` : "";
  useEffect(() => {
    if (!identity) return;
    try {
      setStage(
        window.sessionStorage.getItem(`cadence:review-stage:${identity}`) === "recall"
          ? "recall"
          : "context",
      );
    } catch {
      setStage("context");
    }
  }, [identity]);
  useEffect(() => {
    if (!identity) return;
    try {
      setRetryOption(window.sessionStorage.getItem(`cadence:review-answer:${identity}:${stage}`));
    } catch {
      setRetryOption(null);
    }
  }, [identity, stage]);

  const next = () => {
    setStage("context");
    setPicked(null);
    setError(null);
    setRetryOption(null);
    if (items && index + 1 < items.length) setIndex(index + 1);
    else setCompleted(true);
  };

  const choose = async (option: string) => {
    if (
      !item ||
      !entry ||
      !hasMeaning(entry) ||
      busy ||
      picked ||
      (retryOption && retryOption !== option)
    )
      return;
    setPicked(option);
    setBusy(true);
    setError(null);
    const correct = option === entry.cn;
    const sessionKey = `${identity}:session`;
    const attemptKey = `${identity}:${stage}`;
    try {
      try {
        window.sessionStorage.setItem(`cadence:review-answer:${attemptKey}`, option);
      } catch {
        /* retry stays in memory */
      }
      await queueLearningStateWrite(() =>
        record({
          data: {
            attemptId: getOrCreatePendingWordAttemptId(attemptKey),
            sessionId: getOrCreatePendingWordAttemptId(sessionKey),
            mode: "memorize",
            bookId: item.bookId,
            word: item.word,
            translation: entry.cn,
            correct,
            mistouch: false,
            typoCount: 0,
            durationMs: 0,
            isReview: true,
            reviewMode: "recognition",
            includeInReview: true,
            sessionStage: stage,
            timeZone: getUserTimeZone(),
          },
        }),
      );
      try {
        window.sessionStorage.removeItem(`cadence:review-answer:${attemptKey}`);
      } catch {
        /* ignore */
      }
      setRetryOption(null);
      if (correct && stage === "context") speak(entry.word);
      if (stage === "context") {
        try {
          window.sessionStorage.setItem(`cadence:review-stage:${identity}`, "recall");
        } catch {
          /* server attempt remains authoritative */
        }
        setStage("recall");
        setPicked(null);
      } else {
        try {
          window.sessionStorage.removeItem(`cadence:review-stage:${identity}`);
        } catch {
          /* ignore */
        }
        clearPendingWordAttempt(sessionKey);
        clearPendingWordAttempt(`${identity}:context`);
        clearPendingWordAttempt(attemptKey);
        void qc.invalidateQueries({ queryKey: ["due-review"] });
        void qc.invalidateQueries({ queryKey: ["learning-state"] });
        next();
      }
    } catch {
      setPicked(null);
      setRetryOption(option);
      setError("保存失败，请重试当前题目。");
    } finally {
      setBusy(false);
    }
  };

  if (due.isError || entries.isError)
    return (
      <div className="glass-stage flex min-h-[30rem] items-center justify-center">
        加载失败，请刷新重试。
      </div>
    );
  if (items === null || (items.length > 0 && !entries.isFetchedAfterMount))
    return (
      <div className="glass-stage flex min-h-[30rem] items-center justify-center">载入中…</div>
    );
  if (!items.length || completed)
    return (
      <div className="glass-stage flex min-h-[30rem] flex-col items-center justify-center gap-5 text-center">
        <CheckCircle2 className="size-12 text-success" />
        <p className="font-display text-3xl">认词复习完成</p>
        <Link
          to="/review"
          className="rounded-full bg-primary px-5 py-2 text-sm text-primary-foreground"
        >
          回到复习
        </Link>
      </div>
    );

  return (
    <div className="flex flex-col items-center overflow-x-clip pb-4">
      <div className="focus-top flex w-full items-center justify-between gap-3">
        <span className="rounded-full bg-warning/15 px-3.5 py-1.5 text-sm text-warning">
          复习 · 认词
        </span>
        <span className="font-mono text-sm text-muted-foreground">
          {index + 1} / {items.length}
        </span>
      </div>
      <div className="glass-stage mt-6 flex min-h-[30rem] w-full flex-col items-center justify-center gap-8 px-4 py-10 sm:mt-10 sm:min-h-[33.25rem]">
        {!entry || !hasMeaning(entry) ? (
          <div className="text-center">
            <p className="text-sm text-muted-foreground">{item?.word} 暂无可用释义</p>
            <button
              type="button"
              onClick={next}
              className="mt-5 rounded-full bg-primary px-5 py-2 text-sm text-primary-foreground"
            >
              下一个
            </button>
          </div>
        ) : (
          <>
            <div className="text-center">
              {stage === "context" && entry.sentence ? (
                <p className="max-w-2xl text-2xl leading-relaxed">{entry.sentence}</p>
              ) : (
                <p className="font-display text-5xl">{entry.word}</p>
              )}
              <p className="mt-3 text-sm text-muted-foreground">
                {stage === "context" ? "语境选义" : "词义回忆"}
              </p>
            </div>
            <div className="grid w-full max-w-lg gap-2.5">
              {options.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => void choose(option)}
                  disabled={busy || (!!retryOption && retryOption !== option)}
                  className={cn(
                    "glass-lift rounded-2xl bg-card/50 px-5 py-4 text-left text-base",
                    picked === option &&
                      (option === entry.cn ? "bg-success/15" : "bg-destructive/12"),
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {retryOption && (
              <button
                type="button"
                onClick={() => void choose(retryOption)}
                disabled={busy}
                className="rounded-full bg-primary px-5 py-2 text-sm text-primary-foreground"
              >
                重试保存
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
