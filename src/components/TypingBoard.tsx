import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { sfx } from "@/lib/sound";

export type TypingResult = {
  typoCount: number;
  mistouch: boolean;
  durationMs: number;
};

type Props = {
  target: string;
  size?: "word" | "sentence";
  paused?: boolean;
  /** dictation mode: untyped characters are hidden */
  masked?: boolean;
  onComplete: (result: TypingResult) => void;
};

export function TypingBoard({ target, size = "word", paused = false, masked = false, onComplete }: Props) {
  const [typed, setTyped] = useState("");
  const [typos, setTypos] = useState(0);
  const [mistouch, setMistouch] = useState(false);
  const [wrongAt, setWrongAt] = useState<number | null>(null);
  const startedAt = useRef<number | null>(null);
  const doneRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTyped("");
    setTypos(0);
    setMistouch(false);
    setWrongAt(null);
    startedAt.current = null;
    doneRef.current = false;
  }, [target]);

  const markMistouch = useCallback(() => {
    setTypos((n) => Math.max(0, n - 1));
    setMistouch(true);
    setWrongAt(null);
  }, []);

  useEffect(() => {
    if (paused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target_ = e.target as HTMLElement | null;
      if (
        target_ &&
        ["INPUT", "TEXTAREA"].includes(target_.tagName) &&
        target_ !== inputRef.current
      )
        return;

      if (e.key === "Backspace") {
        e.preventDefault();
        setTyped((t) => t.slice(0, -1));
        setWrongAt(null);
        return;
      }
      if (e.key.length !== 1) return;
      e.preventDefault();
      if (doneRef.current) return;
      if (startedAt.current === null) startedAt.current = performance.now();

      setTyped((prev) => {
        const expected = target[prev.length];
        if (expected === undefined) return prev;
        const ok = e.key === expected || (expected === " " && e.key === " ");
        if (!ok) {
          setTypos((n) => n + 1);
          setWrongAt(prev.length);
          sfx.wrong();
          window.setTimeout(() => setWrongAt(null), 260);
          return prev;
        }
        const next = prev + expected;
        sfx.key();
        if (next.length === target.length) {
          doneRef.current = true;
          sfx.complete();
          const duration = Math.round(performance.now() - (startedAt.current ?? performance.now()));
          window.setTimeout(() => {
            onComplete({ typoCount: typosRef.current, mistouch: mistouchRef.current, durationMs: duration });
          }, 0);
        }
        return next;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, paused, onComplete]);

  // keep latest values available inside the keydown closure
  const typosRef = useRef(0);
  const mistouchRef = useRef(false);
  useEffect(() => {
    typosRef.current = typos;
  }, [typos]);
  useEffect(() => {
    mistouchRef.current = mistouch;
  }, [mistouch]);

  const chars = target.split("");
  const big = size === "word";

  return (
    <div
      className="relative flex flex-col items-center gap-5"
      onPointerDown={() => {
        // summon the soft keyboard on touch devices
        if (!paused) inputRef.current?.focus({ preventScroll: true });
      }}
    >
      <input
        ref={inputRef}
        type="text"
        aria-label="输入拼写"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        tabIndex={-1}
        onInput={(e) => {
          // keep the hidden input empty; keys are handled via keydown
          e.currentTarget.value = "";
        }}
        className="pointer-events-none absolute top-0 left-1/2 h-px w-px opacity-0"
      />
      <div
        className={cn(
          "flex flex-wrap items-end justify-center gap-x-0 gap-y-3 font-mono tracking-tight select-none",
          big ? "text-5xl sm:text-6xl" : "text-2xl sm:text-3xl leading-relaxed max-w-3xl",
          wrongAt !== null && "shake-x",
        )}
      >
        {chars.map((ch, i) => {
          const done = i < typed.length;
          const current = i === typed.length;
          const isSpace = ch === " ";
          return (
            <span
              key={`${ch}-${i}`}
              className={cn(
                "relative inline-block",
                isSpace ? (big ? "w-4" : "w-2.5") : big ? "px-[0.06em]" : "px-[0.03em]",
                done ? "text-foreground char-pop" : "text-muted-foreground/35",
                current && wrongAt === i && "text-destructive",
              )}
            >
              {isSpace ? "\u00A0" : masked && !done ? "·" : ch}
              {current && (
                <span
                  className={cn(
                    "caret-blink absolute -bottom-2 left-0 right-0 mx-auto h-[3px] rounded-full",
                    wrongAt === i ? "bg-destructive" : "bg-primary",
                  )}
                />
              )}
            </span>
          );
        })}
      </div>

      <div className="flex h-8 items-center gap-3 text-xs text-muted-foreground">
        <span>
          错误 <span className="font-mono text-foreground">{typos}</span>
        </span>
        {mistouch && <span className="text-accent-foreground/70">已标记误触</span>}
        {(typos > 0 || wrongAt !== null) && !mistouch && (
          <button
            type="button"
            onClick={markMistouch}
            className="rise-in rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            刚才是误触
          </button>
        )}
      </div>
    </div>
  );
}
