import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "vite";

const vite = await createServer({ configFile: false, server: { middlewareMode: true } });
after(() => vite.close());
const { projectMemory, planMemory, retentionAt, intervalAt } = await vite.ssrLoadModule("/src/lib/memory-engine.shared.ts");
const day = (n) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString();
const e = (id, at, correct = true, extra = {}) => ({
  id: String(id), word: "abandon", bookId: "core", scopeKey: "shared", skill: "spelling",
  prompt: "masked", at, correct, typoCount: correct ? 0 : 1, hintCount: 0, durationMs: 3000, ...extra,
});

test("FSRS shaped curve is monotonic and anchored at 90% at stability", () => {
  assert.ok(Math.abs(retentionAt(4, 4) - 0.9) < 1e-8);
  assert.ok(retentionAt(4, 10) < retentionAt(4, 2));
  assert.ok(Math.abs(intervalAt(4, 0.9) - 4) < 1e-8);
});
test("visible transcription never counts as independent spelling", () => {
  const a = projectMemory([e(1, day(0), true, { prompt: "visible" }), e(2, day(4), true, { prompt: "unknown" })], day(5));
  assert.equal(a.states.length, 0);
  assert.equal(a.ignoredCopyEvents, 2);
});
test("real elapsed days reduce retention and failures shorten stability", () => {
  const once = projectMemory([e(1, day(0))], day(1));
  const later = projectMemory([e(1, day(0))], day(14));
  assert.ok(later.states[0].recallProbability < once.states[0].recallProbability);
  const recovered = projectMemory([e(1, day(0)), e(2, day(7), false)], day(7));
  assert.ok(recovered.states[0].stabilityDays < once.states[0].stabilityDays);
});
test("replay deduplicates IDs and uses chronological, prequential calibration", () => {
  const input = [e(3, day(10)), e(1, day(0)), e(2, day(3), false), e(2, day(3), false)];
  const a = projectMemory(input, day(11));
  const b = projectMemory([...input].reverse(), day(11));
  assert.deepEqual(a, b);
  assert.equal(a.states[0].observedCount, 3);
  assert.equal(a.calibration.find(c => c.skill === "spelling").sampleSize, 2);
  assert.ok(a.calibration.find(c => c.skill === "spelling").brier !== null);
});
test("distinct modes and scopes never contaminate one another", () => {
  const p = projectMemory([
    e(1, day(0)),
    e(2, day(0), true, { skill: "recognition", prompt: "choice" }),
    e(3, day(0), true, { scopeKey: "book:other" }),
  ], day(2));
  assert.equal(p.states.length, 3);
});
test("plan enforces budget and bounded AI parameters, with reasons", () => {
  const p = projectMemory([e(1, day(0))], day(30));
  const plan = planMemory({ states: p.states, now: day(30), dailyGoal: 20, todayCompleted: 0, timeBudgetMinutes: 1, targetRetention: 0.97 });
  assert.ok(plan.tasks.reduce((sum, t) => sum + t.estimatedSeconds, 0) <= 60);
  assert.equal(plan.next.type, "diagnostic_test");
  assert.equal(plan.next.url, "/learn?queue=today&dictation=true");
});

test("hints never count as clean delayed recall", () => {
  const clean = projectMemory([e(1, day(0)), e(2, day(7))], day(7));
  const assisted = projectMemory([e(1, day(0)), e(2, day(7), true, { hintCount: 1 })], day(7));
  assert.ok(assisted.states[0].stabilityDays < clean.states[0].stabilityDays);
  assert.equal(assisted.states[0].lastOutcome, "assisted");
  assert.equal(assisted.calibration.find((c) => c.skill === "spelling").sampleSize, 0);
});
test("slow recognition response decreases stability gain without changing outcome", () => {
  const events = [e(1, day(0), true, { skill: "recognition", prompt: "choice" })];
  const fast = projectMemory([...events, e(2, day(7), true, { skill: "recognition", prompt: "choice", durationMs: 900 })], day(7));
  const slow = projectMemory([...events, e(2, day(7), true, { skill: "recognition", prompt: "choice", durationMs: 9000 })], day(7));
  assert.ok(slow.states[0].stabilityDays < fast.states[0].stabilityDays);
});
