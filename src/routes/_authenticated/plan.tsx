import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Target, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SectionHeading } from "@/components/SectionHeading";
import { cn } from "@/lib/utils";
import { getLearningState, getStats, saveSettings } from "@/lib/learning.functions";
import { WORD_BOOKS, getBook } from "@/data/words";

export const Route = createFileRoute("/_authenticated/plan")({
  head: () => ({
    meta: [
      { title: "学习计划 · 韵词 Cadence" },
      { name: "description", content: "设置每天要完成的单词数量，首页与进度都会按这个目标计算。" },
      { property: "og:title", content: "学习计划 · 韵词 Cadence" },
      { property: "og:description", content: "设定每日目标，稳定推进词书进度。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PlanPage,
});

const PRESETS = [20, 30, 50];

function PlanPage() {
  const qc = useQueryClient();
  const fetchState = useServerFn(getLearningState);
  const fetchStats = useServerFn(getStats);
  const persist = useServerFn(saveSettings);
  const { data: state } = useQuery({ queryKey: ["learning-state"], queryFn: () => fetchState() });
  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: () => fetchStats() });

  const [goal, setGoal] = useState(20);
  const [custom, setCustom] = useState("");
  const [saved, setSaved] = useState(false);
  const [spelling, setSpelling] = useState(true);

  useEffect(() => {
    if (state) {
      setGoal(state.dailyGoal);
      setSpelling(state.memorizeSpelling);
    }
  }, [state]);

  const toggleSpelling = () => {
    const next = !spelling;
    setSpelling(next);
    void persist({ data: { memorizeSpelling: next } })
      .then(() => void qc.invalidateQueries({ queryKey: ["learning-state"] }))
      .catch(() => undefined);
  };

  const apply = (value: number) => {
    const v = Math.min(300, Math.max(5, Math.round(value)));
    setGoal(v);
    setSaved(false);
    void persist({ data: { dailyGoal: v } })
      .then(() => {
        setSaved(true);
        void qc.invalidateQueries({ queryKey: ["learning-state"] });
      })
      .catch(() => undefined);
  };

  const todayCount = stats?.todayCount ?? 0;
  const progress = Math.min(100, Math.round((todayCount / goal) * 100));
  const activeBook = getBook(state?.activeBook ?? "core");

  return (
    <div className="space-y-7 pb-8">
      <div>
        <p className="text-sm font-medium text-primary">按自己的节奏推进</p>
        <h1 className="mt-2 font-display text-4xl">学习计划</h1>
        <p className="mt-2 text-sm text-muted-foreground">每日目标会用于首页今日进度与完成状态。</p>
      </div>

      <section className="glass-panel p-6 sm:p-8">
        <SectionHeading
          eyebrow="DAILY GOAL"
          title="每天学习数量"
          action={saved ? <span className="flex items-center gap-1 text-xs text-success"><Check className="size-3.5" />已保存</span> : undefined}
        />
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => apply(p)}
              className={cn(
                "rounded-full border px-5 py-2 text-sm transition-colors",
                goal === p
                  ? "border-primary/40 bg-card text-foreground shadow-sm"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              每天 {p} 个
            </button>
          ))}
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={5}
              max={300}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="自定义"
              aria-label="自定义每日数量"
              className="w-28 rounded-full border border-border bg-card/70 px-4 py-2 text-sm outline-none focus:border-primary/40"
            />
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              onClick={() => custom && apply(Number(custom))}
            >
              设为目标
            </Button>
          </div>
        </div>

        <div className="mt-8">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span className="flex items-center gap-2"><Target className="size-4 text-primary" />今天进度</span>
            <span className="font-mono">{todayCount} / {goal}</span>
          </div>
          <Progress value={progress} className="mt-3 h-2.5 bg-secondary/70" />
          <p className="mt-3 text-sm text-muted-foreground">
            {progress >= 100 ? "今天的目标已完成。" : `还差 ${Math.max(0, goal - todayCount)} 个达成今日目标。`}
          </p>
        </div>
      </section>

      <section className="glass-panel p-6 sm:p-8">
        <SectionHeading eyebrow="MEMORIZE" title="背单词设置" />
        <div className="mt-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-foreground">第三轮拼写</p>
            <p className="mt-1 text-xs text-muted-foreground">选对词义后再拼写一次，完成三轮强化。</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={spelling}
            aria-label="第三轮拼写"
            onClick={toggleSpelling}
            className={cn(
              "relative h-7 w-12 shrink-0 rounded-full transition-colors duration-300",
              spelling ? "bg-primary" : "bg-secondary",
            )}
          >
            <span
              className={cn(
                "absolute top-1 size-5 rounded-full bg-card shadow transition-all duration-300",
                spelling ? "left-6" : "left-1",
              )}
            />
          </button>
        </div>
        <Button asChild variant="ghost" size="sm" className="mt-4 rounded-full">
          <Link to="/memorize">去背单词</Link>
        </Button>
      </section>

      <section className="glass-panel p-6 sm:p-8">
        <SectionHeading eyebrow="BOOKS" title="词书进度" action={<Button asChild variant="ghost" size="sm"><Link to="/books">管理词库</Link></Button>} />
        <div className="mt-5 space-y-4">
          {WORD_BOOKS.map((b) => {
            const learned = state?.learnedByBook[b.id]?.length ?? 0;
            const pct = Math.round((learned / b.words.length) * 100);
            return (
              <div key={b.id}>
                <div className="flex items-center justify-between text-sm">
                  <span className={cn(b.id === activeBook.id && "font-semibold text-primary")}>{b.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{learned} / {b.words.length}</span>
                </div>
                <Progress value={pct} className="mt-2 h-1.5 bg-secondary/70" />
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
