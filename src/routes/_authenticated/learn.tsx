import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { TypingBoard, type TypingResult } from "@/components/TypingBoard";
import { WORD_BOOKS, getBook, shuffle, type WordEntry } from "@/data/words";
import { recordAttempt } from "@/lib/learning.functions";
import { speak } from "@/lib/sound";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/learn")({
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

function loadFavorites(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(FAV_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function LearnPage() {
  const save = useServerFn(recordAttempt);
  const [bookId, setBookId] = useState("core");
  const [queue, setQueue] = useState<WordEntry[]>(() => shuffle(getBook("core").words));
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<TypingResult | null>(null);
  const [sessionDone, setSessionDone] = useState(0);
  // completed words this session, newest last
  const [history, setHistory] = useState<HistoryItem[]>([]);
  // null = typing current word; number = reviewing history[reviewIndex] (permanent)
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());
  const [savedToMistakes, setSavedToMistakes] = useState<Set<string>>(new Set());
  const dragX = useRef<number | null>(null);

  const entry = queue[index % queue.length]!;
  const reviewing = reviewIndex !== null ? history[reviewIndex] : undefined;

  useEffect(() => {
    setQueue(shuffle(getBook(bookId).words));
    setIndex(0);
    setDone(null);
    setHistory([]);
    setReviewIndex(null);
  }, [bookId]);

  // navigation direction for slide animation: 1 = forward, -1 = back
  const [navDir, setNavDir] = useState<1 | -1>(1);

  const next = useCallback(() => {
    setNavDir(1);
    setDone(null);
    setReviewIndex(null);
    setIndex((i) => (i + 1) % queue.length);
  }, [queue.length]);

  const onComplete = useCallback(
    (r: TypingResult) => {
      setDone(r);
      setSessionDone((n) => n + 1);
      setHistory((h) => [...h, { entry, result: r }]);
      speak(entry.word);
      void save({
        data: {
          mode: "word" as const,
          bookId,
          word: entry.word,
          translation: entry.cn,
          correct: true,
          mistouch: r.mistouch,
          typoCount: r.typoCount,
          durationMs: r.durationMs,
        },
      }).catch(() => undefined);
    },
    [bookId, entry, save],
  );

  const goBack = useCallback(() => {
    if (history.length === 0) return;
    setNavDir(-1);
    setReviewIndex((cur) => {
      if (cur === null) return history.length - 1;
      return Math.max(0, cur - 1);
    });
  }, [history.length]);

  const goForward = useCallback(() => {
    setNavDir(1);
    setReviewIndex((cur) => {
      if (cur === null) return cur;
      if (cur >= history.length - 1) return null; // back to typing the current word
      return cur + 1;
    });
  }, [history.length]);

  // auto-advance after 3s when the reveal shows
  useEffect(() => {
    if (!done || reviewIndex !== null) return;
    const t = window.setTimeout(next, 3000);
    return () => window.clearTimeout(t);
  }, [done, next, reviewIndex]);

  // keyboard: ← back / → forward when reviewing or typing
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

  // drag right to go back, drag left to go forward — content follows the pointer
  const [dragDx, setDragDx] = useState(0);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // don't hijack pointer from buttons/interactive elements — they need their click
    if ((e.target as HTMLElement).closest("button, a, input, textarea")) return;
    dragX.current = e.clientX;
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragX.current === null) return;
    const dx = e.clientX - dragX.current;
    // resist when moving in a direction that cannot navigate
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
          bookId,
          word: item.entry.word,
          translation: item.entry.cn,
          correct: false,
          mistouch: false,
          typoCount: Math.max(1, item.result.typoCount),
          durationMs: item.result.durationMs,
        },
      }).catch(() => undefined);
    },
    [bookId, save, savedToMistakes],
  );

  const progress = useMemo(() => ((index % queue.length) / queue.length) * 100, [index, queue.length]);

  return (
    <div className="flex flex-col items-center">
      <div className="flex w-full items-center justify-between gap-4">
        <div className="flex gap-1.5">
          {WORD_BOOKS.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setBookId(b.id)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                b.id === bookId
                  ? "border-primary/40 bg-card text-foreground shadow-sm"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {b.name}
            </button>
          ))}
        </div>
        <div className="font-mono text-sm text-muted-foreground">
          {(index % queue.length) + 1} / {queue.length} · 本次 {sessionDone}
        </div>
      </div>

      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-border/60">
        <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      <div
        className="glass-stage mt-10 flex w-full touch-pan-y flex-col items-center gap-8 px-6 py-14 select-none"
        style={dragStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {reviewing ? (
          <div className="sweep-in flex flex-col items-center gap-4 text-center">
            <div className="rounded-full bg-accent/60 px-4 py-1 text-xs text-accent-foreground">
              回顾 · {reviewIndex! + 1} / {history.length} · ← → 切换
            </div>
            <p className="font-display text-4xl">{reviewing.entry.word}</p>
            <p className="font-mono text-sm text-muted-foreground">{reviewing.entry.phonetic}</p>
            <p className="text-lg text-foreground">{reviewing.entry.cn}</p>
            <div className="mt-1 space-y-1">
              <p className="text-sm text-muted-foreground">{reviewing.entry.sentence}</p>
              <p className="text-sm text-muted-foreground/80">{reviewing.entry.sentenceCn}</p>
            </div>
            <div className="rounded-full bg-primary/10 px-4 py-1.5 text-sm text-primary">
              {(reviewing.result.durationMs / 1000).toFixed(1)}s
              {reviewing.result.typoCount === 0 ? " · 全对" : ` · ${reviewing.result.typoCount} 次错误`}
              {reviewing.result.mistouch ? " · 含误触" : ""}
            </div>
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => speak(reviewing.entry.word)}
                className="rounded-full border border-border bg-card px-4 py-1.5 text-sm hover:border-primary/40"
              >
                再听一次
              </button>
              <button
                type="button"
                onClick={() => toggleFavorite(reviewing.entry.word)}
                className={cn(
                  "rounded-full border px-4 py-1.5 text-sm transition-colors",
                  favorites.has(reviewing.entry.word)
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-card hover:border-primary/40",
                )}
              >
                {favorites.has(reviewing.entry.word) ? "已收藏 ★" : "收藏 ☆"}
              </button>
              <button
                type="button"
                onClick={() => addToMistakes(reviewing)}
                disabled={savedToMistakes.has(reviewing.entry.word)}
                className={cn(
                  "rounded-full border px-4 py-1.5 text-sm transition-colors",
                  savedToMistakes.has(reviewing.entry.word)
                    ? "border-border bg-card text-muted-foreground"
                    : "border-border bg-card hover:border-primary/40",
                )}
              >
                {savedToMistakes.has(reviewing.entry.word) ? "已加入错题本" : "加入错题本"}
              </button>
              <button
                type="button"
                onClick={() => (reviewIndex! < history.length - 1 ? goForward() : setReviewIndex(null))}
                className="rounded-full bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:opacity-90"
              >
                下一个 →
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="text-center">
              <p className="font-display text-xl text-foreground">{entry.cn}</p>
              <p className="mt-1 font-mono text-sm text-muted-foreground">{entry.phonetic}</p>
            </div>

            <TypingBoard key={entry.word} target={entry.word} onComplete={onComplete} paused={!!done} />

            {done ? (
              <div className="sweep-in flex flex-col items-center gap-3 text-center">
                <div className="rounded-full bg-primary/10 px-4 py-1.5 text-sm text-primary">
                  完成 · {(done.durationMs / 1000).toFixed(1)}s
                  {done.typoCount === 0 ? " · 全对" : ` · ${done.typoCount} 次错误`}
                </div>
                <p className="font-display text-2xl">{entry.word}</p>
                <p className="text-sm text-muted-foreground">{entry.sentence}</p>
                <p className="text-sm text-muted-foreground/80">{entry.sentenceCn}</p>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => speak(entry.word)}
                    className="rounded-full border border-border bg-card px-4 py-1.5 text-sm hover:border-primary/40"
                  >
                    再听一次
                  </button>
                  <button
                    type="button"
                    onClick={next}
                    className="rounded-full bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:opacity-90"
                  >
                    下一个 ⏎
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
