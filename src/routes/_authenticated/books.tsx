import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { BookOpen, Check, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useLibrary, type BookSummary } from "@/hooks/use-library";
import { getLearningState, saveSettings } from "@/lib/learning.functions";
import { createCustomBook, deleteCustomBook } from "@/lib/library.functions";
import { parsePastedWords, type EntryInputT } from "@/lib/library.shared";

const tabs = ["官方词库", "我的词库"] as const;
type Tab = (typeof tabs)[number];

export const Route = createFileRoute("/_authenticated/books")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => {
    const t = search["tab"];
    return typeof t === "string" && (tabs as readonly string[]).includes(t) ? { tab: t as Tab } : {};
  },
  head: () => ({
    meta: [
      { title: "词库 · 韵词 Cadence" },
      { name: "description", content: "官方词库与我的自定义词库，选择要学习的词书并查看进度。" },
      { property: "og:title", content: "词库 · 韵词 Cadence" },
      { property: "og:description", content: "选择词书，或粘贴单词创建自己的词库。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BooksPage,
});

function BooksPage() {
  const { tab = "官方词库" } = Route.useSearch();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fetchState = useServerFn(getLearningState);
  const persist = useServerFn(saveSettings);
  const remove = useServerFn(deleteCustomBook);
  const { data: state } = useQuery({ queryKey: ["learning-state"], queryFn: () => fetchState() });
  const { official, custom } = useLibrary();
  const activeBook = state?.activeBook ?? "core";
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<BookSummary | null>(null);

  const choose = (id: string) => {
    void persist({ data: { activeBook: id } })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["learning-state"] });
        void navigate({ to: "/learn" });
      })
      .catch(() => undefined);
  };

  const confirmDelete = () => {
    if (!deleting) return;
    const id = deleting.id;
    setDeleting(null);
    void remove({ data: { bookId: id } })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["library"] });
        void qc.invalidateQueries({ queryKey: ["learning-state"] });
      })
      .catch(() => undefined);
  };

  const list = tab === "官方词库" ? official : custom;

  return (
    <div className="space-y-7 pb-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">词库</h1>
          <p className="mt-2 text-sm text-muted-foreground">选择词书后，学习会从你上次的位置继续。</p>
        </div>
        <Button type="button" className="rounded-full" onClick={() => setCreating(true)}>
          <Plus className="size-4" /> 新建自定义词库
        </Button>
      </div>

      <div className="glass-tabs flex gap-1 overflow-x-auto p-1.5">
        {tabs.map((item) => (
          <Button
            key={item}
            type="button"
            variant="ghost"
            onClick={() => void navigate({ to: "/books", search: { tab: item } })}
            className={cn("shrink-0 rounded-xl px-4", tab === item && "bg-card/80 text-foreground shadow-sm hover:bg-card/80")}
          >
            {item}
            <span className="ml-1 font-mono text-xs text-muted-foreground">
              {item === "官方词库" ? official.length : custom.length}
            </span>
          </Button>
        ))}
      </div>

      {list.length ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {list.map((b) => {
            const learned = state?.learnedByBook[b.id]?.length ?? 0;
            const cursor = state?.cursors[b.id] ?? 0;
            const pct = Math.round((learned / Math.max(1, b.wordCount)) * 100);
            const active = b.id === activeBook;
            return (
              <div key={b.id} className={cn("glass-panel glass-lift p-6", active && "ring-1 ring-primary/25")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <BookOpen className="size-5" />
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {b.demo && (
                      <span className="rounded-full bg-secondary/70 px-3 py-1 text-xs text-muted-foreground">内置演示</span>
                    )}
                    {active && (
                      <span className="flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">
                        <Check className="size-3.5" />当前
                      </span>
                    )}
                  </div>
                </div>
                <p className="mt-5 font-display text-2xl">{b.name}</p>
                {b.desc && <p className="mt-1 text-sm text-muted-foreground">{b.desc}</p>}
                <Progress value={pct} className="mt-5 h-1.5 bg-secondary/70" />
                <p className="mt-2 font-mono text-xs text-muted-foreground">
                  已学 {learned} / {b.wordCount} · 位置 {b.wordCount ? (cursor % b.wordCount) + 1 : 0}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button type="button" className="rounded-full" onClick={() => choose(b.id)}>
                    {active ? "继续学习" : "切换并学习"}
                  </Button>
                  <Button asChild variant="ghost" className="rounded-full">
                    <Link to="/plan">学习计划</Link>
                  </Button>
                  {b.source === "custom" && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="ml-auto rounded-full text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleting(b)}
                      aria-label="删除词库"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="glass-panel flex flex-col items-center gap-4 p-14 text-center">
          <p className="text-sm text-muted-foreground">还没有自定义词库</p>
          <Button type="button" className="rounded-full" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> 新建自定义词库
          </Button>
        </div>
      )}

      <CreateBookDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={() => void navigate({ to: "/books", search: { tab: "我的词库" } })}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除「{deleting?.name}」？</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreateBookDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const qc = useQueryClient();
  const create = useServerFn(createCustomBook);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<EntryInputT[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const withMeaning = useMemo(() => parsed?.filter((p) => p.translation).length ?? 0, [parsed]);

  const reset = () => {
    setName("");
    setText("");
    setParsed(null);
    setError(null);
  };

  const save = () => {
    if (!parsed?.length || !name.trim()) return;
    setSaving(true);
    setError(null);
    void create({ data: { name: name.trim(), entries: parsed } })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["library"] });
        reset();
        onOpenChange(false);
        onCreated();
      })
      .catch(() => setError("保存失败"))
      .finally(() => setSaving(false));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建自定义词库</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="词库名称" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          <Textarea
            placeholder={"apple\nbanana\n\n或\n\napple\t苹果\nbanana\t香蕉"}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setParsed(null);
            }}
            className="min-h-48 font-mono text-sm"
          />
          {parsed && (
            <div className="rounded-2xl bg-secondary/50 p-4">
              <p className="text-sm">
                共识别 <span className="font-semibold text-primary">{parsed.length}</span> 个词
                {parsed.length > 0 && (
                  <span className="text-muted-foreground"> · 含释义 {withMeaning}</span>
                )}
              </p>
              {parsed.length > 0 && (
                <p className="mt-2 line-clamp-2 font-mono text-xs text-muted-foreground">
                  {parsed.slice(0, 30).map((p) => p.word).join(" · ")}
                </p>
              )}
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          {parsed && parsed.length > 0 ? (
            <Button type="button" className="rounded-full" disabled={!name.trim() || saving} onClick={save}>
              {saving ? "保存中…" : "确认保存"}
            </Button>
          ) : (
            <Button
              type="button"
              className="rounded-full"
              disabled={!text.trim()}
              onClick={() => setParsed(parsePastedWords(text).slice(0, 5000))}
            >
              识别
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
