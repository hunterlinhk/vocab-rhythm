import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertCircle, CheckCircle2, RotateCcw, Star } from "lucide-react";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { entryKey } from "@/lib/entry-identity";
import { useLearningState } from "@/hooks/use-learning-state";
import { useDueReview } from "@/hooks/use-due-review";
import { resolveEntries } from "@/lib/library.functions";

const tabs = ["今日复习", "错词", "易错词"] as const;
type Tab = (typeof tabs)[number];

const QUEUE_OF: Record<Tab, "today" | "wrong" | "trouble"> = {
  今日复习: "today",
  错词: "wrong",
  易错词: "trouble",
};

export const Route = createFileRoute("/_authenticated/review")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => {
    const t = search["tab"];
    return typeof t === "string" && (tabs as readonly string[]).includes(t) ? { tab: t as Tab } : {};
  },
  head: () => ({
    meta: [
      { title: "复习中心 · 韵词 Cadence" },
      { name: "description", content: "集中复习错词、今日任务与易错词。" },
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
  const { data, isLoading, isAuthoritative } = useLearningState();
  const recognition = useDueReview("recognition");
  const spelling = useDueReview("spelling");
  const resolve = useServerFn(resolveEntries);
  const due = useMemo(
    () => [...(recognition.data ?? []), ...(spelling.data ?? [])].filter((item) => !!item.bookId),
    [recognition.data, spelling.data],
  );
  const dueIdentities = useMemo(
    () => due.map((item) => ({ bookId: item.bookId!, word: item.word })),
    [due],
  );
  const dueEntries = useQuery({
    queryKey: ["due-review-entries", dueIdentities],
    queryFn: async () =>
      (
        await Promise.all(
          Array.from({ length: Math.ceil(dueIdentities.length / 500) }, (_, index) =>
            resolve({ data: { items: dueIdentities.slice(index * 500, (index + 1) * 500) } }),
          ),
        )
      ).flat(),
    enabled: dueIdentities.length > 0,
  });

  const lists = useMemo(
    () => ({
      今日复习: due.map((item) => ({
        word: item.word,
        bookId: item.bookId!,
        translation: dueEntries.data?.find((entry) => entry.bookId === item.bookId && entry.word === item.word)?.cn ?? null,
        note: item.review_mode === "recognition" ? "认词" : "拼写",
        mode: item.review_mode,
        scopeKey: item.scope_key,
      })),
      错词: data?.wrongWords.map((w) => ({ word: w.word, bookId: w.bookId, translation: w.translation, note: "发生过错误" })) ?? [],
      易错词:
        data?.troubleWords.map((w) => ({ word: w.word, bookId: w.bookId, translation: w.translation, note: `${w.errorAttempts} 次错误尝试` })) ?? [],
    }),
    [data, due, dueEntries.data],
  );

  const dueError = recognition.isError || spelling.isError || dueEntries.isError;
  const dueReady = recognition.isFetchedAfterMount && spelling.isFetchedAfterMount &&
    (dueIdentities.length === 0 || dueEntries.isFetchedAfterMount) && !dueError;
  const ready = tab === "今日复习" ? dueReady : isAuthoritative;
  const current = ready ? lists[tab] : [];
  const recognitionCount = dueReady ? due.filter((item) => item.review_mode === "recognition").length : 0;
  const spellingCount = dueReady ? due.filter((item) => item.review_mode === "spelling").length : 0;

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
            {tab === "今日复习" ? <RotateCcw /> : <AlertCircle />}
          </div>
          <h2 className="mt-7 font-display text-3xl">
            {!ready
              ? "载入中…"
              : current.length
                ? `${current.length} 项等待复习`
                : `${tab}暂时是空的`}
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            只练习这批词，完成后会更新学习记录。
          </p>
        </div>
        {tab === "今日复习" ? (
          <div className="flex flex-wrap gap-2">
            {recognitionCount > 0 && <Button asChild size="lg" className="rounded-full px-6"><Link to="/memorize" search={{ queue: "today" }}>认词 {recognitionCount}</Link></Button>}
            {spellingCount > 0 && <Button asChild size="lg" className="rounded-full px-6"><Link to="/learn" search={{ queue: "today" }}>拼写 {spellingCount}</Link></Button>}
          </div>
        ) : (
          <Button asChild size="lg" disabled={!current.length} className="rounded-full px-6">
            <Link to="/learn" search={{ queue: QUEUE_OF[tab] }}>开始复习</Link>
          </Button>
        )}
      </section>

      <section className="glass-panel p-6 sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {tab === "今日复习" ? <RotateCcw className="text-primary" /> : <AlertCircle className="text-warning" />}
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
            <div key={"scopeKey" in item ? `${item.note}:${item.scopeKey}:${entryKey(item)}` : entryKey(item)} className="flex items-center justify-between gap-4 py-4">
              <div>
                <p className="font-mono text-sm">{item.word}</p>
                <p className="mt-1 text-xs text-muted-foreground">{item.translation || "暂无释义"}</p>
              </div>
              <span className="rounded-full bg-secondary/70 px-3 py-1 text-xs text-muted-foreground">{item.note}</span>
            </div>
          ))}
          {!ready && (
            <p className="py-8 text-center text-sm text-muted-foreground">{tab === "今日复习" && dueError ? "加载失败，请刷新重试。" : "载入中…"}</p>
          )}
          {ready && !(tab !== "今日复习" && isLoading) && !current.length && (
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
