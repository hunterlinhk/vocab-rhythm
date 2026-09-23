import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { sfx } from "@/lib/sound";

const isPunct = (ch: string) => ch !== " " && !/[\p{L}\p{N}]/u.test(ch);
const skipPunct = (target: string, from: number) => {
  let i = from;
  while (i < target.length && isPunct(target[i]!)) i += 1;
  return i;
};

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
  const typedRef = useRef("");
  const typosRef = useRef(0);
  const mistouchRef = useRef(false);

  useEffect(() => {
    setTyped("");
    setTypos(0);
    setMistouch(false);
    setWrongAt(null);
    startedAt.current = null;
    doneRef.current = false;
    typedRef.current = "";
    typosRef.current = 0;
    mistouchRef.current = false;
  }, [target]);

  const markMistouch = useCallback(() => {
    typosRef.current = Math.max(0, typosRef.current - 1);
    mistouchRef.current = true;
    setTypos(typosRef.current);
    setMistouch(true);
    setWrongAt(null);
  }, []);

  const handleBackspace = useCallback(() => {
    let n = typedRef.current.length;
    while (n > 0 && isPunct(target[n - 1]!)) n -= 1;
    typedRef.current = target.slice(0, Math.max(0, n - 1));
    setTyped(typedRef.current);
    setWrongAt(null);
  }, [target]);

  const handleChar = useCallback(
    (key: string) => {
      if (doneRef.current) return;
      if (startedAt.current === null) startedAt.current = performance.now();

      const prev = typedRef.current;
      // punctuation is never typed by the user: skip over it
      let i = skipPunct(target, prev.length);
      const expected = target[i];
      if (expected === undefined) return;

      if (key.toLowerCase() !== expected.toLowerCase()) {
        typosRef.current += 1;
        setTypos(typosRef.current);
        setWrongAt(i);
        sfx.wrong();
        window.setTimeout(() => setWrongAt(null), 260);
        return;
      }

      const next = target.slice(0, skipPunct(target, i + 1));
      typedRef.current = next;
      setTyped(next);
      sfx.key();
      if (next.length === target.length) {
        doneRef.current = true;
        sfx.complete();
        const duration = Math.round(performance.now() - (startedAt.current ?? performance.now()));
        const result = { typoCount: typosRef.current, mistouch: mistouchRef.current, durationMs: duration };
        window.setTimeout(() => onComplete(result), 0);
      }
    },
    [target, onComplete],
  );

  // some mobile keyboards report key "Unidentified"; fall back to the input event data
  const keyHandledRef = useRef(false);

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

      keyHandledRef.current = true;
      if (e.key === "Backspace") {
        e.preventDefault();
        handleBackspace();
        return;
      }
      if (e.key.length !== 1) {
        keyHandledRef.current = e.key !== "Unidentified";
        return;
      }
      e.preventDefault();
      handleChar(e.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, paused, handleChar, handleBackspace]);

  const onHiddenInput = useCallback(
    (e: React.FormEvent<HTMLInputElement>) => {
      const el = e.currentTarget;
      if (!keyHandledRef.current) {
        const data = (e.nativeEvent as InputEvent).data;
        if (data) {
          for (const ch of data) {
            if (ch.length === 1) handleChar(ch);
          }
        } else if ((e.nativeEvent as InputEvent).inputType === "deleteContentBackward") {
          handleBackspace();
        }
      }
      keyHandledRef.current = false;
      el.value = "";
    },
    [handleChar, handleBackspace],
  );


  const chars = target.split("");
  const big = size === "word";
  const caretIndex = skipPunct(target, typed.length);

  // tapping anywhere while typing (touch devices) summons the soft keyboard
  useEffect(() => {
    if (paused) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("button, a, input, textarea")) return;
      inputRef.current?.focus({ preventScroll: true });
      // keep the synthetic click from stealing the focus back to <body>
      e.preventDefault();
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [paused]);

  return (
    <div className="relative flex flex-col items-center gap-5">
      <input
        ref={inputRef}
        type="text"
        aria-label="输入拼写"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        tabIndex={-1}
        onInput={onHiddenInput}
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
              {isSpace ? "\u00A0" : masked && !done ? "\u00A0" : ch}
              {masked && !done && !isSpace && (
                <span
                  className="absolute -bottom-2 left-[0.15em] right-[0.15em] mx-auto h-px rounded-full bg-muted-foreground/30"
                />
              )}
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
