/** Cadence memory engine v2: transparent, deterministic and replayable.
 * Prediction is for an unassisted first response, not a guarantee of learning.
 * FSRS-6 inspired prior + HLR-style user calibration + sequential skill tracing.
 */
export const MEMORY_MODEL_VERSION = "cadence-memory-v2.0-shadow";
export type MemorySkill = "recognition" | "spelling";
export type MemoryAction = "review" | "diagnostic_test" | "new_word" | "done";
export type MemoryObservation = {
  id: string;
  word: string;
  bookId: string;
  scopeKey: string;
  skill: MemorySkill;
  at: string;
  correct: boolean;
  typoCount: number;
  hintCount: number;
  durationMs: number | null;
  /** Recognition is multiple-choice; spelling is measured only when masked. */
  prompt: "choice" | "masked" | "visible" | "unknown";
};
export type MemoryState = {
  word: string;
  bookId: string;
  scopeKey: string;
  skill: MemorySkill;
  stabilityDays: number;
  difficulty: number;
  lastObservedAt: string;
  observedCount: number;
  delayedTests: number;
  longDelayTests: number;
  lastOutcome: "clean" | "assisted" | "failed";
  recallProbability: number;
  forgettingRisk: number;
  /** Predicted unassisted success 30 days from now, NOT measured long-term recall. */
  longTermRecall30d: number;
  confidence: "cold" | "low" | "developing" | "validated";
  nextTestAt: string;
};
export type MemoryCalibration = {
  skill: MemorySkill;
  sampleSize: number;
  logitOffset: number;
  brier: number | null;
  baselineBrier: number | null;
  logLoss: number | null;
};
export type MemoryTask = {
  type: MemoryAction;
  skill: MemorySkill | null;
  word: string | null;
  bookId: string | null;
  scopeKey: string | null;
  estimatedSeconds: number;
  predictedRecall: number | null;
  reasonCode: "at_risk" | "uncertain_memory" | "goal_progress" | "goal_complete" | "time_exhausted";
  reason: string;
  url: string;
};
export type MemoryPlan = {
  modelVersion: string;
  generatedAt: string;
  targetRetention: number;
  timeBudgetMinutes: number;
  dailyGoal: number;
  todayCompleted: number;
  tasks: MemoryTask[];
  next: MemoryTask;
};

const DAY_MS = 86_400_000;
const DECAY = 0.1542; // FSRS-6 reference shape, not a claim of fully implementing FSRS-6.
const FACTOR = Math.pow(0.9, -1 / DECAY) - 1;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round = (x: number, n = 4) => Number(x.toFixed(n));
const logit = (p: number) => Math.log(clamp(p, 1e-5, 1 - 1e-5) / (1 - clamp(p, 1e-5, 1 - 1e-5)));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const stateKey = (o: Pick<MemoryObservation, "scopeKey" | "word" | "skill">) =>
  o.scopeKey + "\u0000" + o.word.trim().toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ") + "\u0000" + o.skill;

export function retentionAt(stabilityDays: number, elapsedDays: number): number {
  if (!Number.isFinite(stabilityDays) || stabilityDays <= 0) throw new Error("Invalid stability");
  return clamp(Math.pow(1 + FACTOR * Math.max(0, elapsedDays) / stabilityDays, -DECAY), 1e-5, 1);
}

export function intervalAt(stabilityDays: number, targetRetention: number): number {
  if (!(targetRetention > 0.5 && targetRetention < 0.999)) throw new Error("Invalid retention target");
  return clamp(stabilityDays * (Math.pow(targetRetention, -1 / DECAY) - 1) / FACTOR, 0.04, 365);
}

