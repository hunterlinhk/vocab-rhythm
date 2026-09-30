import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BookPicker } from "@/components/BookPicker";
import { TypingBoard, type TypingResult } from "@/components/TypingBoard";
import { bareEntry, findInBundledBook, findWord, type WordEntry } from "@/data/words";
import { useBook, useLibrary } from "@/hooks/use-library";
import { useLearningState } from "@/hooks/use-learning-state";
import { useDueReview } from "@/hooks/use-due-review";
import { resolveEntries } from "@/lib/library.functions";
import { entryKey, parseFavorites, type EntryIdentity } from "@/lib/entry-identity";
import { learningProblemKey } from "@/lib/learning-state.shared";
import {
  markAttemptMistouch,
  recordAttempt,
  saveBookCursor,
  saveSettings,
} from "@/lib/learning.functions";
import {
  clearPendingWordAttempt,
  getOrCreatePendingWordAttemptId,
  getUserTimeZone,
  queueLearningStateWrite,
} from "@/lib/learning-state.runtime";
import { speak } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { Volume2, BookOpen, PenLine, CheckCircle2, RotateCcw } from "lucide-react";

export type QueueKind = "today" | "wrong" | "trouble" | "favorites";

const QUEUE_LABEL: Record<QueueKind, string> = {
  today: "今日复习",
  wrong: "错词",
  trouble: "易错词",
  favorites: "收藏",
};

