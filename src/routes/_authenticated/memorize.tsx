import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, PenLine, Sparkles, Volume2 } from "lucide-react";
import { TypingBoard, type TypingResult } from "@/components/TypingBoard";
import { ALL_WORDS, hasMeaning, type MeaningfulEntry, type WordEntry } from "@/data/words";
import { useBook } from "@/hooks/use-library";
import {
  getLearningState,
  recordMemorizeStage,
  saveSettings,
  startMemorizeSession,
} from "@/lib/learning.functions";
import { attemptIdForStage, type MemorizeSession } from "@/lib/learning-session.shared";
import { speak } from "@/lib/sound";
import { cn } from "@/lib/utils";

const BATCH = 8;

export const Route = createFileRoute("/_authenticated/memorize")({
  head: () => ({
    meta: [
      { title: "背单词 · 韵词 Cadence" },
      { name: "description", content: "语境选义、词义回忆、拼写三轮强化记忆单词。" },
      { property: "og:title", content: "背单词 · 韵词 Cadence" },
      { property: "og:description", content: "三轮强化：句中认词、看词选义、动手拼写。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MemorizePage,
});

type Phase = "context" | "recall" | "spell" | "done";

function pickOptions(entry: MeaningfulEntry, extra: MeaningfulEntry[]): string[] {
  const seed = [...entry.word].reduce((n, c) => n + c.charCodeAt(0), 0);
  const pool = [...extra, ...ALL_WORDS].filter(hasMeaning).filter((w) => w.cn !== entry.cn);
  const a = pool[seed % pool.length]!;
  const b = pool[(seed * 7 + 11) % pool.length]!;
  const distractors = [a.cn, b.cn === a.cn ? pool[(seed * 13 + 5) % pool.length]!.cn : b.cn];
  const all = [entry.cn, ...distractors];
  // deterministic rotation so the answer is not always first
  const shift = seed % 3;
  return [...all.slice(shift), ...all.slice(0, shift)];
}

function BoldSentence({ entry }: { entry: WordEntry }) {
  if (!entry.sentence) {
    return <p className="font-display text-4xl font-semibold text-primary">{entry.word}</p>;
  }
  const stem = entry.word.slice(0, Math.max(3, entry.word.length - 2)).toLowerCase();
  return (
    <p className="max-w-2xl text-center text-2xl leading-relaxed sm:text-3xl">
      {entry.sentence.split(/(\s+)/).map((token, i) => {
        const clean = token.toLowerCase().replace(/[^a-z]/g, "");
        const hit = clean.length > 0 && clean.startsWith(stem);
        return hit ? (
          <strong key={i} className="font-display font-semibold text-primary">
            {token}
          </strong>
        ) : (
          <span key={i} className="text-muted-foreground">
            {token}
          </span>
        );
      })}
    </p>
  );
}

function MemorizePage() {
  const qc = useQueryClient();
  const fetchState = useServerFn(getLearningState);
  const record = useServerFn(recordMemorizeStage);
  const start = useServerFn(startMemorizeSession);
  const persistSettings = useServerFn(saveSettings);
  const { data: state } = useQuery({ queryKey: ["learning-state"], queryFn: () => fetchState() });

  const [session, setSession] = useState<MemorizeSession | null>(null);
  const [sessionBookId, setSessionBookId] = useState<string | null>(null);
  const [sessionRevision, setSessionRevision] = useState(0);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [spellOn, setSpellOn] = useState(true);
  const initializingRef = useRef<string | null>(null);

  useEffect(() => {
    if (state) setSpellOn(state.memorizeSpelling);
  }, [state]);

  const bookId = state?.activeBook || "core";
  const { book } = useBook(state ? bookId : null);
  // 选义环节只使用有中文释义的词条
  const meaningful = useMemo(() => (book?.words ?? []).filter(hasMeaning), [book]);
  const spellingOnly = !!book?.words.length && meaningful.length === 0;
  const activeSession = sessionBookId === bookId ? session : null;
  const batch = useMemo(() => {
    if (!book || !activeSession) return [];
    return activeSession.batchWords
      .map((word) => book.words.find((item) => item.word === word))
      .filter((item): item is WordEntry => !!item);
  }, [book, activeSession]);
  const phase: Phase = activeSession?.phase ?? "context";
  const index = activeSession?.itemIndex ?? 0;
  const entry = batch[index];
  const options = useMemo(
    () => (entry && hasMeaning(entry) ? pickOptions(entry, meaningful) : []),
    [entry, meaningful],
  );

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["stats"] });
    void qc.invalidateQueries({ queryKey: ["learning-state"] });
  }, [qc]);

  const beginSession = useCallback(
    async (startAt: number, expectedRevision: number) => {
      if (!book || book.words.length === 0) return;
      const wordCount = book.words.length;
      const normalizedStart = ((startAt % wordCount) + wordCount) % wordCount;
      const ordered = Array.from({ length: wordCount }, (_, offset) => {
        const position = (normalizedStart + offset) % wordCount;
        return { entry: book.words[position]!, position };
      });
      const selected = (
        spellingOnly ? ordered : ordered.filter(({ entry: item }) => hasMeaning(item))
      ).slice(0, BATCH);
      if (!selected.length) return;
      const result = await start({
        data: {
          bookId: book.id,
          cursorIndex: normalizedStart,
          expectedRevision,
          bookWordCount: wordCount,
          batchWords: selected.map(({ entry: item }) => item.word),
          batchWordIndices: selected.map(({ position }) => position),
          spellingOnly,
          spellingEnabled: spellOn,
        },
      });
      const sessionFitsBook =
        !!result.session &&
        result.session.bookWordCount === wordCount &&
        result.session.spellingOnly === spellingOnly &&
        result.session.batchWordIndices.every(
          (position, index) => book.words[position]?.word === result.session?.batchWords[index],
        ) &&
        (spellingOnly ||
          result.session.batchWordIndices.every((position) => hasMeaning(book.words[position]!)));
      if (result.session && sessionFitsBook) {
        setSession(result.session);
        setSessionBookId(book.id);
        setSessionRevision(result.revision);
        setCursorIndex(result.cursorIndex);
        setPicked(null);
        void qc.invalidateQueries({ queryKey: ["learning-state"] });
      } else {
        setSession(null);
        setSessionBookId(null);
        void qc.invalidateQueries({ queryKey: ["learning-state"] });
      }
      return result;
    },
    [book, spellingOnly, spellOn, start, qc],
  );

  useEffect(() => {
    if (!state || !book || !book.words.length || sessionBookId === book.id) return;
    const savedSession = state.memorizeSessions[book.id];
    const revision = state.progressRevisions[book.id]?.memorize ?? 0;
    const savedCursor = state.cursors[book.id]?.memorize ?? state.cursors[book.id]?.word ?? 0;
    const savedSessionFitsBook =
      !!savedSession &&
      savedSession.bookWordCount === book.words.length &&
      savedSession.spellingOnly === spellingOnly &&
      savedSession.batchWordIndices.every(
        (position, index) => book.words[position]?.word === savedSession.batchWords[index],
      ) &&
      (savedSession.spellingOnly ||
        savedSession.batchWordIndices.every((position) => hasMeaning(book.words[position]!)));
    if (savedSession && savedSessionFitsBook) {
      setSession(savedSession);
      setSessionBookId(book.id);
      setSessionRevision(revision);
      setCursorIndex(savedCursor);
      return;
    }
    const key = `${book.id}:${revision}:${savedCursor}`;
    if (initializingRef.current === key) return;
    initializingRef.current = key;
    void beginSession(savedCursor, revision)
      .then(() => {
        initializingRef.current = null;
      })
      .catch(() => {
        initializingRef.current = null;
      });
  }, [state, book, spellingOnly, sessionBookId, beginSession]);

  const choose = useCallback(
    (option: string) => {
      if (!entry || !activeSession || !hasMeaning(entry) || picked || busy || phase === "done")
        return;
      setPicked(option);
      setBusy(true);
      const correct = option === entry.cn;
      if (correct && phase === "context") speak(entry.word);
      void record({
        data: {
          word: entry.word,
          bookId,
          translation: entry.cn,
          stage: phase === "context" ? ("context" as const) : ("recall" as const),
          sessionId: activeSession.sessionId,
          attemptId: attemptIdForStage(activeSession, index, phase as "context" | "recall"),
          revision: sessionRevision,
          itemIndex: index,
          spellingEnabled: spellOn,
          correct,
        },
      })
        .then((result) => {
          window.setTimeout(
            () => {
              if (result.session) setSession(result.session);
              setSessionRevision(result.revision);
              setCursorIndex(result.cursorIndex);
              setPicked(null);
              setBusy(false);
              invalidate();
            },
            correct ? 900 : 1600,
          );
        })
        .catch(() => {
          setPicked(null);
          setBusy(false);
        });
    },
    [
      entry,
      activeSession,
      picked,
      busy,
      phase,
      index,
      record,
      bookId,
      sessionRevision,
      spellOn,
      invalidate,
    ],
  );

  const onSpelled = useCallback(
    (r: TypingResult) => {
      if (!entry || !activeSession || busy) return;
      speak(entry.word);
      setBusy(true);
      void record({
        data: {
          word: entry.word,
          bookId,
          translation: entry.cn,
          stage: "spell" as const,
          sessionId: activeSession.sessionId,
          attemptId: attemptIdForStage(activeSession, index, "spell"),
          revision: sessionRevision,
          itemIndex: index,
          spellingEnabled: spellOn,
          correct: true,
          typoCount: r.typoCount,
          durationMs: r.durationMs,
        },
      })
        .then((result) => {
          window.setTimeout(() => {
            if (result.session) setSession(result.session);
            setSessionRevision(result.revision);
            setCursorIndex(result.cursorIndex);
            setBusy(false);
            invalidate();
          }, 1200);
        })
        .catch(() => setBusy(false));
    },
    [entry, activeSession, busy, record, bookId, index, sessionRevision, spellOn, invalidate],
  );

  const toggleSpell = () => {
    const next = !spellOn;
    setSpellOn(next);
    void persistSettings({ data: { memorizeSpelling: next } })
      .then(invalidate)
      .catch(() => undefined);
  };

  const restart = () => {
    setBusy(true);
    void beginSession(cursorIndex, sessionRevision)
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  if (!state || !book || sessionBookId !== bookId || !activeSession || !entry) {
    return (
      <div className="glass-stage flex min-h-[30rem] items-center justify-center">
        {book && !book.words.length ? "这本词书暂无词条" : "载入中…"}
      </div>
    );
  }

  const currentSpellingOnly = activeSession.spellingOnly;
  const total = batch.length * (currentSpellingOnly ? 1 : 2);
  const stepDone = currentSpellingOnly
    ? index
    : (phase === "context" ? index : batch.length + index) + (picked ? 1 : 0);
  const progress = Math.min(100, (stepDone / total) * 100);

  if (phase === "done" || activeSession.status === "completed") {
    return (
      <div className="glass-stage flex min-h-[30rem] flex-col items-center justify-center gap-5 text-center">
        <CheckCircle2 className="size-12 text-success" />
        <p className="font-display text-3xl">这一组背完了</p>
        <p className="text-sm text-muted-foreground">
          {currentSpellingOnly
            ? `完成拼写 ${activeSession.masteredCount} / ${batch.length} 词`
            : `答对 ${activeSession.rightCount} / ${total}`}
          {!currentSpellingOnly && spellOn
            ? ` · 完成三轮强化 ${activeSession.masteredCount} 词`
            : ""}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={restart}
            disabled={busy}
            className="rounded-full bg-primary px-5 py-2 text-sm text-primary-foreground"
          >
            再来一组
          </button>
          <Link
            to="/review"
            className="rounded-full border border-border bg-card px-5 py-2 text-sm"
          >
            去复习
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center overflow-x-clip pb-4">
      <div className="focus-top flex w-full flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-primary/10 px-3.5 py-1.5 text-sm text-primary">
            {currentSpellingOnly
              ? "单词拼写"
              : phase === "context"
                ? "第一轮 · 语境选义"
                : phase === "recall"
                  ? "第二轮 · 词义回忆"
                  : "第三轮 · 拼写"}
          </span>
          {!currentSpellingOnly && (
            <button
              type="button"
              onClick={toggleSpell}
              aria-pressed={spellOn}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-all duration-300",
                spellOn
                  ? "bg-card/70 text-primary shadow-[0_6px_16px_-12px_var(--ink)]"
                  : "text-muted-foreground/60 hover:bg-card/40 hover:text-muted-foreground",
              )}
            >
              <PenLine className="size-3.5" />
              拼写轮
            </button>
          )}
        </div>
        <div className="font-mono text-sm text-muted-foreground">
          {Math.min(index + 1, batch.length)} / {batch.length} ·{" "}
          {currentSpellingOnly
            ? `完成 ${activeSession.masteredCount}`
            : `答对 ${activeSession.rightCount}`}
        </div>
      </div>

      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-border/60">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="glass-stage relative mt-6 flex min-h-[30rem] w-full flex-col items-center justify-center gap-7 px-4 py-10 sm:mt-10 sm:min-h-[33.25rem] sm:gap-9 sm:px-6 sm:py-14">
        {phase === "spell" || currentSpellingOnly ? (
          <div
            key={`s-${entry.word}`}
            className="nav-slide-left flex w-full flex-col items-center gap-7"
          >
            <div className="flex flex-col items-center gap-2 text-center">
              <Sparkles className="size-5 text-primary" />
              <p className="text-lg text-foreground">{entry.cn || entry.word}</p>
              {entry.phonetic && (
                <p className="font-mono text-sm text-muted-foreground">{entry.phonetic}</p>
              )}
            </div>
            <TypingBoard target={entry.word} size="word" onComplete={onSpelled} />
          </div>
        ) : (
          <div
            key={`${phase}-${entry.word}`}
            className="nav-slide-left flex w-full flex-col items-center gap-8"
          >
            {phase === "context" ? (
              <BoldSentence entry={entry} />
            ) : (
              <div className="flex flex-col items-center gap-2">
                <p className="font-display text-5xl">{entry.word}</p>
                <button
                  type="button"
                  onClick={() => speak(entry.word)}
                  aria-label="播放发音"
                  className="rounded-full p-2 text-muted-foreground transition-colors hover:text-primary"
                >
                  <Volume2 className="size-4" />
                </button>
              </div>
            )}

            <div className="grid w-full max-w-lg gap-2.5">
              {options.map((option) => {
                const isRight = option === entry.cn;
                const chosen = picked === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => choose(option)}
                    disabled={!!picked}
                    className={cn(
                      "glass-lift rounded-2xl px-5 py-4 text-left text-base transition-all duration-300",
                      !picked && "hover:text-foreground",
                      picked && isRight && "bg-success/15 text-foreground",
                      chosen && !isRight && "bg-destructive/12 text-destructive",
                      !picked && "bg-card/50 text-muted-foreground",
                    )}
                  >
                    {option}
                  </button>
                );
              })}
            </div>

            {picked && phase === "context" && (
              <p className="rise-in text-sm text-muted-foreground">
                {entry.word}
                {entry.phonetic ? ` ${entry.phonetic}` : ""}
                {entry.sentenceCn ? ` · ${entry.sentenceCn}` : ""}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
