import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BookOpen, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { WORD_BOOKS, TOTAL_WORDS } from "@/data/words";
import { getLearningState, saveSettings } from "@/lib/learning.functions";

export const Route = createFileRoute("/_authenticated/books")({
  head: () => ({
    meta: [
      { title: "词库 · 韵词 Cadence" },
      { name: "description", content: "选择要学习的词书，查看每本词书的学习进度与剩余数量。" },
      { property: "og:title", content: "词库 · 韵词 Cadence" },
      { property: "og:description", content: "选择词书并继续学习。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BooksPage,
});

function BooksPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fetchState = useServerFn(getLearningState);
  const persist = useServerFn(saveSettings);
  const { data: state } = useQuery({ queryKey: ["learning-state"], queryFn: () => fetchState() });
  const activeBook = state?.activeBook ?? "core";

  const choose = (id: string) => {
    void persist({ data: { activeBook: id } })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["learning-state"] });
        void navigate({ to: "/learn" });
      })
      .catch(() => undefined);
  };

  return (
    <div className="space-y-7 pb-8">
      <div>
        <p className="text-sm font-medium text-primary">共 {TOTAL_WORDS} 个词条</p>
        <h1 className="mt-2 font-display text-4xl">词库</h1>
        <p className="mt-2 text-sm text-muted-foreground">选择词书后，学习会从你上次的位置继续。</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {WORD_BOOKS.map((b) => {
          const learned = state?.learnedByBook[b.id]?.length ?? 0;
          const cursor = state?.cursors[b.id] ?? 0;
          const pct = Math.round((learned / b.words.length) * 100);
          const active = b.id === activeBook;
          return (
            <div key={b.id} className={cn("glass-panel glass-lift p-6", active && "ring-1 ring-primary/25")}>
              <div className="flex items-start justify-between">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <BookOpen className="size-5" />
                </div>
                {active && (
                  <span className="flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">
                    <Check className="size-3.5" />当前
                  </span>
                )}
              </div>
              <p className="mt-5 font-display text-2xl">{b.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">{b.desc}</p>
              <Progress value={pct} className="mt-5 h-1.5 bg-secondary/70" />
              <p className="mt-2 font-mono text-xs text-muted-foreground">
                已学 {learned} / {b.words.length} · 位置 {Math.min(cursor + 1, b.words.length)}
              </p>
              <div className="mt-5 flex gap-2">
                <Button type="button" className="rounded-full" onClick={() => choose(b.id)}>
                  {active ? "继续学习" : "切换并学习"}
                </Button>
                <Button asChild variant="ghost" className="rounded-full">
                  <Link to="/plan">学习计划</Link>
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
