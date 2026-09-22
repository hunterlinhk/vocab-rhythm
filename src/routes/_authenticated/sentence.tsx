import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { TypingBoard, type TypingResult } from "@/components/TypingBoard";
import { WORD_BOOKS, getBook, shuffle, type WordEntry } from "@/data/words";
import { recordAttempt } from "@/lib/learning.functions";
import { speak } from "@/lib/sound";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/sentence")({
  head: () => ({
    meta: [
      { title: "句子拼写 · 韵词 Cadence" },
      { name: "description", content: "在真实语境中拼写英语句子，完成后查看中文译文与主谓宾结构。" },
      { property: "og:title", content: "句子拼写 · 韵词 Cadence" },
      { property: "og:description", content: "在语境中练习英语句子拼写，附中文译文与句子结构。" },
    ],
  }),
  component: SentencePage,
});

function SentencePage() {
  const save = useServerFn(recordAttempt);
  const [bookId, setBookId] = useState("core");
  const [queue, setQueue] = useState<WordEntry[]>(() => shuffle(getBook("core").words));
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<TypingResult | null>(null);

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
      speak(entry.sentence);
      void save({
        data: {
          mode: "sentence" as const,
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [done, next]);

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
          {(index % queue.length) + 1} / {queue.length}
        </div>
      </div>

      <div className="card-surface mt-10 flex w-full flex-col items-center gap-8 rounded-3xl px-6 py-14">
        <p className="text-sm text-muted-foreground">
          围绕单词 <span className="font-mono text-foreground">{entry.word}</span> · {entry.cn}
        </p>

        <TypingBoard key={entry.sentence} target={entry.sentence} size="sentence" onComplete={onComplete} paused={!!done} />

        {done ? (
          <div className="sweep-in flex w-full max-w-2xl flex-col items-center gap-4 text-center">
            <div className="rounded-full bg-primary/10 px-4 py-1.5 text-sm text-primary">
              完成 · {(done.durationMs / 1000).toFixed(1)}s
              {done.typoCount === 0 ? " · 全对" : ` · ${done.typoCount} 次错误`}
            </div>
            <p className="font-display text-xl">{entry.sentenceCn}</p>
            {entry.svo && (
              <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
                <Part label="主语" value={entry.svo.s} />
                <Part label="谓语" value={entry.svo.v} />
                {entry.svo.o && <Part label="宾语" value={entry.svo.o} />}
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => speak(entry.sentence)}
                className="rounded-full border border-border bg-card px-4 py-1.5 text-sm hover:border-primary/40"
              >
                朗读句子
              </button>
              <button
                type="button"
                onClick={next}
                className="rounded-full bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:opacity-90"
              >
                下一句 ⏎
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">包含空格与标点 · Backspace 可退格</p>
        )}
      </div>
    </div>
  );
}

function Part({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-xl border border-border bg-card px-3 py-1.5">
      <span className="mr-2 text-xs text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </span>
  );
}
