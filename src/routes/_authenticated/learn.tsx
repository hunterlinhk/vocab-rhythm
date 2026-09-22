import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
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
    ],
  }),
  component: LearnPage,
});

function LearnPage() {
  const save = useServerFn(recordAttempt);
  const [bookId, setBookId] = useState("core");
  const [queue, setQueue] = useState<WordEntry[]>(() => shuffle(getBook("core").words));
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<TypingResult | null>(null);
  const [sessionDone, setSessionDone] = useState(0);

  const entry = queue[index % queue.length]!;

  useEffect(() => {
    setQueue(shuffle(getBook(bookId).words));
    setIndex(0);
    setDone(null);
  }, [bookId]);

  const next = useCallback(() => {
    setDone(null);
    setIndex((i) => (i + 1) % queue.length);
  }, [queue.length]);

  const onComplete = useCallback(
    (r: TypingResult) => {
      setDone(r);
      setSessionDone((n) => n + 1);
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

  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(next, 1600);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        window.clearTimeout(t);
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [done, next]);

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

      <div className="card-surface mt-10 flex w-full flex-col items-center gap-8 rounded-3xl px-6 py-14">
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
        ) : (
          <p className="text-xs text-muted-foreground">直接用键盘输入 · Backspace 可退格</p>
        )}
      </div>
    </div>
  );
}