export function projectMemory(observations: MemoryObservation[], now: string, targetRetention = 0.9): {
  states: MemoryState[];
  calibration: MemoryCalibration[];
  ignoredCopyEvents: number;
} {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error("Invalid projection time");
  const chronological = [...observations].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const memory = new Map<string, Omit<MemoryState, "recallProbability" | "forgettingRisk" | "longTermRecall30d" | "confidence" | "nextTestAt">>();
  const fit = new Map<MemorySkill, { offset: number; n: number; brier: number; baseline: number; loss: number }>([
    ["recognition", { offset: 0, n: 0, brier: 0, baseline: 0, loss: 0 }],
    ["spelling", { offset: 0, n: 0, brier: 0, baseline: 0, loss: 0 }],
  ]);
  let ignoredCopyEvents = 0;
  const seenIds = new Set<string>();
  for (const o of chronological) {
    const at = Date.parse(o.at);
    if (!Number.isFinite(at) || at > nowMs || seenIds.has(o.id) || !o.word.trim()) continue;
    seenIds.add(o.id);
    // Visible or unknown-target spelling is transcription, not independent recall.
    if (o.skill === "spelling" && o.prompt !== "masked") {
      ignoredCopyEvents++;
      continue;
    }
    if (o.skill === "recognition" && o.prompt !== "choice") continue;
    const key = stateKey(o);
    const previous = memory.get(key);
    const f = fit.get(o.skill)!;
    const elapsed = previous ? Math.max(0, (at - Date.parse(previous.lastObservedAt)) / DAY_MS) : 0;
    const base = previous ? retentionAt(previous.stabilityDays, elapsed) : 0.5;
    const p = sigmoid(logit(base) + f.offset * (f.n / (f.n + 20)));
    const clean = o.correct && o.hintCount === 0 && o.typoCount === 0;
    const y = clean ? 1 : 0;
    const eligible = !!previous && elapsed >= 1 && o.hintCount === 0;
    // Strict prequential evaluation: predict BEFORE adjusting to this outcome.
    if (eligible) {
      f.n++;
      f.brier += (p - y) ** 2;
      f.baseline += (base - y) ** 2;
      f.loss += -(y * Math.log(clamp(p, 1e-5, 1)) + (1 - y) * Math.log(clamp(1 - p, 1e-5, 1)));
      f.offset = clamp(f.offset + (0.42 / Math.sqrt(1 + f.n / 12)) * (y - p), -1.5, 1.5);
    }
    const hasError = !clean;
    const difficulty = clamp((previous?.difficulty ?? 5) + (hasError ? 0.65 + Math.min(2, o.typoCount) * 0.18 : -0.35), 1, 10);
    let stability: number;
    if (!previous) stability = clean ? (o.skill === "recognition" ? 1.2931 : 0.55) : 0.212;
    else if (!clean) stability = clamp(previous.stabilityDays * (0.33 + 0.12 * Math.min(1, elapsed / 7)), 0.08, 365);
    else {
      const spacingGain = clamp(1 + Math.log1p(elapsed) * (0.6 + (1 - base) * 0.7), 1.04, 3.5);
      const difficultyPenalty = clamp(1.25 - difficulty / 20, 0.7, 1.2);
      const speedPenalty = o.durationMs && o.durationMs > 0 && o.skill === "spelling"
        ? (o.durationMs > (2500 + o.word.length * 850) ? 0.95 : 1) : 1;
      stability = clamp(previous.stabilityDays * spacingGain * difficultyPenalty * speedPenalty, 0.08, 365);
    }
    memory.set(key, {
      word: o.word,
      bookId: o.bookId,
      scopeKey: o.scopeKey,
      skill: o.skill,
      stabilityDays: stability,
      difficulty,
      lastObservedAt: o.at,
      observedCount: (previous?.observedCount ?? 0) + 1,
      delayedTests: (previous?.delayedTests ?? 0) + Number(eligible),
      longDelayTests: (previous?.longDelayTests ?? 0) + Number(eligible && elapsed >= 7),
      lastOutcome: clean ? "clean" : o.correct ? "assisted" : "failed",
    });
  }
  const states = [...memory.values()].map((s): MemoryState => {
    const f = fit.get(s.skill)!;
    const elapsed = Math.max(0, (nowMs - Date.parse(s.lastObservedAt)) / DAY_MS);
    const base = retentionAt(s.stabilityDays, elapsed);
    const offset = f.offset * f.n / (f.n + 20);
    const probability = sigmoid(logit(base) + offset);
    const targetBase = clamp(sigmoid(logit(targetRetention) - offset), 0.55, 0.995);
    const days = intervalAt(s.stabilityDays, targetBase);
    return {
      ...s,
      stabilityDays: round(s.stabilityDays),
      difficulty: round(s.difficulty, 2),
      recallProbability: round(probability),
      forgettingRisk: round(1 - probability),
      longTermRecall30d: round(sigmoid(logit(retentionAt(s.stabilityDays, elapsed + 30)) + offset)),
      confidence: s.longDelayTests >= 3 ? "validated" : s.delayedTests >= 3 ? "developing" : s.observedCount >= 2 ? "low" : "cold",
      nextTestAt: new Date(Date.parse(s.lastObservedAt) + days * DAY_MS).toISOString(),
    };
  }).sort((a, b) => b.forgettingRisk - a.forgettingRisk || a.word.localeCompare(b.word) || a.skill.localeCompare(b.skill));
  const calibration: MemoryCalibration[] = (["recognition", "spelling"] as const).map((skill) => {
    const f = fit.get(skill)!;
    return { skill, sampleSize: f.n, logitOffset: round(f.offset), brier: f.n ? round(f.brier / f.n) : null,
      baselineBrier: f.n ? round(f.baseline / f.n) : null, logLoss: f.n ? round(f.loss / f.n) : null };
  });
  return { states, calibration, ignoredCopyEvents };
}

