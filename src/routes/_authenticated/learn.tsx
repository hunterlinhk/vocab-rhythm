import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { TypingBoard, type TypingResult } from "@/components/TypingBoard";
import { WORD_BOOKS, entriesFor, getBook, type WordEntry } from "@/data/words";
import {
  getLearningState,
  markAttemptMistouch,
  recordAttempt,
  saveBookCursor,
  saveSettings,
} from "@/lib/learning.functions";
import { speak } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { Volume2, BookOpen, PenLine, CheckCircle2 } from "lucide-react";

export type QueueKind = "today" | "wrong" | "trouble" | "mistouch" | "favorites";

const QUEUE_LABEL: Record<QueueKind, string> = {
  today: "今日复习",
  wrong: "错词",
  trouble: "易错词",
  mistouch: "误触记录",
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

type HistoryItem = { entry: WordEntry; result: TypingResult };

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

function loadFavorites(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(FAV_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
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
  showMistouch?: boolean;
  mistouched?: boolean;
  onMistouch?: () => void;
}) {
  return (
    <div
      data-selectable
      className={cn("flex w-full flex-col items-center gap-7 select-text", sweeping && "sweep-in")}
    >
      <div className="mx-auto flex w-[86%] max-w-3xl items-start justify-center gap-8 text-left sm:gap-14">
        <div className="w-[45%] min-w-0">
          <p className="font-display text-5xl [overflow-wrap:anywhere]">{item.entry.word}</p>
          <p className="mt-2 font-mono text-sm text-muted-foreground">{item.entry.phonetic}</p>
          <div className="mt-3 flex items-center gap-1.5">
            <p className="text-lg text-foreground">{item.entry.cn}</p>
            <SpeakerButton word={item.entry.word} />
          </div>
        </div>
        <div className="w-[45%] min-w-0 self-center border-l border-border/50 pl-6 text-left sm:pl-10">
          <p className="text-base text-foreground/90">{item.entry.sentence}</p>
          <p className="mt-2 text-sm text-muted-foreground">{item.entry.sentenceCn}</p>
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-2 pt-1">
        <button
          type="button"
          onClick={onListen}
          className="rounded-full border border-border bg-card px-4 py-1.5 text-sm hover:border-primary/40"
        >
          再听一次
        </button>
        <button
          type="button"
          onClick={onFav}
          className={cn(
            "rounded-full border px-4 py-1.5 text-sm transition-colors",
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
            "rounded-full border px-4 py-1.5 text-sm transition-colors",
            isSaved ? "border-border bg-card text-muted-foreground" : "border-border bg-card hover:border-primary/40",
          )}
        >
          {isSaved ? "已加入错题本" : "加入错题本"}
        </button>
        <button
          type="button"
          onClick={onNext}
          className="rounded-full bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:opacity-90"
        >
          下一个 →
        </button>
        {showMistouch && (
          <button
            type="button"
            onClick={onMistouch}
            disabled={mistouched}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm transition-colors",
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
  const fetchState = useServerFn(getLearningState);
  const qc = useQueryClient();
  const { data: state } = useQuery({ queryKey: ["learning-state"], queryFn: () => fetchState() });

  const [bookId, setBookId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState<TypingResult | null>(null);
  const [sessionDone, setSessionDone] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [finished, setFinished] = useState(false);
  const prefsRef = useRef<Prefs>(DEFAULT_PREFS);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);
  useEffect(() => setPrefs(loadPrefs()), []);
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
  const [savedToMistakes, setSavedToMistakes] = useState<Set<string>>(new Set());
  const [mistouched, setMistouched] = useState<Set<string>>(new Set());
  const dragX = useRef<number | null>(null);
  const strict = state?.strictSpelling ?? false;

  // review queue words (from persisted records)
  const reviewWords = useMemo(() => {
    if (!queueKind || !state) return [];
    if (queueKind === "favorites") return [...favorites];
    if (queueKind === "today") return state.todayWords;
    if (queueKind === "wrong") return state.wrongWords.map((w) => w.word);
    if (queueKind === "trouble") return state.troubleWords.map((w) => w.word);
    return [...new Set(state.mistouchWords.map((w) => w.word))];
    // favorites is a Set state; fine to recompute
  }, [queueKind, state, favorites]);

  const queue: WordEntry[] = useMemo(() => {
    if (queueKind) return entriesFor(reviewWords);
    return getBook(bookId ?? "core").words;
  }, [queueKind, reviewWords, bookId]);

  // hydrate the persisted book + cursor once the state arrives
  useEffect(() => {
    if (!state || ready) return;
    if (queueKind) {
      setReady(true);
      return;
    }
    const book = state.activeBook || "core";
    const saved = state.cursors[book] ?? 0;
    setBookId(book);
    setIndex(getBook(book).words.length ? saved % getBook(book).words.length : 0);
    setReady(true);
  }, [state, ready, queueKind]);

  const [navDir, setNavDir] = useState<1 | -1>(1);

  const switchBook = useCallback(
    (id: string) => {
      setBookId(id);
      setIndex(state?.cursors[id] ?? 0);
      setDone(null);
      setHistory([]);
      setReviewIndex(null);
      setFinished(false);
      void persistSettings({ data: { activeBook: id } }).catch(() => undefined);
    },
    [persistSettings, state],
  );

  const next = useCallback(() => {
    setNavDir(1);
    setDone(null);
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
      const wrapped = queue.length ? nextIndex % queue.length : 0;
      if (bookId) void persistCursor({ data: { bookId, cursorIndex: wrapped } }).catch(() => undefined);
      return wrapped;
    });
  }, [queue.length, queueKind, bookId, persistCursor]);

  const entry = queue.length ? queue[Math.min(index, queue.length - 1)]! : undefined;
  const reviewing = reviewIndex !== null ? history[reviewIndex] : undefined;
  const panelResult = reviewing ? reviewing.result : done;
  const resultItem = reviewing ?? (done && entry ? { entry, result: done } : undefined);

  const onComplete = useCallback(
    (r: TypingResult) => {
      if (!entry) return;
      setDone(r);
      setSessionDone((n) => n + 1);
      setHistory((h) => [...h, { entry, result: r }]);
      if (prefsRef.current.speech) speak(entry.word);
      void save({
        data: {
          mode: "word" as const,
          bookId: bookId ?? "core",
          word: entry.word,
          translation: entry.cn,
          correct: true,
          mistouch: r.mistouch,
          typoCount: r.typoCount,
          durationMs: r.durationMs,
          isReview: !!queueKind,
        },
      })
        .then(() => {
          void qc.invalidateQueries({ queryKey: ["stats"] });
          void qc.invalidateQueries({ queryKey: ["learning-state"] });
        })
        .catch(() => undefined);
    },
    [bookId, entry, save, queueKind, qc],
  );

  const skipCurrent = useCallback(() => {
    if (!entry) return;
    void save({
      data: {
        mode: "word" as const,
        bookId: bookId ?? "core",
        word: entry.word,
        translation: entry.cn,
        correct: true,
        mistouch: false,
        typoCount: 0,
        durationMs: 0,
        isReview: !!queueKind,
        skipped: true,
      },
    })
      .then(() => void qc.invalidateQueries({ queryKey: ["learning-state"] }))
      .catch(() => undefined);
    next();
  }, [entry, bookId, save, queueKind, qc, next]);

  const markMistouch = useCallback(
    (word: string) => {
      if (mistouched.has(word)) return;
      setMistouched((s) => new Set(s).add(word));
      void flagMistouch({ data: { word } })
        .then(() => void qc.invalidateQueries({ queryKey: ["learning-state"] }))
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

  // speak the word when a new one appears
  const word = entry?.word;
  useEffect(() => {
    if (!word || done || reviewIndex !== null || !prefs.speech) return;
    speak(word);
  }, [word, done, reviewIndex, prefs.speech]);

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

  const toggleFavorite = useCallback((word: string) => {
    setFavorites((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(word)) nextSet.delete(word);
      else nextSet.add(word);
      try {
        window.localStorage.setItem(FAV_KEY, JSON.stringify([...nextSet]));
      } catch {
        /* ignore */
      }
      return nextSet;
    });
  }, []);

  const addToMistakes = useCallback(
    (item: HistoryItem) => {
      if (savedToMistakes.has(item.entry.word)) return;
      setSavedToMistakes((s) => new Set(s).add(item.entry.word));
      void save({
        data: {
          mode: "word" as const,
          bookId: bookId ?? "core",
          word: item.entry.word,
          translation: item.entry.cn,
          correct: false,
          mistouch: false,
          typoCount: Math.max(1, item.result.typoCount),
          durationMs: item.result.durationMs,
        },
      })
        .then(() => void qc.invalidateQueries({ queryKey: ["learning-state"] }))
        .catch(() => undefined);
    },
    [bookId, save, savedToMistakes, qc],
  );

  const progress = queue.length ? (index / queue.length) * 100 : 0;
  const learnedInBook = !queueKind && bookId ? (state?.learnedByBook[bookId]?.length ?? 0) : 0;

  if (!ready || !entry) {
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
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
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
            WORD_BOOKS.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => switchBook(b.id)}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                  b.id === bookId
                    ? "border-primary/40 bg-card text-foreground shadow-sm"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {b.name}
              </button>
            ))
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
        </div>
        {!done && !reviewing && (
          <button
            type="button"
            onClick={skipCurrent}
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
                isFav={favorites.has(resultItem.entry.word)}
                isSaved={savedToMistakes.has(resultItem.entry.word)}
                onFav={() => toggleFavorite(resultItem.entry.word)}
                onSave={() => addToMistakes(resultItem)}
                onListen={() => speak(resultItem.entry.word)}
                onNext={() =>
                  reviewing
                    ? reviewIndex! < history.length - 1
                      ? goForward()
                      : setReviewIndex(null)
                    : next()
                }
                showMistouch={strict && resultItem.result.typoCount > 0}
                mistouched={mistouched.has(resultItem.entry.word)}
                onMistouch={() => markMistouch(resultItem.entry.word)}
              />
            )
          ) : (
            <>
              {prefs.meaning ? (
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <p className="font-display text-xl text-foreground">{entry.cn}</p>
                    <SpeakerButton word={entry.word} />
                  </div>
                  <p className="mt-1 font-mono text-sm text-muted-foreground">{entry.phonetic}</p>
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
                onComplete={onComplete}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
