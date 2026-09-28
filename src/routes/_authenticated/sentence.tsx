import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { TypingBoard, type TypingResult } from "@/components/TypingBoard";
import { hasSentence, type SentenceEntry } from "@/data/words";
import { useBook, useLibrary } from "@/hooks/use-library";
import { useLearningState } from "@/hooks/use-learning-state";
import {
  completeSentenceCheckpoint,
  saveSettings,
  startSentenceCheckpoint,
} from "@/lib/learning.functions";
import type { SentenceCheckpoint } from "@/lib/learning-session.shared";
import { queueLearningStateWrite } from "@/lib/learning-state.runtime";
import {
  loadSentenceCursor,
  nextSentenceCursor,
  saveSentenceCursor,
} from "@/lib/sentence-progress";
import { speak } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { Volume2, BookOpen, PenLine, Languages } from "lucide-react";

export const Route = createFileRoute("/_authenticated/sentence")({
  head: () => ({
    meta: [
      { title: "句子拼写 · 韵词 Cadence" },
      {
        name: "description",
        content: "在真实语境中拼写英语句子，完成后查看中文译文与主谓宾结构。",
      },
      { property: "og:title", content: "句子拼写 · 韵词 Cadence" },
      { property: "og:description", content: "在语境中练习英语句子拼写，附中文译文与句子结构。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SentencePage,
});

type HistoryItem = { entry: SentenceEntry; result: TypingResult };
type ActiveSentenceCheckpoint = {
  bookId: string;
  cursorIndex: number;
  revision: number;
  checkpoint: SentenceCheckpoint;
};

const PREF_KEY = "cadence:learn-prefs";

type Prefs = { speech: boolean; meaning: boolean; english: boolean; dictation: boolean };
const DEFAULT_PREFS: Prefs = { speech: true, meaning: true, english: true, dictation: false };

function loadPrefs(): Prefs {
  try {
    return {
      ...DEFAULT_PREFS,
      ...(JSON.parse(window.localStorage.getItem(PREF_KEY) ?? "{}") as Partial<Prefs>),
    };
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
  const startCheckpoint = useServerFn(startSentenceCheckpoint);
  const completeCheckpoint = useServerFn(completeSentenceCheckpoint);
  const persistSettings = useServerFn(saveSettings);
  const qc = useQueryClient();
  const { data: learningState, isAuthoritative: stateIsAuthoritative } = useLearningState();
  const [bookId, setBookId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [checkpoint, setCheckpoint] = useState<ActiveSentenceCheckpoint | null>(null);
  const [savingCheckpoint, setSavingCheckpoint] = useState(false);
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState<TypingResult | null>(null);
  const [sessionDone, setSessionDone] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [navDir, setNavDir] = useState<1 | -1>(1);
  const prefsRef = useRef<Prefs>(DEFAULT_PREFS);
  const dragX = useRef<number | null>(null);
  const syncingRef = useRef<string | null>(null);

  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);
  useEffect(() => setPrefs(loadPrefs()), []);
  useEffect(() => {
    if (!learningState || !stateIsAuthoritative || ready) return;
    const initialBook = learningState.activeBook || "core";
    setBookId(initialBook);
    const serverCursor = learningState.cursors[initialBook]?.sentence;
    const initialIndex = serverCursor ?? loadSentenceCursor(window.localStorage, initialBook);
    setIndex(initialIndex);
    const savedCheckpoint = learningState.sentenceSessions[initialBook];
    if (savedCheckpoint) {
      setCheckpoint({
        bookId: initialBook,
        cursorIndex: initialIndex,
        revision: learningState.progressRevisions[initialBook]?.sentence ?? 0,
        checkpoint: savedCheckpoint,
      });
    }
    setReady(true);
  }, [learningState, stateIsAuthoritative, ready]);
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

  const { all: allBooks } = useLibrary();
  const { book: currentBook } = useBook(bookId);
  // 只使用有例句的词条，缺失例句的词自动跳过
  const queue = useMemo(() => (currentBook?.words ?? []).filter(hasSentence), [currentBook]);
  const entry = queue.length ? queue[Math.min(index, queue.length - 1)]! : undefined;

  useEffect(() => {
    if (!ready || !stateIsAuthoritative || !bookId || !queue.length || !learningState || done) return;
    const matchingCheckpoint = checkpoint?.bookId === bookId ? checkpoint : null;
    const targetIndex =
      matchingCheckpoint?.cursorIndex ?? learningState.cursors[bookId]?.sentence ?? index;
    const normalizedIndex = ((targetIndex % queue.length) + queue.length) % queue.length;
    const targetEntry = queue[normalizedIndex];
    if (!targetEntry) return;
    if (
      matchingCheckpoint &&
      matchingCheckpoint.checkpoint.activeWord === targetEntry.word &&
      matchingCheckpoint.checkpoint.queueLength === queue.length
    ) {
      if (index !== normalizedIndex) setIndex(normalizedIndex);
      return;
    }

    const expectedRevision =
      matchingCheckpoint?.revision ?? learningState.progressRevisions[bookId]?.sentence ?? 0;
    const syncKey = `${bookId}:${expectedRevision}:${normalizedIndex}:${queue.length}:${targetEntry.word}`;
    if (syncingRef.current === syncKey) return;
    syncingRef.current = syncKey;
    void queueLearningStateWrite(() =>
      startCheckpoint({
        data: {
          bookId,
          cursorIndex: normalizedIndex,
          expectedRevision,
          queueLength: queue.length,
          activeWord: targetEntry.word,
        },
      }),
    )
      .then((result) => {
        const resultIndex = ((result.cursorIndex % queue.length) + queue.length) % queue.length;
        setIndex(resultIndex);
        saveSentenceCursor(window.localStorage, bookId, resultIndex);
        if (result.checkpoint) {
          setCheckpoint({
            bookId,
            cursorIndex: resultIndex,
            revision: result.revision,
            checkpoint: result.checkpoint,
          });
        }
        if (!result.accepted) void qc.invalidateQueries({ queryKey: ["learning-state"] });
      })
      .catch(() => undefined)
      .finally(() => {
        syncingRef.current = null;
      });
  }, [ready, stateIsAuthoritative, bookId, queue, learningState, checkpoint, index, done, startCheckpoint, qc]);
  const reviewing = reviewIndex !== null ? history[reviewIndex] : undefined;
  const panelResult = reviewing ? reviewing.result : done;
  const resultItem = reviewing ?? (done && entry ? { entry, result: done } : undefined);

  const next = useCallback(() => {
    setNavDir(1);
    setDone(null);
    setReviewIndex(null);
    const nextIndex =
      checkpoint?.bookId === bookId
        ? checkpoint.cursorIndex
        : nextSentenceCursor(index, queue.length);
    setIndex(nextIndex);
    if (bookId) saveSentenceCursor(window.localStorage, bookId, nextIndex);
  }, [bookId, queue.length, checkpoint, index]);

  const switchBook = useCallback(
    (id: string) => {
      setReady(true);
      setBookId(id);
      const serverCursor = learningState?.cursors[id]?.sentence;
      setIndex(serverCursor ?? loadSentenceCursor(window.localStorage, id));
      setCheckpoint(null);
      setDone(null);
      setHistory([]);
      setReviewIndex(null);
      void queueLearningStateWrite(() => persistSettings({ data: { activeBook: id } }))
        .then(() => void qc.invalidateQueries({ queryKey: ["learning-state"] }))
        .catch(() => undefined);
    },
    [learningState, persistSettings, qc],
  );

  useEffect(() => {
    if (!bookId || !queue.length || index < queue.length) return;
    const normalized = index % queue.length;
    setIndex(normalized);
    if (bookId) saveSentenceCursor(window.localStorage, bookId, normalized);
  }, [bookId, index, queue.length]);

  const onComplete = useCallback(
    async (r: TypingResult) => {
      if (!entry || !bookId || checkpoint?.bookId !== bookId || savingCheckpoint) return;
      const entryBookId = entry.bookId ?? bookId;
      if (!entryBookId) return;
      setSavingCheckpoint(true);
      try {
        const nextIndex = nextSentenceCursor(index, queue.length);
        const result = await queueLearningStateWrite(() =>
          completeCheckpoint({
            data: {
              bookId: entryBookId,
              word: entry.word,
              nextWord: queue[nextIndex]!.word,
              translation: entry.cn,
              attemptId: checkpoint.checkpoint.attemptId,
              revision: checkpoint.revision,
              queueLength: queue.length,
              correct: true,
              mistouch: r.mistouch,
              typoCount: r.typoCount,
              durationMs: r.durationMs,
            },
          }),
        );
        if (!result.accepted || !result.checkpoint) {
          setIndex(result.cursorIndex);
          setCheckpoint(
            result.checkpoint
              ? {
                  bookId,
                  cursorIndex: result.cursorIndex,
                  revision: result.revision,
                  checkpoint: result.checkpoint,
                }
              : null,
          );
          return;
        }
        setCheckpoint({
          bookId,
          cursorIndex: result.cursorIndex,
          revision: result.revision,
          checkpoint: result.checkpoint,
        });
        if (result.attempt?.skipped) {
          setIndex(result.cursorIndex);
          return;
        }
        saveSentenceCursor(window.localStorage, entryBookId, result.cursorIndex);
        const persistedResult = result.attempt
          ? {
              ...r,
              typoCount: result.attempt.typo_count,
              mistouch: result.attempt.mistouch,
              durationMs: result.attempt.duration_ms,
            }
          : r;
        setDone(persistedResult);
        setSessionDone((n) => n + 1);
        setHistory((h) => [...h, { entry, result: persistedResult }]);
        if (prefsRef.current.speech) speak(entry.sentence);
        void qc.invalidateQueries({ queryKey: ["stats"] });
        void qc.invalidateQueries({ queryKey: ["learning-state"] });
      } catch {
        // The server checkpoint remains authoritative; retrying reuses its attempt id.
      } finally {
        setSavingCheckpoint(false);
      }
    },
    [bookId, entry, checkpoint, savingCheckpoint, completeCheckpoint, qc, index, queue],
  );

  const skipCurrent = useCallback(async () => {
    if (!entry || !bookId || checkpoint?.bookId !== bookId || savingCheckpoint) return;
    const entryBookId = entry.bookId ?? bookId;
    if (!entryBookId) return;
    setSavingCheckpoint(true);
    try {
      const nextIndex = nextSentenceCursor(index, queue.length);
      const result = await queueLearningStateWrite(() =>
        completeCheckpoint({
          data: {
            bookId: entryBookId,
            word: entry.word,
            nextWord: queue[nextIndex]!.word,
            translation: entry.cn,
            attemptId: checkpoint.checkpoint.attemptId,
            revision: checkpoint.revision,
            queueLength: queue.length,
            correct: true,
            mistouch: false,
            typoCount: 0,
            durationMs: 0,
            skipped: true,
          },
        }),
      );
      setCheckpoint(
        result.checkpoint
          ? {
              bookId,
              cursorIndex: result.cursorIndex,
              revision: result.revision,
              checkpoint: result.checkpoint,
            }
          : null,
      );
      setIndex(result.cursorIndex);
      saveSentenceCursor(window.localStorage, bookId, result.cursorIndex);
      setDone(null);
      setReviewIndex(null);
      if (result.accepted) void qc.invalidateQueries({ queryKey: ["learning-state"] });
    } catch {
      // Keep the current item visible so the user can retry if the server is unavailable.
    } finally {
      setSavingCheckpoint(false);
    }
  }, [entry, bookId, checkpoint, savingCheckpoint, completeCheckpoint, index, queue, qc]);

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
    const key = `${bookId}:${index}:${sentence}`;
    if (spokenRef.current === key) return;
    spokenRef.current = key;
    if (prefsRef.current.speech) speak(sentence);
  }, [bookId, sentence, index, done, reviewIndex]);

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

  const bookStrip = allBooks.map((b) => (
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
  ));

  if (
    !entry ||
    !checkpoint ||
    checkpoint.bookId !== bookId ||
    checkpoint.checkpoint.activeWord !== entry.word ||
    checkpoint.checkpoint.queueLength !== queue.length
  )
    return (
      <div className="flex flex-col items-center overflow-x-clip pb-4">
        <div className="focus-top flex w-full flex-wrap items-center gap-1.5">
          <span className="px-1 text-sm text-muted-foreground">
            当前词书：{currentBook?.name ?? "载入中"}
          </span>
          {bookStrip}
        </div>
        <div className="glass-stage mt-6 flex min-h-[30rem] w-full items-center justify-center">
          <p className="font-display text-2xl text-muted-foreground">
            {currentBook && queue.length === 0 ? "暂无例句" : "载入中…"}
          </p>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col items-center overflow-x-clip pb-4">
      <div className="focus-top flex w-full flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="px-1 text-sm text-muted-foreground">当前词书：{currentBook?.name}</span>
          {bookStrip}
        </div>
        <div className="font-mono text-sm text-muted-foreground">
          {index + 1} / {queue.length} · 本次 {sessionDone}
        </div>
      </div>

      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-border/60">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
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
          key={
            reviewing
              ? `r-${reviewIndex}`
              : done
                ? `d-${entry.word}-${index}`
                : `s-${entry.word}-${index}`
          }
          className={cn(
            "flex w-full flex-col items-center gap-8",
            !done && (navDir === 1 ? "nav-slide-left" : "nav-slide-right"),
          )}
        >
          {reviewing || done ? (
            resultItem && (
              <div
                data-selectable
                className={cn(
                  "flex w-full flex-col items-center gap-5 select-text sm:gap-7",
                  !reviewing && "sweep-in",
                )}
              >
                <div className="mx-auto flex w-full max-w-3xl flex-col items-stretch gap-5 px-2 text-left sm:w-[86%] sm:flex-row sm:items-start sm:justify-center sm:gap-14 sm:px-0">
                  <div className="w-full min-w-0 sm:w-[45%]">
                    <div className="flex items-start gap-1.5">
                      <p className="whitespace-nowrap font-display text-xl leading-snug sm:whitespace-normal sm:text-2xl">
                        {resultItem.entry.sentence}
                      </p>
                      <SpeakerButton text={resultItem.entry.sentence} />
                    </div>
                    {resultItem.entry.svo && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                        <Part label="主语" value={resultItem.entry.svo.s} />
                        <Part label="谓语" value={resultItem.entry.svo.v} />
                        {resultItem.entry.svo.o && (
                          <Part label="宾语" value={resultItem.entry.svo.o} />
                        )}
                      </div>
                    )}
                  </div>
                  <div className="w-full min-w-0 border-t border-border/40 pt-4 text-left sm:w-[45%] sm:self-center sm:border-t-0 sm:border-l sm:border-border/50 sm:pt-0 sm:pl-10">
                    <div className="rounded-2xl bg-secondary/45 px-4 py-4 sm:rounded-none sm:bg-transparent sm:p-0">
                      {resultItem.entry.sentenceCn && (
                        <p className="whitespace-nowrap text-base text-foreground sm:text-lg">
                          {resultItem.entry.sentenceCn}
                        </p>
                      )}
                      <p className="mt-1 whitespace-nowrap text-sm text-muted-foreground">
                        <span className="font-mono text-foreground">{resultItem.entry.word}</span>{" "}
                        {resultItem.entry.phonetic && (
                          <span className="font-mono">{resultItem.entry.phonetic}</span>
                        )}
                        {resultItem.entry.cn && <> · {resultItem.entry.cn}</>}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="grid w-full grid-cols-2 gap-2 pt-1 sm:flex sm:w-auto sm:flex-wrap sm:justify-center">
                  <button
                    type="button"
                    onClick={() => speak(resultItem.entry.sentence)}
                    className="whitespace-nowrap rounded-full border border-border bg-card px-4 py-2 text-sm hover:border-primary/40 sm:py-1.5"
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
                    className="whitespace-nowrap rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90 sm:py-1.5"
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
                    {prefs.meaning && entry.sentenceCn && (
                      <p className="font-display text-xl text-foreground">{entry.sentenceCn}</p>
                    )}
                    <SpeakerButton text={entry.sentence} />
                  </div>
                  {prefs.english && (
                    <p className="mt-1 font-mono text-sm text-muted-foreground">
                      {entry.word}
                      {entry.phonetic ? ` ${entry.phonetic}` : ""}
                    </p>
                  )}
                </div>
              ) : (
                <SpeakerButton text={entry.sentence} className="size-9" />
              )}

              <TypingBoard
                key={`${bookId}-${entry.word}-${index}`}
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
