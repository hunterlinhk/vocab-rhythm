import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { CSSProperties } from "react";
import { ArrowRight, BookOpen, Bot, ChevronRight, Clock3, Flame, RotateCcw, Sparkles, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SectionHeading } from "@/components/SectionHeading";
import { getStats } from "@/lib/learning.functions";

export const Route = createFileRoute("/_authenticated/home")({
  head: () => ({
    meta: [
      { title: "学习首页 · 韵词 Cadence" },
      { name: "description", content: "继续英语拼写学习，查看今日进度、复习任务与最近学习记录。" },
      { property: "og:title", content: "学习首页 · 韵词 Cadence" },
      { property: "og:description", content: "你的英语拼写学习工作台。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const fetchStats = useServerFn(getStats);
  const { data, isLoading } = useQuery({ queryKey: ["stats"], queryFn: () => fetchStats() });
  const todayCount = data?.todayCount ?? 0;
  const dailyGoal = 20;
  const progress = Math.min(100, Math.round((todayCount / dailyGoal) * 100));
  const reviewCount = data?.troubleWords.length ?? 0;

  return (
    <div className="space-y-8 pb-8">
      <section className="glass-hero rise-in relative overflow-hidden rounded-[2rem] px-6 py-7 sm:px-9 sm:py-9">
        <div className="relative z-10 max-w-2xl">
          <p className="text-sm font-medium text-primary">今天也保持一点节奏</p>
          <h1 className="mt-3 font-display text-4xl leading-tight text-foreground sm:text-5xl">继续学习</h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
            从核心词汇继续，把每一次敲击变成稳定、清晰的记忆。
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild size="lg" className="rounded-full px-6 shadow-lg shadow-primary/15">
              <Link to="/learn">
                <BookOpen /> 继续单词拼写 <ArrowRight />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="glass-control rounded-full px-6">
              <Link to="/sentence">练习句子</Link>
            </Button>
          </div>
        </div>
        <DailyGoalDial progress={progress} />
      </section>

      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Metric icon={Target} label="今日练习" value={isLoading ? "—" : `${todayCount}`} unit={`/ ${dailyGoal} 次`} />
        <Metric icon={RotateCcw} label="待复习" value={isLoading ? "—" : `${reviewCount}`} unit="个词" />
        <Metric icon={Flame} label="连续学习" value={isLoading ? "—" : `${data?.streakDays ?? 0}`} unit="天" />
        <Metric icon={Sparkles} label="正确率" value={isLoading ? "—" : `${data?.cleanRate ?? 0}`} unit="%" />
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="glass-panel p-6 sm:p-7">
          <SectionHeading
            eyebrow="TODAY"
            title="今日学习进度"
            action={<span className="font-mono text-sm text-muted-foreground">{todayCount} / {dailyGoal}</span>}
          />
          <Progress value={progress} className="mt-6 h-2.5 bg-secondary/70" />
          <div className="mt-6 grid grid-cols-3 gap-3 text-center">
            <MiniStat label="新学" value={data?.todayWords.length ?? 0} />
            <MiniStat label="累计" value={data?.totalCount ?? 0} />
            <MiniStat label="词汇" value={data?.uniqueWords ?? 0} />
          </div>
        </div>

        <Link to="/review" className="glass-panel glass-lift group block p-6 sm:p-7">
          <div className="flex items-start justify-between">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-warning/15 text-warning">
              <RotateCcw className="size-5" />
            </div>
            <ChevronRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-1" />
          </div>
          <p className="mt-7 text-sm text-muted-foreground">复习任务</p>
          <p className="mt-1 font-display text-2xl">{reviewCount ? `${reviewCount} 个易错词待巩固` : "今天的复习已完成"}</p>
          <p className="mt-2 text-sm text-muted-foreground">根据真实错误与误触记录安排</p>
        </Link>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="glass-panel p-6 sm:p-7">
          <SectionHeading eyebrow="RECENT" title="最近学习" action={<Button asChild variant="ghost" size="sm"><Link to="/stats">查看全部</Link></Button>} />
          <div className="mt-5 divide-y divide-border/60">
            {data?.recent.slice(0, 4).map((item, index) => (
              <div key={`${item.word}-${item.at}-${index}`} className="flex items-center justify-between gap-4 py-3.5">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm text-foreground">{item.word}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.translation || "已完成拼写练习"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  <Clock3 className="size-3.5" />
                  {new Date(item.at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}
                </div>
              </div>
            ))}
            {!data?.recent.length && <p className="py-8 text-center text-sm text-muted-foreground">完成一次练习后，这里会出现你的学习轨迹。</p>}
          </div>
        </div>

        <Link to="/assistant" className="ai-glass glass-lift group flex min-h-64 flex-col justify-between p-6 sm:p-7">
          <div className="flex items-start justify-between">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
              <Bot className="size-6" />
            </div>
            <span className="rounded-full border border-primary/15 bg-card/40 px-3 py-1 text-xs font-medium text-primary backdrop-blur-md">基于真实记录</span>
          </div>
          <div>
            <p className="font-display text-2xl">问问 AI 学习助手</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">复盘错词、生成例句，或根据最近学习内容开始一个小测试。</p>
            <div className="mt-5 flex items-center gap-2 text-sm font-semibold text-primary">开始对话 <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" /></div>
          </div>
        </Link>
      </section>
    </div>
  );
}

function DailyGoalDial({ progress }: { progress: number }) {
  const tickCount = 100;
  const activeTicks = Math.round((progress / 100) * tickCount);

  return (
    <div className="daily-goal-dial absolute right-8 top-1/2 hidden size-44 -translate-y-1/2 lg:grid" aria-label={`今日目标完成 ${progress}%`}>
      <div className="daily-goal-ticks" aria-hidden="true">
        {Array.from({ length: tickCount }, (_, index) => (
          <span
            key={index}
            className={index < activeTicks ? "daily-goal-tick daily-goal-tick-active" : "daily-goal-tick"}
            style={{
              "--tick-index": index,
              "--tick-angle": `${360 / tickCount}deg`,
            } as CSSProperties}
          />
        ))}
      </div>
      <div className="daily-goal-core">
        <div className="flex items-baseline justify-center">
          <span className="font-display text-[2.75rem] font-light leading-none text-foreground">{progress}</span>
          <span className="ml-1 text-sm font-medium text-primary">%</span>
        </div>
        <span className="mt-2 text-[10px] font-semibold text-muted-foreground">今日目标</span>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, unit }: { icon: typeof Target; label: string; value: string; unit: string }) {
  return (
    <div className="glass-panel glass-lift p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className="size-4 text-primary" />
      </div>
      <p className="mt-4 font-display text-3xl text-foreground">{value}<span className="ml-1.5 font-sans text-xs text-muted-foreground">{unit}</span></p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl border border-card/70 bg-card/35 px-3 py-4 backdrop-blur-md"><p className="font-display text-xl">{value}</p><p className="mt-1 text-xs text-muted-foreground">{label}</p></div>;
}