export function planMemory(input: {
  states: MemoryState[];
  now: string;
  dailyGoal: number;
  todayCompleted: number;
  timeBudgetMinutes: number;
  targetRetention?: number;
}): MemoryPlan {
  const { states, now, dailyGoal, todayCompleted } = input;
  const timeBudgetMinutes = clamp(Math.round(input.timeBudgetMinutes), 1, 180);
  const targetRetention = clamp(input.targetRetention ?? 0.9, 0.75, 0.97);
  let remaining = timeBudgetMinutes * 60;
  const tasks: MemoryTask[] = [];
  const candidates = [...states].filter((s) => Date.parse(s.nextTestAt) <= Date.parse(now) || s.recallProbability < targetRetention);
  candidates.sort((a, b) => {
    const sa = (a.forgettingRisk * 2 + (a.confidence === "cold" ? 0.12 : 0)) / (a.skill === "spelling" ? 40 : 25);
    const sb = (b.forgettingRisk * 2 + (b.confidence === "cold" ? 0.12 : 0)) / (b.skill === "spelling" ? 40 : 25);
    return sb - sa || a.word.localeCompare(b.word);
  });
  // Avoid allocating recognition and spelling of the same word in a single short plan.
  const seen = new Set<string>();
  for (const s of candidates) {
    const duration = s.skill === "spelling" ? 40 : 25;
    if (remaining < duration || tasks.length >= 30 || seen.has(s.scopeKey + ":" + s.word)) continue;
    seen.add(s.scopeKey + ":" + s.word);
    const diagnostic = s.delayedTests === 0 && s.skill === "spelling";
    tasks.push({ type: diagnostic ? "diagnostic_test" : "review", skill: s.skill, word: s.word,
      bookId: s.bookId, scopeKey: s.scopeKey, estimatedSeconds: duration,
      predictedRecall: s.recallProbability, reasonCode: diagnostic ? "uncertain_memory" : "at_risk",
      reason: diagnostic ? "尚无合格的延迟默写证据，优先进行隐藏单词测试" : "预计当前答对率 " + Math.round(s.recallProbability * 100) + "%，已达到复习阈值",
      url: s.skill === "spelling" ? "/learn?queue=today&dictation=true" : "/memorize?queue=today" });
    remaining -= duration;
  }
  if (todayCompleted < dailyGoal && remaining >= 60 && tasks.length < 30) {
    tasks.push({ type: "new_word", skill: null, word: null, bookId: null, scopeKey: null,
      estimatedSeconds: Math.min(remaining, 120), predictedRecall: null, reasonCode: "goal_progress",
      reason: "当前已完成 " + todayCompleted + "/" + dailyGoal + " 次练习，预留时间学习新词", url: "/learn" });
  }
  const next = tasks[0] ?? { type: "done" as const, skill: null, word: null, bookId: null, scopeKey: null,
    estimatedSeconds: 0, predictedRecall: null,
    reasonCode: (todayCompleted >= dailyGoal ? "goal_complete" : "time_exhausted") as "goal_complete" | "time_exhausted",
    reason: todayCompleted >= dailyGoal ? "今天已达到练习目标" : "当前预算不足以安排可靠的学习任务",
    url: "/plan" };
  return { modelVersion: MEMORY_MODEL_VERSION, generatedAt: now, targetRetention, timeBudgetMinutes, dailyGoal, todayCompleted, tasks, next };
}