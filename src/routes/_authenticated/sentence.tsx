import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { TypingBoard, type TypingResult } from "@/components/TypingBoard";
import { WORD_BOOKS, getBook, type WordEntry } from "@/data/words";
import { recordAttempt } from "@/lib/learning.functions";
import { speak } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { Volume2, BookOpen, PenLine, Languages } from "lucide-react";

export const Route = createFileRoute("/_authenticated/sentence")({
  head: () => ({
    meta: [
      { title: "句子拼写 · 韵词 Cadence" },
      { name: "description", content: "在真实语境中拼写英语句子，完成后查看中文译文与主谓宾结构。" },
      { property: "og:title", content: "句子拼写 · 韵词 Cadence" },
      { property: "og:description", content: "在语境中练习英语句子拼写，附中文译文与句子结构。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SentencePage,
});

type HistoryItem = { entry: WordEntry; result: TypingResult };

const PREF_KEY = "cadence:learn-prefs";

type Prefs = { speech: boolean; meaning: boolean; english: boolean; dictation: boolean };
const DEFAULT_PREFS: Prefs = { speech: true, meaning: true, english: true, dictation: false };

function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(window.localStorage.getItem(PREF_KEY) ?? "{}") as Partial<Prefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

function SpeakerButton({ text, className }: { text: string; className?: string }) {
  return (
    <button
      type="button"
      aria-label="播放发音"
      onClick={() => speak(text)}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-all duration-200 hover:scale-110 hover:bg-card/70 hover:text-primary",
        className,
      )}
    >
      <Volume2 className="size-4" />
    </button>
  );
}

function SentencePage() {
  const save = useServerFn(recordAttempt);
  const qc = useQueryClient();
  const [bookId, setBookId] = useState("core");
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<TypingResult | null>(null);
  const [sessionDone, setSessionDone] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [navDir, setNavDir] = useState<1 | -1>(1);
  const prefsRef = useRef<Prefs>(DEFAULT_PREFS);
  const dragX = useRef<number | null>(null);

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

  const queue = getBook(bookId).words;
  const entry = queue.length ? queue[Math.min(index, queue.length - 1)]! : undefined;
  const reviewing = reviewIndex !== null ? history[reviewIndex] : undefined;
  const panelResult = reviewing ? reviewing.result : done;
  const resultItem = reviewing ?? (done && entry ? { entry, result: done } : undefined);

  const next = useCallback(() => {
    setNavDir(1);
    setDone(null);
    setReviewIndex(null);
    setIndex((i) => (queue.length ? (i + 1) % queue.length : 0));
  }, [queue.length]);

  const switchBook = useCallback((id: string) => {
    setBookId(id);
    setIndex(0);
    setDone(null);
    setHistory([]);
    setReviewIndex(null);
  }, []);

  const onComplete = useCallback(
    (r: TypingResult) => {
      if (!entry) return;
      setDone(r);
      setSessionDone((n) => n + 1);
      setHistory((h) => [...h, { entry, result: r }]);
      if (prefsRef.current.speech) speak(entry.sentence);
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
      })
        .then(() => {
          void qc.invalidateQueries({ queryKey: ["stats"] });
          void qc.invalidateQueries({ queryKey: ["learning-state"] });
        })
        .catch(() => undefined);
    },
    [bookId, entry, save, qc],
  );

  const skipCurrent = useCallback(() => {
    if (!entry) return;
    void save({
      data: {
        mode: "sentence" as const,
        bookId,
        word: entry.word,
        translation: entry.cn,
        correct: true,
        mistouch: false,
        typoCount: 0,
        durationMs: 0,
        skipped: true,
      },
    })
      .then(() => void qc.invalidateQueries({ queryKey: ["learning-state"] }))
      .catch(() => undefined);
    next();
  }, [entry, bookId, save, qc, next]);

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

  // speak the sentence only once when a genuinely new one appears
  const sentence = entry?.sentence;
  const spokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sentence || done || reviewIndex !== null) return;
    const key = `${index}:${sentence}`;
    if (spokenRef.current === key) return;
    spokenRef.current = key;
    if (prefsRef.current.speech) speak(sentence);
  }, [sentence, index, done, reviewIndex]);

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

  const progress = queue.length ? (index / queue.length) * 100 : 0;

  if (!entry) return null;

  return (
    <div className="flex flex-col items-center overflow-x-clip pb-4">
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {WORD_BOOKS.map((b) => (
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
          ))}
        </div>
        <div className="font-mono text-sm text-muted-foreground">
          {index + 1} / {queue.length} · 本次 {sessionDone}
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
              { key: "meaning", on: prefs.meaning, icon: Languages, label: "中文" },
              { key: "english", on: prefs.english, icon: BookOpen, label: "英文" },
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
          key={reviewing ? `r-${reviewIndex}` : done ? `d-${entry.word}-${index}` : `s-${entry.word}-${index}`}
          className={cn(
            "flex w-full flex-col items-center gap-8",
            !done && (navDir === 1 ? "nav-slide-left" : "nav-slide-right"),
          )}
        >
          {reviewing || done ? (
            resultItem && (
              <div
                data-selectable
                className={cn("flex w-full flex-col items-center gap-7 select-text", !reviewing && "sweep-in")}
              >
                <div className="mx-auto flex w-[86%] max-w-3xl items-start justify-center gap-8 text-left sm:gap-14">
                  <div className="w-[45%] min-w-0">
                    <div className="flex items-start gap-1.5">
                      <p className="font-display text-2xl leading-snug">{resultItem.entry.sentence}</p>
                      <SpeakerButton text={resultItem.entry.sentence} />
                    </div>
                    {resultItem.entry.svo && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                        <Part label="主语" value={resultItem.entry.svo.s} />
                        <Part label="谓语" value={resultItem.entry.svo.v} />
                        {resultItem.entry.svo.o && <Part label="宾语" value={resultItem.entry.svo.o} />}
                      </div>
                    )}
                  </div>
                  <div className="w-[45%] min-w-0 self-center border-l border-border/50 pl-6 text-left sm:pl-10">
                    <p className="text-lg text-foreground">{resultItem.entry.sentenceCn}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      <span className="font-mono text-foreground">{resultItem.entry.word}</span>{" "}
                      <span className="font-mono">{resultItem.entry.phonetic}</span> · {resultItem.entry.cn}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap justify-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => speak(resultItem.entry.sentence)}
                    className="rounded-full border border-border bg-card px-4 py-1.5 text-sm hover:border-primary/40"
                  >
                    再听一次
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      reviewing
                        ? reviewIndex! < history.length - 1
                          ? goForward()
                          : setReviewIndex(null)
                        : next()
                    }
                    className="rounded-full bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:opacity-90"
                  >
                    下一个 →
                  </button>
                </div>
              </div>
            )
          ) : (
            <>
              {prefs.meaning || prefs.english ? (
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    {prefs.meaning && <p className="font-display text-xl text-foreground">{entry.sentenceCn}</p>}
                    <SpeakerButton text={entry.sentence} />
                  </div>
                  {prefs.english && (
                    <p className="mt-1 font-mono text-sm text-muted-foreground">
                      {entry.word} {entry.phonetic}
                    </p>
                  )}
                </div>
              ) : (
                <SpeakerButton text={entry.sentence} className="size-9" />
              )}

              <TypingBoard
                key={`${entry.word}-${index}`}
                target={entry.sentence}
                size="sentence"
                masked={prefs.dictation}
                onComplete={onComplete}
              />
            </>
          )}
        </div>
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
