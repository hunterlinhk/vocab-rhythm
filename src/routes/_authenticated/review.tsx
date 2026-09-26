import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, CheckCircle2, MousePointer2, RotateCcw, Star } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getLearningState } from "@/lib/learning.functions";
import { entryKey } from "@/lib/entry-identity";

const tabs = ["今日复习", "错词", "易错词", "误触记录"] as const;
type Tab = (typeof tabs)[number];

const QUEUE_OF: Record<Tab, "today" | "wrong" | "trouble" | "mistouch"> = {
  今日复习: "today",
  错词: "wrong",
  易错词: "trouble",
  误触记录: "mistouch",
};

export const Route = createFileRoute("/_authenticated/review")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => {
    const t = search["tab"];
    return typeof t === "string" && (tabs as readonly string[]).includes(t) ? { tab: t as Tab } : {};
  },
  head: () => ({
    meta: [
      { title: "复习中心 · 韵词 Cadence" },
      { name: "description", content: "集中复习错词、今日任务、易错词与误触记录。" },
      { property: "og:title", content: "复习中心 · 韵词 Cadence" },
      { property: "og:description", content: "根据真实学习记录安排复习。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReviewPage,
});

function ReviewPage() {
  const { tab = "今日复习" } = Route.useSearch();
  const navigate = useNavigate();
  const fetchState = useServerFn(getLearningState);
  const { data, isLoading } = useQuery({ queryKey: ["learning-state"], queryFn: () => fetchState() });

  const lists = useMemo(
    () => ({
      今日复习: data?.todayItems.map((w) => ({ word: w.word, bookId: w.bookId, translation: w.translation, note: "今天学过" })) ?? [],
      错词: data?.wrongWords.map((w) => ({ word: w.word, bookId: w.bookId, translation: w.translation, note: "曾答错" })) ?? [],
      易错词:
        data?.troubleWords.map((w) => ({ word: w.word, bookId: w.bookId, translation: w.translation, note: `${w.typos} 次错误` })) ?? [],
      误触记录: [...new Map(data?.mistouchWords.map((w) => [
        entryKey(w),
        { word: w.word, bookId: w.bookId, translation: w.translation, note: "已标记误触" },
      ]) ?? []).values()],
    }),
    [data],
  );

  const current = lists[tab];

  return (
    <div className="space-y-7 pb-8">
      <div>
        <p className="text-sm font-medium text-primary">让记忆更牢固</p>
        <h1 className="mt-2 font-display text-4xl">复习</h1>
        <p className="mt-2 text-sm text-muted-foreground">复习内容由你的错误、频率和近期学习自动整理。</p>
      </div>

      <div className="glass-tabs flex gap-1 overflow-x-auto p-1.5">
        {tabs.map((item) => (
          <Button
            key={item}
            type="button"
            variant="ghost"
            onClick={() => void navigate({ to: "/review", search: { tab: item } })}
            className={cn("shrink-0 rounded-xl px-4", tab === item && "bg-card/80 text-foreground shadow-sm hover:bg-card/80")}
          >
            {item}
          </Button>
        ))}
      </div>

      <section className="glass-hero flex flex-col justify-between gap-8 rounded-[2rem] p-7 sm:flex-row sm:items-end sm:p-9">
        <div>
          <div className="flex size-12 items-center justify-center rounded-2xl bg-warning/15 text-warning">
            {tab === "误触记录" ? <MousePointer2 /> : tab === "今日复习" ? <RotateCcw /> : <AlertCircle />}
          </div>
          <h2 className="mt-7 font-display text-3xl">
            {current.length ? `${current.length} 个词等待复习` : `${tab}暂时是空的`}
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            只练习这批词，完成后会更新学习记录。误触记录不计入真正的错误。
          </p>
        </div>
        <Button asChild size="lg" disabled={!current.length} className="rounded-full px-6">
          <Link to="/learn" search={{ queue: QUEUE_OF[tab] }}>
            开始复习
          </Link>
        </Button>
      </section>

      <section className="glass-panel p-6 sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {tab === "误触记录" ? <MousePointer2 className="text-primary" /> : <AlertCircle className="text-warning" />}
            <h2 className="font-display text-2xl">{tab}</h2>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/learn" search={{ queue: "favorites" }}>
              <Star className="size-4" /> 练收藏
            </Link>
          </Button>
        </div>
        <div className="mt-6 divide-y divide-border/60">
          {current.map((item) => (
            <div key={entryKey(item)} className="flex items-center justify-between gap-4 py-4">
              <div>
                <p className="font-mono text-sm">{item.word}</p>
                <p className="mt-1 text-xs text-muted-foreground">{item.translation || "暂无释义"}</p>
              </div>
              <span className="rounded-full bg-secondary/70 px-3 py-1 text-xs text-muted-foreground">{item.note}</span>
            </div>
          ))}
          {!isLoading && !current.length && (
            <div className="py-14 text-center">
              <CheckCircle2 className="mx-auto size-8 text-success" />
              <p className="mt-3 text-sm text-muted-foreground">这里暂时没有记录。</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
