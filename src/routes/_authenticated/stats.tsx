import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getStats } from "@/lib/learning.functions";

export const Route = createFileRoute("/_authenticated/stats")({
  head: () => ({
    meta: [
      { title: "学习记录 · 韵词 Cadence" },
      { name: "description", content: "查看今天学习的词数、连续学习天数、易错单词与最近练习记录。" },
      { property: "og:title", content: "学习记录 · 韵词 Cadence" },
      { property: "og:description", content: "今日词数、连续天数、易错单词与最近练习记录。" },
    ],
  }),
  component: StatsPage,
});

function StatsPage() {
  const fetchStats = useServerFn(getStats);
  const { data, isLoading } = useQuery({ queryKey: ["stats"], queryFn: () => fetchStats() });

  if (isLoading || !data) return <p className="text-sm text-muted-foreground">载入中…</p>;

  return (
    <div className="space-y-8">
      <h1 className="font-display text-3xl">学习记录</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="今天练习" value={data.todayCount} unit="次" />
        <Stat label="连续学习" value={data.streakDays} unit="天" />
        <Stat label="学过的词" value={data.uniqueWords} unit="个" />
        <Stat label="一次通过率" value={data.cleanRate} unit="%" />
      </div>

      <section className="card-surface rounded-3xl p-6">
        <h2 className="font-display text-xl">今天学过的词</h2>
        {data.todayWords.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {data.todayWords.map((w) => (
              <span key={w} className="rounded-full border border-border bg-card px-3 py-1 font-mono text-sm">
                {w}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">今天还没有练习，去单词模式开始吧。</p>
        )}
      </section>

      <section className="card-surface rounded-3xl p-6">
        <h2 className="font-display text-xl">容易出错的词</h2>
        {data.troubleWords.length ? (
          <ul className="mt-4 divide-y divide-border/70">
            {data.troubleWords.map((t) => (
              <li key={t.word} className="flex items-center justify-between py-2.5 text-sm">
                <span className="font-mono">{t.word}</span>
                <span className="text-muted-foreground">
                  {t.translation} · 错 {t.typos} 次 / 练 {t.times} 次
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">暂时没有明显的易错词。</p>
        )}
      </section>

      <section className="card-surface rounded-3xl p-6">
        <h2 className="font-display text-xl">最近练习</h2>
        <ul className="mt-4 divide-y divide-border/70">
          {data.recent.map((r, i) => (
            <li key={`${r.word}-${i}`} className="flex items-center justify-between py-2.5 text-sm">
              <span className="font-mono">{r.word}</span>
              <span className="text-muted-foreground">
                {r.mode === "word" ? "单词" : "句子"} · {r.mistouch ? "误触" : `${r.typos} 次错误`} ·{" "}
                {new Date(r.at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
            </li>
          ))}
          {!data.recent.length && <li className="py-2 text-sm text-muted-foreground">还没有记录。</li>}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="card-surface rounded-2xl p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-3xl">
        {value}
        <span className="ml-1 text-base text-muted-foreground">{unit}</span>
      </p>
    </div>
  );
}
