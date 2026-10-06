import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type CSSProperties } from "react";
import { ArrowRight, BookOpen, Bot, ChevronRight, Clock3, Flame, RotateCcw, Sparkles, Target, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SectionHeading } from "@/components/SectionHeading";
import { AppShell } from "@/components/AppShell";
import { getDueReviewCount, getStats } from "@/lib/learning.functions";
import { useLearningState } from "@/hooks/use-learning-state";
import { useLibrary } from "@/hooks/use-library";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "韵词 Cadence · 键盘打字学英语单词与句子" },
      {
        name: "description",
        content: "面向中文用户的英语打字学习工具：连续键盘输入练单词与句子，即时反馈、学习记录与 AI 学习助手。",
      },
      { property: "og:title", content: "韵词 Cadence · 键盘打字学英语" },
      { property: "og:description", content: "连续键盘输入练单词与句子，配合学习记录与 AI 学习助手。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  return (
    <AppShell>
      <HomeContent />
      <LoginPrompt />
    </AppShell>
  );
}

const LOGIN_PROMPT_DELAY_MS = 5 * 60 * 1000;

function LoginPrompt() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void supabase.auth.getSession().then(({ data }) => {
        if (!cancelled && !data.session) setOpen(true);
      });
    }, LOGIN_PROMPT_DELAY_MS);
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) setOpen(false);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  if (!open) return null;

  async function google() {
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (result.error || result.redirected) return;
    setOpen(false);
  }

  async function guest() {
    setLoading(true);
    const { error } = await supabase.auth.signInAnonymously();
    setLoading(false);
    if (!error) setOpen(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/10 px-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="登录">
      <div className="card-surface rise-in relative w-full max-w-sm rounded-3xl p-7">
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="关闭"
          className="absolute right-4 top-4 rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-4" />
        </button>
        <p className="font-display text-xl">登录同步学习记录</p>
        <p className="mt-1.5 text-sm text-muted-foreground">保存进度、错词与复习安排。</p>
        <button
          type="button"
          onClick={google}
          className="mt-5 w-full rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium transition-colors hover:border-primary/40"
        >
          使用 Google 继续
        </button>
        <button
          type="button"
          onClick={guest}
          disabled={loading}
          className="mt-3 w-full rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium transition-colors hover:border-primary/40 disabled:opacity-60"
        >
          访客登录
        </button>
        <button
          type="button"
          onClick={() => void navigate({ to: "/auth" })}
          className="mt-4 w-full text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          使用邮箱登录
        </button>
      </div>
    </div>
  );
}

function HomeContent() {
  const fetchStats = useServerFn(getStats);
  const fetchDueCount = useServerFn(getDueReviewCount);
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setAuthed(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setAuthed(!!session));
    return () => sub.subscription.unsubscribe();
  }, []);
  const { data, isLoading: statsLoading } = useQuery({ queryKey: ["stats"], queryFn: () => fetchStats(), enabled: authed });
  const isLoading = authed && statsLoading;
  const { data: state } = useLearningState({ enabled: authed });
  const { data: reviewCount, isLoading: dueLoading, isError: dueError } = useQuery({
    queryKey: ["due-review-count"],
    queryFn: () => fetchDueCount(),
    enabled: authed,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const todayCount = data?.todayCount ?? 0;
  const dailyGoal = state?.dailyGoal ?? 20;
  const progress = Math.min(100, Math.round((todayCount / dailyGoal) * 100));
  const { all: allBooks } = useLibrary();
  const activeBook = allBooks.find((b) => b.id === (state?.activeBook ?? "core")) ?? allBooks[0]!;
  const bookLearned = state?.learnedByBook[activeBook.id]?.length ?? 0;

  return (
    <div className="space-y-8 pb-8">
      <section className="glass-hero rise-in relative overflow-hidden rounded-[2rem] px-6 py-7 sm:px-9 sm:py-9">
        <div className="relative z-10 max-w-2xl">
          <p className="text-sm font-medium text-primary">今天也保持一点节奏</p>
          <h1 className="mt-3 font-display text-4xl leading-tight text-foreground sm:text-5xl">继续学习</h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
            {activeBook.name} · 已学 {bookLearned} / {activeBook.wordCount}，从上次的位置继续。
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
        <Metric icon={RotateCcw} label="待复习" value={dueLoading || dueError ? "—" : `${reviewCount ?? 0}`} unit="项" />
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
          <p className="mt-1 font-display text-2xl">{dueError ? "加载失败" : dueLoading ? "载入中…" : reviewCount ? `${reviewCount} 项复习待完成` : "今天的复习已完成"}</p>
          <p className="mt-2 text-sm text-muted-foreground">按复习计划到期时间安排</p>
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
