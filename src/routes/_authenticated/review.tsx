import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AlertCircle, CheckCircle2, MousePointer2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getStats } from "@/lib/learning.functions";

export const Route = createFileRoute("/_authenticated/review")({
  head: () => ({ meta: [
    { title: "复习中心 · 韵词 Cadence" },
    { name: "description", content: "集中复习错词、今日任务、易错词与误触记录。" },
    { property: "og:title", content: "复习中心 · 韵词 Cadence" },
    { property: "og:description", content: "根据真实学习记录安排复习。" },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: ReviewPage,
});

const tabs = ["今日复习", "错词", "易错词", "误触记录"] as const;

function ReviewPage() {
  const [tab, setTab] = useState<(typeof tabs)[number]>("今日复习");
  const fetchStats = useServerFn(getStats);
  const { data, isLoading } = useQuery({ queryKey: ["stats"], queryFn: () => fetchStats() });
  const mistouches = data?.recent.filter((item) => item.mistouch) ?? [];
  const trouble = data?.troubleWords ?? [];

  return (
    <div className="space-y-7 pb-8">
      <div>
        <p className="text-sm font-medium text-primary">让记忆更牢固</p>
        <h1 className="mt-2 font-display text-4xl">复习</h1>
        <p className="mt-2 text-sm text-muted-foreground">复习内容由你的错误、频率和近期学习自动整理。</p>
      </div>

      <div className="glass-tabs flex gap-1 overflow-x-auto p-1.5">
        {tabs.map((item) => <Button key={item} type="button" variant="ghost" onClick={() => setTab(item)} className={cn("shrink-0 rounded-xl px-4", tab === item && "bg-card/80 text-foreground shadow-sm hover:bg-card/80")}>{item}</Button>)}
      </div>

      {tab === "今日复习" && (
        <section className="glass-hero flex flex-col justify-between gap-8 rounded-[2rem] p-7 sm:flex-row sm:items-end sm:p-9">
          <div>
            <div className="flex size-12 items-center justify-center rounded-2xl bg-warning/15 text-warning"><RotateCcw /></div>
            <h2 className="mt-7 font-display text-3xl">{trouble.length ? `${trouble.length} 个词等待复习` : "今日任务已清空"}</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">优先从近期错误最多的单词开始，完成后会更新你的学习记录。</p>
          </div>
          <Button asChild size="lg" className="rounded-full px-6"><Link to="/learn">开始复习</Link></Button>
        </section>
      )}

      {tab !== "今日复习" && (
        <section className="glass-panel p-6 sm:p-8">
          <div className="flex items-center gap-3">
            {tab === "误触记录" ? <MousePointer2 className="text-primary" /> : <AlertCircle className="text-warning" />}
            <h2 className="font-display text-2xl">{tab}</h2>
          </div>
          <div className="mt-6 divide-y divide-border/60">
            {(tab === "误触记录" ? mistouches : trouble).map((item) => (
              <div key={"at" in item ? item.at : item.word} className="flex items-center justify-between gap-4 py-4">
                <div><p className="font-mono text-sm">{item.word}</p><p className="mt-1 text-xs text-muted-foreground">{item.translation || "暂无释义"}</p></div>
                <span className="rounded-full bg-secondary/70 px-3 py-1 text-xs text-muted-foreground">{"typos" in item ? `${item.typos} 次错误` : "已标记误触"}</span>
              </div>
            ))}
            {!isLoading && !(tab === "误触记录" ? mistouches : trouble).length && <div className="py-14 text-center"><CheckCircle2 className="mx-auto size-8 text-success"/><p className="mt-3 text-sm text-muted-foreground">这里暂时没有记录。</p></div>}
          </div>
        </section>
      )}
    </div>
  );
}