export const Route = createFileRoute("/_authenticated/learn")({
  validateSearch: (search: Record<string, unknown>): { queue?: QueueKind } => {
    const q = search["queue"];
    return typeof q === "string" && q in QUEUE_LABEL ? { queue: q as QueueKind } : {};
  },
  head: () => ({
    meta: [
      { title: "单词拼写 · 韵词 Cadence" },
      { name: "description", content: "用连续键盘输入练习英语单词拼写，即时字符反馈、误触标记与发音回放。" },
      { property: "og:title", content: "单词拼写 · 韵词 Cadence" },
      { property: "og:description", content: "连续键盘输入的英语单词拼写训练。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LearnPage,
});

type HistoryItem = { entry: WordEntry; result: TypingResult; attemptId: string };
type PendingWordCompletion = {
  identity: string;
  attemptId: string;
  entry: WordEntry;
  entryBook: string;
  result: TypingResult;
  isReview: boolean;
  reviewMode: "spelling";
  includeInReview: boolean | null;
  timeZone: string;
  cursor?: { bookId: string; cursorIndex: number };
};

const FAV_KEY = "cadence:favorites";
const PREF_KEY = "cadence:learn-prefs";

type Prefs = { speech: boolean; meaning: boolean; dictation: boolean };
const DEFAULT_PREFS: Prefs = { speech: true, meaning: true, dictation: false };

function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(window.localStorage.getItem(PREF_KEY) ?? "{}") as Partial<Prefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

function loadFavorites(activeBook: string): Map<string, EntryIdentity> {
  const entries = parseFavorites(
    window.localStorage.getItem(FAV_KEY),
    (word) => findWord(word)?.bookId ?? activeBook,
  );
  if (entries.length) {
    try {
      window.localStorage.setItem(FAV_KEY, JSON.stringify(entries));
    } catch {
      /* ignore */
    }
  }
  return new Map(entries.map((item) => [entryKey(item), item]));
}

function SpeakerButton({ word, className }: { word: string; className?: string }) {
  return (
    <button
      type="button"
      aria-label="播放发音"
      onClick={() => speak(word)}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-all duration-200 hover:scale-110 hover:bg-card/70 hover:text-primary",
        className,
      )}
    >
      <Volume2 className="size-4" />
    </button>
  );
}

function ResultPanel({
  item,
  sweeping = false,
  isFav,
  isSaved,
  onFav,
  onSave,
  onListen,
  onNext,
  nextDisabled = false,
  showMistouch = false,
  mistouched = false,
  onMistouch,
}: {
  item: HistoryItem;
  sweeping?: boolean;
  isFav: boolean;
  isSaved: boolean;
  onFav: () => void;
  onSave: () => void;
  onListen: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
  showMistouch?: boolean;
  mistouched?: boolean;
  onMistouch?: () => void;
}) {
  return (
    <div
      data-selectable
      className={cn("flex w-full flex-col items-center gap-5 select-text sm:gap-7", sweeping && "sweep-in")}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col items-stretch gap-5 px-2 text-left sm:w-[86%] sm:flex-row sm:items-start sm:justify-center sm:gap-14 sm:px-0">
        <div className="w-full min-w-0 sm:w-[45%]">
          <p className="whitespace-nowrap font-display text-5xl">{item.entry.word}</p>
          {item.entry.phonetic && (
            <div className="mt-2 flex items-center gap-1.5">
              <p className="whitespace-nowrap font-mono text-base text-muted-foreground sm:text-sm">
                {item.entry.phonetic}
              </p>
              <SpeakerButton word={item.entry.word} />
            </div>
          )}
          <div className="mt-3 flex items-center gap-1.5">
            {item.entry.cn && <p className="text-lg text-foreground">{item.entry.cn}</p>}
            {!item.entry.phonetic && <SpeakerButton word={item.entry.word} />}
          </div>
        </div>
        {item.entry.sentence && (
          <div className="w-full min-w-0 border-t border-border/40 pt-4 text-left sm:w-[45%] sm:self-center sm:border-t-0 sm:border-l sm:border-border/50 sm:pt-0 sm:pl-10">
            <div className="rounded-2xl bg-secondary/45 px-4 py-4 sm:rounded-none sm:bg-transparent sm:p-0">
              <p className="whitespace-nowrap text-base text-foreground/90">{item.entry.sentence}</p>
              {item.entry.sentenceCn && (
                <p className="mt-2 whitespace-nowrap text-sm text-muted-foreground">{item.entry.sentenceCn}</p>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="grid w-full grid-cols-6 gap-2 pt-1 sm:flex sm:w-auto sm:flex-wrap sm:justify-center">
        <button
          type="button"
          onClick={onListen}
          className="col-span-2 whitespace-nowrap rounded-full border border-border bg-card px-2 py-2 text-sm hover:border-primary/40 sm:px-4 sm:py-1.5"
        >
          再听一次
        </button>
        <button
          type="button"
          onClick={onFav}
          className={cn(
            "col-span-2 whitespace-nowrap rounded-full border px-2 py-2 text-sm transition-colors sm:px-4 sm:py-1.5",
            isFav ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-card hover:border-primary/40",
          )}
        >
          {isFav ? "已收藏 ★" : "收藏 ☆"}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={isSaved}
          className={cn(
            "col-span-2 whitespace-nowrap rounded-full border px-2 py-2 text-sm transition-colors sm:px-4 sm:py-1.5",
            isSaved ? "border-border bg-card text-muted-foreground" : "border-border bg-card hover:border-primary/40",
          )}
        >
          {isSaved ? "已加入错题本" : "加入错题本"}
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={nextDisabled}
          className={cn(
            "whitespace-nowrap rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4 sm:py-1.5",
            showMistouch ? "col-span-3" : "col-span-6 mx-auto w-[58%] sm:w-auto",
          )}
        >
          下一个 →
        </button>
        {showMistouch && (
          <button
            type="button"
            onClick={onMistouch}
            disabled={mistouched}
            className={cn(
              "col-span-3 whitespace-nowrap rounded-full border px-3 py-2 text-sm transition-colors sm:px-4 sm:py-1.5",
              mistouched
                ? "border-border bg-card text-muted-foreground"
                : "border-border bg-card hover:border-primary/40",
            )}
          >
            {mistouched ? "已标记误触" : "刚才是误触"}
          </button>
        )}
      </div>
    </div>
  );
}

function LearnPage() {
  const { queue: queueKind } = Route.useSearch();
  const save = useServerFn(recordAttempt);
  const flagMistouch = useServerFn(markAttemptMistouch);
  const persistCursor = useServerFn(saveBookCursor);
  const persistSettings = useServerFn(saveSettings);
  const qc = useQueryClient();
  const { data: state, isAuthoritative: stateIsAuthoritative } = useLearningState();
  const dueSpelling = useDueReview("spelling", queueKind === "today");
  const [todayQueue, setTodayQueue] = useState<{ word: string; bookId: string; translation: null }[] | null>(null);
  useEffect(() => {
    if (queueKind === "today" && dueSpelling.isFetchedAfterMount && todayQueue === null)
      setTodayQueue((dueSpelling.data ?? []).filter((item) => !!item.bookId).map((item) => ({
        word: item.word, bookId: item.bookId!, translation: null,
      })));
  }, [queueKind, dueSpelling.isFetchedAfterMount, dueSpelling.data, todayQueue]);

  const [bookId, setBookId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState<TypingResult | null>(null);
  const [doneAttemptId, setDoneAttemptId] = useState<string | null>(null);
  const [savingProgress, setSavingProgress] = useState(false);
  const [completionRetries, setCompletionRetries] = useState<PendingWordCompletion[]>([]);
  const [retryingCompletion, setRetryingCompletion] = useState<string | null>(null);
  const savingProgressRef = useRef(false);
  const completionQueueRef = useRef<PendingWordCompletion[]>([]);
  const completionWriteActiveRef = useRef(false);
  const [sessionDone, setSessionDone] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const [favorites, setFavorites] = useState<Map<string, EntryIdentity>>(new Map());
  const activeBook = state?.activeBook;
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [includeSpellingInReview, setIncludeSpellingInReview] = useState<boolean | null>(null);
  const [finished, setFinished] = useState(false);
  const prefsRef = useRef<Prefs>(DEFAULT_PREFS);
  const reviewPreferenceWriteRef = useRef(0);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);
  useEffect(() => setPrefs(loadPrefs()), []);
  useEffect(() => {
    if (state) setIncludeSpellingInReview(state.includeSpellingInReview);
  }, [state?.includeSpellingInReview]);
  useEffect(() => {
    if (activeBook) setFavorites(loadFavorites(activeBook));
  }, [activeBook]);
  const togglePref = useCallback((key: keyof Prefs) => {
    setPrefs((p) => {
      const nextPrefs = { ...p, [key]: !p[key] };
      try {
        window.localStorage.setItem(PREF_KEY, JSON.stringify(nextPrefs));
      } catch {
        /* ignore */
      }
      return nextPrefs;
    });
  }, []);
  const toggleReviewInclusion = useCallback(() => {
    const next = !(includeSpellingInReview ?? false);
    const writeId = reviewPreferenceWriteRef.current + 1;
    reviewPreferenceWriteRef.current = writeId;
    setIncludeSpellingInReview(next);
    void queueLearningStateWrite(() =>
      persistSettings({ data: { includeSpellingInReview: next } }),
    )
      .then(() => void qc.invalidateQueries({ queryKey: ["learning-state"] }))
      .catch(() => {
        if (reviewPreferenceWriteRef.current === writeId)
          setIncludeSpellingInReview(state?.includeSpellingInReview ?? null);
        void qc.invalidateQueries({ queryKey: ["learning-state"] });
      });
  }, [includeSpellingInReview, persistSettings, qc, state?.includeSpellingInReview]);
  const [locallySavedToMistakes, setLocallySavedToMistakes] = useState<Set<string>>(new Set());
  const savedToMistakes = useMemo(
    () => new Set([
      ...(state?.wrongWords.map((item) =>
        learningProblemKey(item.bookId, item.word, state.shareReviewProgress)) ?? []),
      ...locallySavedToMistakes,
    ]),
    [state?.wrongWords, state?.shareReviewProgress, locallySavedToMistakes],
  );
  const [locallyMistouched, setLocallyMistouched] = useState<Set<string>>(new Set());
  const mistouched = useMemo(
    () => new Set([...(state?.mistouchWords.map(entryKey) ?? []), ...locallyMistouched]),
    [state?.mistouchWords, locallyMistouched],
  );
  const dragX = useRef<number | null>(null);
  const strict = state?.strictSpelling ?? false;

  // review queue words (from persisted records)
  type ReviewItem = { word: string; bookId: string; translation: string | null };
  const reviewItems = useMemo((): ReviewItem[] => {
    if (!queueKind || !state) return [];
    if (queueKind === "favorites")
      return [...favorites.values()].map((item) => ({
        word: item.word,
        bookId: item.bookId,
        translation: null,
      }));
    if (queueKind === "today") return todayQueue ?? [];
    if (queueKind === "wrong") return state.wrongWords;
    if (queueKind === "trouble") return state.troubleWords;
    return [];
  }, [queueKind, state, favorites, todayQueue]);

  const { all: allBooks } = useLibrary();
  const { book: currentBook } = useBook(queueKind ? null : bookId);
  const resolve = useServerFn(resolveEntries);
  const dbItems = useMemo(
    () => reviewItems.map((i) => ({ bookId: i.bookId, word: i.word })),
    [reviewItems],
  );
  const { data: resolved, isFetchedAfterMount: resolvedFetched } = useQuery({
    queryKey: ["resolve-entries", dbItems],
    queryFn: () => resolve({ data: { items: dbItems.slice(0, 500) } }),
    enabled: !!queueKind && dbItems.length > 0,
  });

  const queue: WordEntry[] = useMemo(() => {
    if (queueKind)
      return reviewItems.map(
        (i) =>
          resolved?.find((e) => e.bookId === i.bookId && e.word === i.word) ??
          findInBundledBook(i.bookId, i.word) ??
          bareEntry(i.word, i.bookId, i.translation),
      );
    return currentBook?.words ?? [];
  }, [queueKind, reviewItems, resolved, currentBook]);
  const queueLoading = (queueKind === "today" && todayQueue === null) || (queueKind
    ? dbItems.length > 0 && !resolvedFetched
    : !currentBook);

  // hydrate the persisted book + cursor once the state arrives
  useEffect(() => {
    if (!state || !stateIsAuthoritative || ready) return;
    if (queueKind) {
      setReady(true);
      return;
    }
    const book = state.activeBook || "core";
    const saved = state.cursors[book]?.word ?? 0;
    setBookId(book);
    setIndex(saved);
    setReady(true);
  }, [state, stateIsAuthoritative, ready, queueKind]);

  const [navDir, setNavDir] = useState<1 | -1>(1);

  const switchBook = useCallback(
    (id: string) => {
      setBookId(id);
      setIndex(state?.cursors[id]?.word ?? 0);
      setDone(null);
      setDoneAttemptId(null);
      setHistory([]);
      setReviewIndex(null);
      setFinished(false);
      void queueLearningStateWrite(() => persistSettings({ data: { activeBook: id } }))
        .then(() => void qc.invalidateQueries({ queryKey: ["learning-state"] }))
        .catch(() => undefined);
    },
    [persistSettings, state, qc],
  );

  const next = useCallback(() => {
    setNavDir(1);
    setDone(null);
    setDoneAttemptId(null);
    setReviewIndex(null);
    setIndex((i) => {
      const nextIndex = i + 1;
      if (queueKind) {
        if (nextIndex >= queue.length) {
          setFinished(true);
          return i;
        }
        return nextIndex;
      }
      return queue.length ? nextIndex % queue.length : 0;
    });
  }, [queue.length, queueKind]);

  const entry = queue.length
    ? queue[queueKind ? Math.min(index, queue.length - 1) : index % queue.length]!
    : undefined;
  const entryBook = entry?.bookId ?? bookId ?? "core";
  const reviewing = reviewIndex !== null ? history[reviewIndex] : undefined;
  const panelResult = reviewing ? reviewing.result : done;
  const resultItem =
    reviewing ??
    (done && entry && doneAttemptId ? { entry, result: done, attemptId: doneAttemptId } : undefined);
  const resultBookId = resultItem?.entry.bookId ?? bookId ?? "core";
  const resultKey = resultItem ? entryKey({ bookId: resultBookId, word: resultItem.entry.word }) : "";
  const resultProblemKey = resultItem
    ? learningProblemKey(resultBookId, resultItem.entry.word, state?.shareReviewProgress ?? true)
    : "";

  const persistCompletion = useCallback(
    (completion: PendingWordCompletion) => {
      if (!completionQueueRef.current.some((item) => item.identity === completion.identity))
        completionQueueRef.current.push(completion);
      if (completionWriteActiveRef.current) return;
      const nextCompletion = completionQueueRef.current[0];
      if (!nextCompletion) return;
      completionWriteActiveRef.current = true;
      let persisted = false;
      void queueLearningStateWrite(async () => {
        await save({
          data: {
            attemptId: nextCompletion.attemptId,
            mode: "word" as const,
            bookId: nextCompletion.entryBook,
            word: nextCompletion.entry.word,
            translation: nextCompletion.entry.cn,
            correct: true,
            mistouch: nextCompletion.result.mistouch,
            typoCount: nextCompletion.result.typoCount,
            durationMs: nextCompletion.result.durationMs,
            isReview: nextCompletion.isReview,
            reviewMode: nextCompletion.reviewMode,
            includeInReview: nextCompletion.includeInReview,
        sessionId: nextCompletion.attemptId,
        sessionStage: "word_spelling" as const,
        timeZone: nextCompletion.timeZone,
          },
        });
        if (nextCompletion.cursor)
          await persistCursor({
            data: { ...nextCompletion.cursor, mode: "word" },
          });
      })
        .then(() => {
          persisted = true;
          clearPendingWordAttempt(nextCompletion.identity);
          completionQueueRef.current = completionQueueRef.current.filter(
            (item) => item.identity !== nextCompletion.identity,
          );
          setCompletionRetries((items) => items.filter((item) => item.identity !== nextCompletion.identity));
          void qc.invalidateQueries({ queryKey: ["stats"] });
          void qc.invalidateQueries({ queryKey: ["learning-state"] });
          void qc.invalidateQueries({ queryKey: ["due-review"] });
        })
        .catch(() => {
          setCompletionRetries((items) =>
            items.some((item) => item.identity === nextCompletion.identity)
              ? items
              : [...items, nextCompletion],
          );
        })
        .finally(() => {
          completionWriteActiveRef.current = false;
          setRetryingCompletion((identity) =>
            identity === nextCompletion.identity ? null : identity,
          );
          if (persisted && completionQueueRef.current[0])
            persistCompletion(completionQueueRef.current[0]);
        });
    },
    [save, persistCursor, qc],
  );

  const onComplete = useCallback(
    (r: TypingResult) => {
      if (!entry || savingProgressRef.current || completionRetries.length > 0) return;
      const identity = `${queueKind ?? "learn"}:${entryBook}:${entry.word}:${index}`;
      if (completionQueueRef.current.some((item) => item.identity === identity)) return;
      const completion: PendingWordCompletion = {
        identity,
        attemptId: getOrCreatePendingWordAttemptId(identity),
        entry,
        entryBook,
        result: r,
        isReview: !!queueKind,
        reviewMode: "spelling" as const,
        includeInReview: queueKind === "today" ? true : includeSpellingInReview,
        timeZone: getUserTimeZone(),
        ...(!queueKind && bookId && queue.length
          ? { cursor: { bookId, cursorIndex: (index + 1) % queue.length } }
          : {}),
      };

      setDone(r);
      setDoneAttemptId(completion.attemptId);
      setSessionDone((n) => n + 1);
      setHistory((h) => [...h, { entry, result: r, attemptId: completion.attemptId }]);
      if (prefsRef.current.speech) speak(entry.word);
      persistCompletion(completion);
    },
    [
      entry,
      entryBook,
      queueKind,
      index,
      completionRetries.length,
      includeSpellingInReview,
      bookId,
      queue.length,
      persistCompletion,
    ],
  );

  const retryCompletion = useCallback(() => {
    const completion = completionRetries[0];
    if (!completion || retryingCompletion) return;
    setRetryingCompletion(completion.identity);
    persistCompletion(completion);
  }, [completionRetries, retryingCompletion, persistCompletion]);

  const skipCurrent = useCallback(async () => {
    if (!entry || savingProgressRef.current || completionRetries.length > 0) return;
    const skippedIdentity = `skip:${entryBook}:${entry.word}:${index}`;
    const skippedAttemptId = getOrCreatePendingWordAttemptId(skippedIdentity);
    savingProgressRef.current = true;
    setSavingProgress(true);
    try {
      await queueLearningStateWrite(async () => {
        await save({
          data: {
            mode: "word" as const,
            attemptId: skippedAttemptId,
            sessionId: skippedAttemptId,
            sessionStage: "word_spelling" as const,
            bookId: entryBook,
            word: entry.word,
            translation: entry.cn,
            correct: true,
            mistouch: false,
            typoCount: 0,
            durationMs: 0,
            isReview: !!queueKind,
            skipped: true,
            reviewMode: "spelling" as const,
            includeInReview: false,
            timeZone: getUserTimeZone(),
          },
        });
        if (!queueKind && bookId && queue.length)
          await persistCursor({
            data: { bookId, mode: "word", cursorIndex: (index + 1) % queue.length },
          });
      });
      clearPendingWordAttempt(skippedIdentity);
      void qc.invalidateQueries({ queryKey: ["learning-state"] });
      void qc.invalidateQueries({ queryKey: ["due-review"] });
      next();
    } catch {
      // Keep the skipped word in place if the server did not persist the skip/cursor.
    } finally {
      savingProgressRef.current = false;
      setSavingProgress(false);
    }
  }, [
    entry,
    entryBook,
      index,
    save,
    queueKind,
    qc,
    next,
    completionRetries.length,
    bookId,
    queue.length,
    index,
    persistCursor,
  ]);

  const markMistouch = useCallback(
    (item: EntryIdentity, attemptId: string) => {
      const key = entryKey(item);
      if (mistouched.has(key)) return;
      setLocallyMistouched((s) => new Set(s).add(key));
      void queueLearningStateWrite(() => flagMistouch({ data: { ...item, attemptId } }))
        .then(() => {
          void qc.invalidateQueries({ queryKey: ["learning-state"] });
          void qc.invalidateQueries({ queryKey: ["due-review"] });
        })
        .catch(() => undefined);
    },
    [flagMistouch, mistouched, qc],
  );

  const goBack = useCallback(() => {
    if (history.length === 0) return;
    setNavDir(-1);
    setReviewIndex((cur) => (cur === null ? history.length - 1 : Math.max(0, cur - 1)));
  }, [history.length]);

  const goForward = useCallback(() => {
    setNavDir(1);
    setReviewIndex((cur) => {
      if (cur === null) return cur;
      if (cur >= history.length - 1) return null;
      return cur + 1;
    });
  }, [history.length]);

  useEffect(() => {
    if (!done || reviewIndex !== null) return;
    const t = window.setTimeout(next, 3000);
    return () => window.clearTimeout(t);
  }, [done, next, reviewIndex]);

  // speak the word only once when a genuinely new one appears
  const word = entry?.word;
  const spokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!word || done || reviewIndex !== null) return;
    const key = `${index}:${word}`;
    if (spokenRef.current === key) return;
    spokenRef.current = key;
    if (prefsRef.current.speech) speak(word);
  }, [word, index, done, reviewIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goBack();
      } else if (e.key === "ArrowRight" && reviewIndex !== null) {
        e.preventDefault();
        goForward();
      } else if ((e.key === "Enter" || e.key === " ") && (done || reviewIndex !== null)) {
        e.preventDefault();
        if (reviewIndex !== null && reviewIndex < history.length - 1) {
          goForward();
        } else if (reviewIndex !== null) {
          setReviewIndex(null);
        } else {
          next();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [done, reviewIndex, history.length, goBack, goForward, next]);

  const [dragDx, setDragDx] = useState(0);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, a, input, textarea, [data-selectable]")) return;
    dragX.current = e.clientX;
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragX.current === null) return;
    const dx = e.clientX - dragX.current;
    const blocked = (dx > 0 && history.length === 0) || (dx < 0 && reviewIndex === null);
    setDragDx(dx * (blocked ? 0.25 : 1));
  };
  const endDrag = (e: React.PointerEvent) => {
    if (dragX.current === null) {
      setDragging(false);
      setDragDx(0);
      return;
    }
    const dx = e.clientX - dragX.current;
    dragX.current = null;
    setDragging(false);
    setDragDx(0);
    if (dx > 64) goBack();
    else if (dx < -64 && reviewIndex !== null) goForward();
  };
  const dragStyle = {
    transform: `translateX(${dragDx}px) scale(${dragging ? 1.012 : 1})`,
    transition: dragging ? "none" : "transform 420ms cubic-bezier(0.16, 1, 0.3, 1)",
  };

  const toggleFavorite = useCallback((item: EntryIdentity) => {
    setFavorites((prev) => {
      const nextSet = new Map(prev);
      const key = entryKey(item);
      if (nextSet.has(key)) nextSet.delete(key);
      else nextSet.set(key, item);
      try {
        window.localStorage.setItem(FAV_KEY, JSON.stringify([...nextSet.values()]));
      } catch {
        /* ignore */
      }
      return nextSet;
    });
  }, []);

  const addToMistakes = useCallback(
    (item: HistoryItem) => {
      const itemBookId = item.entry.bookId ?? bookId ?? "core";
      const key = learningProblemKey(itemBookId, item.entry.word, state?.shareReviewProgress ?? true);
      if (savedToMistakes.has(key)) return;
      setLocallySavedToMistakes((s) => new Set(s).add(key));
      void queueLearningStateWrite(() =>
        save({
          data: {
            mode: "word" as const,
            bookId: itemBookId,
            word: item.entry.word,
            translation: item.entry.cn,
            correct: false,
            mistouch: false,
            typoCount: Math.max(1, item.result.typoCount),
            durationMs: item.result.durationMs,
          },
        }),
      )
        .then(() => void qc.invalidateQueries({ queryKey: ["learning-state"] }))
        .catch(() => undefined);
    },
    [bookId, save, savedToMistakes, qc, state?.shareReviewProgress],
  );

  const progress = queue.length ? (index / queue.length) * 100 : 0;
  const learnedInBook = !queueKind && bookId ? (state?.learnedByBook[bookId]?.length ?? 0) : 0;

  if (!ready || !entry) {
    if (queueKind === "today" && dueSpelling.isError)
      return <div className="glass-stage flex min-h-[30rem] items-center justify-center">加载失败，请刷新重试。</div>;
    if (ready && queueLoading) {
      return (
        <div className="glass-stage flex min-h-[30rem] flex-col items-center justify-center gap-4 text-center">
          <p className="font-display text-2xl">载入中…</p>
        </div>
      );
    }
    return (
      <div className="glass-stage flex min-h-[30rem] flex-col items-center justify-center gap-4 text-center">
        <p className="font-display text-2xl">{ready ? "这批复习内容是空的" : "载入中…"}</p>
        {ready && (
          <Link to="/review" className="rounded-full bg-primary px-5 py-2 text-sm text-primary-foreground">
            回到复习
          </Link>
        )}
      </div>
    );
  }

  if (finished) {
    return (
      <div className="glass-stage flex min-h-[30rem] flex-col items-center justify-center gap-5 text-center">
        <CheckCircle2 className="size-12 text-success" />
        <p className="font-display text-3xl">{QUEUE_LABEL[queueKind!]}完成</p>
        <p className="text-sm text-muted-foreground">本次复习 {sessionDone} 个词</p>
        <div className="flex gap-2">
          <Link to="/review" className="rounded-full border border-border bg-card px-5 py-2 text-sm">
            回到复习
          </Link>
          <Link to="/learn" className="rounded-full bg-primary px-5 py-2 text-sm text-primary-foreground">
            继续学习
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center overflow-x-clip pb-4">
      <div className="focus-top flex w-full flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {queueKind ? (
            <>
              <span className="rounded-full bg-warning/15 px-3.5 py-1.5 text-sm text-warning">
                复习 · {QUEUE_LABEL[queueKind]}
              </span>
              <Link
                to="/learn"
                className="rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                退出复习
              </Link>
            </>
          ) : (
            <BookPicker books={allBooks} selectedBookId={bookId} onSelect={switchBook} />
          )}
        </div>
        <div className="font-mono text-sm text-muted-foreground">
          {index + 1} / {queue.length} · 本次 {sessionDone}
          {queueKind ? "" : ` · 已学 ${learnedInBook}`}
        </div>
      </div>

      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-border/60">
        <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      <div
        className="glass-stage relative mt-6 flex min-h-[30rem] w-full touch-pan-y flex-col items-center justify-center gap-6 px-4 py-10 select-none sm:mt-10 sm:min-h-[33.25rem] sm:gap-8 sm:px-6 sm:py-14"
        style={dragStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="absolute top-5 left-6 flex gap-1.5">
          {(
            [
              { key: "speech", on: prefs.speech, icon: Volume2, label: "朗读" },
              { key: "meaning", on: prefs.meaning, icon: BookOpen, label: "释义" },
              { key: "dictation", on: prefs.dictation, icon: PenLine, label: "默写" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              aria-pressed={t.on}
              title={`${t.on ? "关闭" : "开启"}${t.label}`}
              onClick={() => togglePref(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-all duration-300",
                t.on
                  ? "bg-card/70 text-primary shadow-[0_6px_16px_-12px_var(--ink)]"
                  : "text-muted-foreground/60 hover:bg-card/40 hover:text-muted-foreground",
              )}
            >
              <t.icon className="size-3.5" />
              {t.label}
            </button>
          ))}
          {queueKind !== "today" && <button
            type="button"
            aria-pressed={includeSpellingInReview ?? false}
            title={(includeSpellingInReview ?? false) ? "本次计入复习" : "本次不计入复习"}
            onClick={toggleReviewInclusion}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-all duration-300",
              (includeSpellingInReview ?? false)
                ? "bg-card/70 text-primary shadow-[0_6px_16px_-12px_var(--ink)]"
                : "text-muted-foreground/60 hover:bg-card/40 hover:text-muted-foreground",
            )}
          >
            <RotateCcw className="size-3.5" />
            计入复习
          </button>}
        </div>
        {!done && !reviewing && (
          <button
            type="button"
            onClick={skipCurrent}
            disabled={savingProgress || completionRetries.length > 0}
            className="absolute top-5 right-6 text-xs text-muted-foreground/70 transition-colors hover:text-foreground"
          >
            Skip
          </button>
        )}
        {(done || reviewing) && panelResult && (
          <div className="absolute top-5 right-6 text-right text-xs leading-5">
            {reviewing && (
              <p className="text-muted-foreground/80">
                回顾 · {reviewIndex! + 1} / {history.length}
              </p>
            )}
            <p className="text-primary">
              {(panelResult.durationMs / 1000).toFixed(1)}s
              {panelResult.typoCount === 0 ? " · 全对" : ` · ${panelResult.typoCount} 次错误`}
              {panelResult.mistouch ? " · 含误触" : ""}
            </p>
          </div>
        )}
        <div
          key={reviewing ? `r-${reviewIndex}` : done ? `d-${entry.word}` : `w-${entry.word}`}
          className={cn(
            "flex w-full flex-col items-center gap-8",
            !done && (navDir === 1 ? "nav-slide-left" : "nav-slide-right"),
          )}
        >
          {reviewing || done ? (
            resultItem && (
              <ResultPanel
                item={resultItem}
                sweeping={!reviewing}
                isFav={favorites.has(resultKey)}
                isSaved={savedToMistakes.has(resultProblemKey)}
                onFav={() => toggleFavorite({ bookId: resultBookId, word: resultItem.entry.word })}
                onSave={() => addToMistakes(resultItem)}
                onListen={() => speak(resultItem.entry.word)}
                onNext={() =>
                  reviewing
                    ? reviewIndex! < history.length - 1
                      ? goForward()
                      : setReviewIndex(null)
                    : next()
                }
                nextDisabled={!reviewing && completionRetries.length > 0}
                showMistouch={strict && resultItem.result.typoCount > 0}
                mistouched={mistouched.has(resultKey)}
                onMistouch={() =>
                  markMistouch(
                    { bookId: resultBookId, word: resultItem.entry.word },
                    resultItem.attemptId,
                  )
                }
              />
            )
          ) : (
            <>
              {prefs.meaning ? (
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <p className="font-display text-xl text-foreground">{entry.cn || entry.word}</p>
                    <SpeakerButton word={entry.word} />
                  </div>
                  {entry.phonetic && <p className="mt-1 font-mono text-sm text-muted-foreground">{entry.phonetic}</p>}
                </div>
              ) : (
                <SpeakerButton word={entry.word} className="size-9" />
              )}

              <TypingBoard
                key={entry.word}
                target={entry.word}
                masked={prefs.dictation}
                strict={strict}
                hideMistouch={strict}
                paused={savingProgress || completionRetries.length > 0}
                onComplete={onComplete}
              />
            </>
          )}
        </div>
        {completionRetries[0] && (
          <div className="flex flex-wrap items-center justify-center gap-3 text-sm" role="alert">
            <span className="text-destructive">学习进度暂未保存。</span>
            <button
              type="button"
              onClick={retryCompletion}
              disabled={retryingCompletion === completionRetries[0].identity}
              className="rounded-full border border-border bg-card px-3 py-1.5 hover:border-primary/40 disabled:opacity-50"
            >
              重试保存
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
