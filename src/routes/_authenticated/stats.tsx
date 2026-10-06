import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BarChart3, CalendarDays, CheckCircle2, Flame, History, Target } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getStats } from "@/lib/learning.functions";
import { entryKey } from "@/lib/entry-identity";

const STAT_TABS = ["今日数据", "历史记录", "学习分析"] as const;
type StatTab = (typeof STAT_TABS)[number];

export const Route = createFileRoute("/_authenticated/stats")({
  validateSearch: (search: Record<string, unknown>): { tab?: StatTab } => {
    const t = search["tab"];
    return typeof t === "string" && (STAT_TABS as readonly string[]).includes(t) ? { tab: t as StatTab } : {};
  },
  head: () => ({
    meta: [
      { title: "学习记录 · 韵词 Cadence" },
      { name: "description", content: "查看今天学习的词数、连续学习天数、易错单词与最近练习记录。" },
      { property: "og:title", content: "学习记录 · 韵词 Cadence" },
      { property: "og:description", content: "今日词数、连续天数、易错单词与最近练习记录。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StatsPage,
});

function StatsPage() {
  const { tab = "今日数据" } = Route.useSearch();
  const navigate = useNavigate();
  const setTab = (item: StatTab) => void navigate({ to: "/stats", search: { tab: item } });
  const fetchStats = useServerFn(getStats);
  const { data, isLoading } = useQuery({ queryKey: ["stats"], queryFn: () => fetchStats() });

  if (isLoading || !data) return <p className="text-sm text-muted-foreground">载入中…</p>;

  return (
    <div className="space-y-7 pb-8">
      <div>
        <p className="text-sm font-medium text-primary">看见每一点积累</p>
        <h1 className="mt-2 font-display text-4xl">进度</h1>
        <p className="mt-2 text-sm text-muted-foreground">今天的数据、历史轨迹与学习表现都在这里。</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={CalendarDays} label="今天练习" value={data.todayCount} unit="次" />
        <Stat icon={Flame} label="连续学习" value={data.streakDays} unit="天" />
        <Stat icon={Target} label="学过的词" value={data.uniqueWords} unit="个" />
        <Stat icon={CheckCircle2} label="一次通过率" value={data.cleanRate} unit="%" />
      </div>

      <div className="glass-tabs flex gap-1 overflow-x-auto p-1.5">
        {(["今日数据", "历史记录", "学习分析"] as const).map((item) => <Button key={item} variant="ghost" onClick={() => setTab(item)} className={cn("shrink-0 rounded-xl px-4", tab === item && "bg-card/80 shadow-sm hover:bg-card/80")}>{item}</Button>)}
      </div>

      {tab === "今日数据" && <section className="glass-panel p-6 sm:p-8">
        <div className="flex items-center gap-3"><CalendarDays className="size-5 text-primary"/><h2 className="font-display text-2xl">今天学过的词</h2></div>
        {data.todayWords.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {data.todayWords.map((item) => (
              <span key={entryKey(item)} className="rounded-full border border-border bg-card px-3 py-1 font-mono text-sm">
                {item.word}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">今天还没有练习，去单词模式开始吧。</p>
        )}
      </section>}

      {tab === "学习分析" && <section className="glass-panel p-6 sm:p-8">
        <div className="flex items-center gap-3"><BarChart3 className="size-5 text-primary"/><h2 className="font-display text-2xl">容易出错的词</h2></div>
        {data.troubleWords.length ? (
          <ul className="mt-4 divide-y divide-border/70">
            {data.troubleWords.map((t) => (
              <li key={entryKey(t)} className="flex items-center justify-between py-2.5 text-sm">
                <span className="font-mono">{t.word}</span>
                <span className="text-muted-foreground">
                  {t.translation} · 错 {t.errorAttempts} 次 / 练 {t.times} 次
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">暂时没有明显的易错词。</p>
        )}
      </section>}

      {tab === "历史记录" && <section className="glass-panel p-6 sm:p-8">
        <div className="flex items-center gap-3"><History className="size-5 text-primary"/><h2 className="font-display text-2xl">最近练习</h2></div>
        <ul className="mt-4 divide-y divide-border/70">
          {data.recent.map((r, i) => (
            <li key={`${entryKey(r)}-${i}`} className="flex items-center justify-between py-2.5 text-sm">
              <span className="font-mono">{r.word}</span>
              <span className="text-muted-foreground">
                {r.mode === "word" ? "单词拼写" : r.mode === "sentence" ? "句子拼写" : "背单词"} · {r.mistouch
                  ? "误触"
                  : r.typos > 0
                    ? `拼写错 ${r.typos} 次`
                    : r.correct
                      ? "正确"
                      : "答错"} ·{" "}
                {new Date(r.at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
            </li>
          ))}
          {!data.recent.length && <li className="py-2 text-sm text-muted-foreground">还没有记录。</li>}
        </ul>
      </section>}
    </div>
  );
}

function Stat({ icon: Icon, label, value, unit }: { icon: typeof Target; label: string; value: number; unit: string }) {
  return (
    <div className="glass-panel glass-lift p-5">
      <div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">{label}</p><Icon className="size-4 text-primary"/></div>
      <p className="mt-2 font-display text-3xl">
        {value}
        <span className="ml-1 text-base text-muted-foreground">{unit}</span>
      </p>
    </div>
  );
}
