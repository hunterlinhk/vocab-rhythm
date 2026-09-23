import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, PenLine, Sparkles, Volume2 } from "lucide-react";
import { TypingBoard, type TypingResult } from "@/components/TypingBoard";
import { ALL_WORDS, getBook, type WordEntry } from "@/data/words";
import { getLearningState, recordMemorizeStage, saveSettings } from "@/lib/learning.functions";
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

function pickOptions(entry: WordEntry): string[] {
  const seed = [...entry.word].reduce((n, c) => n + c.charCodeAt(0), 0);
  const pool = ALL_WORDS.filter((w) => w.cn !== entry.cn);
  const a = pool[seed % pool.length]!;
  const b = pool[(seed * 7 + 11) % pool.length]!;
  const distractors = [a.cn, b.cn === a.cn ? pool[(seed * 13 + 5) % pool.length]!.cn : b.cn];
  const all = [entry.cn, ...distractors];
  // deterministic rotation so the answer is not always first
  const shift = seed % 3;
  return [...all.slice(shift), ...all.slice(0, shift)];
}

function BoldSentence({ entry }: { entry: WordEntry }) {
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
  const persistSettings = useServerFn(saveSettings);
  const { data: state } = useQuery({ queryKey: ["learning-state"], queryFn: () => fetchState() });

  const [phase, setPhase] = useState<Phase>("context");
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [rightCount, setRightCount] = useState(0);
  const [masteredNow, setMasteredNow] = useState(0);
  const [spellOn, setSpellOn] = useState(true);

  useEffect(() => {
    if (state) setSpellOn(state.memorizeSpelling);
  }, [state]);

  const batch: WordEntry[] = useMemo(() => {
    const book = getBook(state?.activeBook || "core");
    const start = (state?.cursors[book.id] ?? 0) % Math.max(1, book.words.length);
    const list = [...book.words.slice(start), ...book.words.slice(0, start)];
    return list.slice(0, BATCH);
  }, [state]);

  const bookId = state?.activeBook || "core";
  const entry = batch[Math.min(index, batch.length - 1)];
  const options = useMemo(() => (entry ? pickOptions(entry) : []), [entry]);

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["stats"] });
    void qc.invalidateQueries({ queryKey: ["learning-state"] });
  }, [qc]);

  const advance = useCallback(
    (from: "context" | "recall") => {
      setPicked(null);
      if (index + 1 < batch.length) {
        setIndex(index + 1);
        return;
      }
      setIndex(0);
      setPhase(from === "context" ? "recall" : "done");
    },
    [index, batch.length],
  );

  const choose = useCallback(
    (option: string) => {
      if (!entry || picked) return;
      setPicked(option);
      const correct = option === entry.cn;
      if (correct) setRightCount((n) => n + 1);
      if (correct && phase === "context") speak(entry.word);
      void record({
        data: {
          word: entry.word,
          bookId,
          translation: entry.cn,
          stage: phase === "context" ? ("context" as const) : ("recall" as const),
          correct,
        },
      })
        .then(invalidate)
        .catch(() => undefined);

      window.setTimeout(() => {
        if (phase === "recall" && correct && spellOn) {
          setPicked(null);
          setPhase("spell");
        } else {
          advance(phase === "context" ? "context" : "recall");
        }
      }, correct ? 900 : 1600);
    },
    [entry, picked, phase, record, bookId, invalidate, spellOn, advance],
  );

  const onSpelled = useCallback(
    (r: TypingResult) => {
      if (!entry) return;
      speak(entry.word);
      setMasteredNow((n) => n + 1);
      void record({
        data: {
          word: entry.word,
          bookId,
          translation: entry.cn,
          stage: "spell" as const,
          correct: true,
          typoCount: r.typoCount,
          durationMs: r.durationMs,
        },
      })
        .then(invalidate)
        .catch(() => undefined);
      window.setTimeout(() => {
        setPhase("recall");
        advance("recall");
      }, 1200);
    },
    [entry, record, bookId, invalidate, advance],
  );

  const toggleSpell = () => {
    const next = !spellOn;
    setSpellOn(next);
    void persistSettings({ data: { memorizeSpelling: next } })
      .then(invalidate)
      .catch(() => undefined);
  };

  const restart = () => {
    setPhase("context");
    setIndex(0);
    setPicked(null);
    setRightCount(0);
    setMasteredNow(0);
  };

  if (!state || !entry) {
    return <div className="glass-stage flex min-h-[30rem] items-center justify-center">载入中…</div>;
  }

  const total = batch.length * 2;
  const stepDone = (phase === "context" ? index : batch.length + index) + (picked ? 1 : 0);
  const progress = Math.min(100, (stepDone / total) * 100);

  if (phase === "done") {
    return (
      <div className="glass-stage flex min-h-[30rem] flex-col items-center justify-center gap-5 text-center">
        <CheckCircle2 className="size-12 text-success" />
        <p className="font-display text-3xl">这一组背完了</p>
        <p className="text-sm text-muted-foreground">
          答对 {rightCount} / {total}
          {spellOn ? ` · 完成三轮强化 ${masteredNow} 词` : ""}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" onClick={restart} className="rounded-full bg-primary px-5 py-2 text-sm text-primary-foreground">
            再来一组
          </button>
          <Link to="/review" className="rounded-full border border-border bg-card px-5 py-2 text-sm">
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
            {phase === "context" ? "第一轮 · 语境选义" : phase === "recall" ? "第二轮 · 词义回忆" : "第三轮 · 拼写"}
          </span>
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
        </div>
        <div className="font-mono text-sm text-muted-foreground">
          {Math.min(index + 1, batch.length)} / {batch.length} · 答对 {rightCount}
        </div>
      </div>

      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-border/60">
        <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      <div className="glass-stage relative mt-6 flex min-h-[30rem] w-full flex-col items-center justify-center gap-7 px-4 py-10 sm:mt-10 sm:min-h-[33.25rem] sm:gap-9 sm:px-6 sm:py-14">
        {phase === "spell" ? (
          <div key={`s-${entry.word}`} className="nav-slide-left flex w-full flex-col items-center gap-7">
            <div className="flex flex-col items-center gap-2 text-center">
              <Sparkles className="size-5 text-primary" />
              <p className="text-lg text-foreground">{entry.cn}</p>
              <p className="font-mono text-sm text-muted-foreground">{entry.phonetic}</p>
            </div>
            <TypingBoard target={entry.word} size="word" onComplete={onSpelled} />
          </div>
        ) : (
          <div key={`${phase}-${entry.word}`} className="nav-slide-left flex w-full flex-col items-center gap-8">
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
                {entry.word} {entry.phonetic} · {entry.sentenceCn}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
