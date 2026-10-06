import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Target, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { SectionHeading } from "@/components/SectionHeading";
import { SettingInfo } from "@/components/setting-info";
import { cn } from "@/lib/utils";
import { getStats, saveSettings } from "@/lib/learning.functions";
import { useLibrary } from "@/hooks/use-library";
import { useLearningState } from "@/hooks/use-learning-state";
import { queueLearningStateWrite } from "@/lib/learning-state.runtime";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/plan")({
  head: () => ({
    meta: [
      { title: "学习计划 · 韵词 Cadence" },
      { name: "description", content: "设置每日练习次数，按目标查看今天的练习进度。" },
      { property: "og:title", content: "学习计划 · 韵词 Cadence" },
      { property: "og:description", content: "设定每日练习次数，查看今天的练习进度。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PlanPage,
});

const PRESETS = [20, 30, 50];

function PlanPage() {
  const qc = useQueryClient();
  const fetchStats = useServerFn(getStats);
  const persist = useServerFn(saveSettings);
  const { data: state, isAuthoritative } = useLearningState();
  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: () => fetchStats() });

  const [goal, setGoal] = useState(20);
  const [custom, setCustom] = useState("");
  const [saved, setSaved] = useState(false);
  const [spelling, setSpelling] = useState(true);
  const [goalSaving, setGoalSaving] = useState(false);
  const [spellingSaving, setSpellingSaving] = useState(false);
  const savedGoal = useRef(20);
  const savedSpelling = useRef(true);
  const goalSavingRef = useRef(false);
  const spellingSavingRef = useRef(false);

  useEffect(() => {
    if (state && isAuthoritative) {
      if (!goalSavingRef.current) {
        savedGoal.current = state.dailyGoal;
        setGoal(state.dailyGoal);
      }
      if (!spellingSavingRef.current) {
        savedSpelling.current = state.memorizeSpelling;
        setSpelling(state.memorizeSpelling);
      }
    }
  }, [state, isAuthoritative]);

  const toggleSpelling = (on: boolean) => {
    if (spellingSavingRef.current) return;
    spellingSavingRef.current = true;
    setSpellingSaving(true);
    setSpelling(on);
    void queueLearningStateWrite(() => persist({ data: { memorizeSpelling: on } }))
      .then(() => {
        savedSpelling.current = on;
        void qc.invalidateQueries({ queryKey: ["learning-state"] });
      })
      .catch(() => {
        setSpelling(savedSpelling.current);
        toast.error("保存第三轮拼写设置失败，请重试");
        void qc.invalidateQueries({ queryKey: ["learning-state"] });
      })
      .finally(() => {
        spellingSavingRef.current = false;
        setSpellingSaving(false);
      });
  };

  const apply = (value: number) => {
    if (goalSavingRef.current || !Number.isFinite(value)) return;
    const v = Math.min(300, Math.max(5, Math.round(value)));
    goalSavingRef.current = true;
    setGoalSaving(true);
    setGoal(v);
    setSaved(false);
    void queueLearningStateWrite(() => persist({ data: { dailyGoal: v } }))
      .then(() => {
        savedGoal.current = v;
        setSaved(true);
        void qc.invalidateQueries({ queryKey: ["learning-state"] });
      })
      .catch(() => {
        setGoal(savedGoal.current);
        setSaved(false);
        toast.error("保存每日练习次数失败，请重试");
        void qc.invalidateQueries({ queryKey: ["learning-state"] });
      })
      .finally(() => {
        goalSavingRef.current = false;
        setGoalSaving(false);
      });
  };

  const todayCount = stats?.todayCount ?? 0;
  const progress = Math.min(100, Math.round((todayCount / goal) * 100));
  const { all: allBooks } = useLibrary();
  const activeBook = { id: state?.activeBook ?? "core" };

  return (
    <div className="space-y-7 pb-8">
      <div>
        <p className="text-sm font-medium text-primary">按自己的节奏推进</p>
        <h1 className="mt-2 font-display text-4xl">学习计划</h1>
        <p className="mt-2 text-sm text-muted-foreground">每日练习次数会用于今日进度与完成状态。</p>
      </div>

      <section className="glass-panel p-6 sm:p-8">
        <SectionHeading
          eyebrow="DAILY GOAL"
          title="每日练习次数"
          action={saved ? <span className="flex items-center gap-1 text-xs text-success"><Check className="size-3.5" />已保存</span> : undefined}
        />
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => apply(p)}
              disabled={!isAuthoritative || goalSaving}
              className={cn(
                "rounded-full border px-5 py-2 text-sm transition-colors",
                goal === p
                  ? "border-primary/40 bg-card text-foreground shadow-sm"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              每天 {p} 次
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
              aria-label="自定义每日练习次数"
              disabled={!isAuthoritative || goalSaving}
              className="w-28 rounded-full border border-border bg-card/70 px-4 py-2 text-sm outline-none focus:border-primary/40"
            />
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              disabled={!isAuthoritative || goalSaving || !custom}
              onClick={() => custom && apply(Number(custom))}
            >
              设为目标
            </Button>
          </div>
        </div>

        <div className="mt-8">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span className="flex items-center gap-2"><Target className="size-4 text-primary" />今天进度</span>
            <span className="font-mono">{todayCount} / {goal} 次</span>
          </div>
          <Progress value={progress} className="mt-3 h-2.5 bg-secondary/70" />
          <p className="mt-3 text-sm text-muted-foreground">
            {progress >= 100 ? "今天的目标已完成。" : `还差 ${Math.max(0, goal - todayCount)} 次达成今日目标。`}
          </p>
        </div>
      </section>

      <section className="glass-panel p-6 sm:p-8">
        <SectionHeading eyebrow="MEMORIZE" title="背单词设置" />
        <div className="mt-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <p className="text-sm text-foreground">第三轮拼写</p>
            <SettingInfo text="选对词义后再拼写一次，完成三轮强化。" />
          </div>
          <Switch
            aria-label="第三轮拼写"
            checked={spelling}
            onCheckedChange={toggleSpelling}
            disabled={!isAuthoritative || spellingSaving}
          />
        </div>
        <Button asChild variant="ghost" size="sm" className="mt-4 rounded-full">
          <Link to="/memorize">去背单词</Link>
        </Button>
      </section>

      <section className="glass-panel p-6 sm:p-8">
        <SectionHeading eyebrow="BOOKS" title="词书进度" action={<Button asChild variant="ghost" size="sm"><Link to="/books">管理词库</Link></Button>} />
        <div className="mt-5 space-y-4">
          {allBooks.map((b) => {
            const learned = state?.learnedByBook[b.id]?.length ?? 0;
            const pct = Math.round((learned / Math.max(1, b.wordCount)) * 100);
            return (
              <div key={b.id}>
                <div className="flex items-center justify-between text-sm">
                  <span className={cn(b.id === activeBook.id && "font-semibold text-primary")}>{b.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{learned} / {b.wordCount}</span>
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
