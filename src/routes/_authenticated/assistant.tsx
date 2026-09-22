import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { clearMessages, getMessages, sendMessage } from "@/lib/learning.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/assistant")({
  head: () => ({
    meta: [
      { title: "AI 学习助手 · 韵词 Cadence" },
      { name: "description", content: "了解你今天学了什么、复习易错单词、生成例句与小测试的 AI 英语学习助手。" },
      { property: "og:title", content: "AI 学习助手 · 韵词 Cadence" },
      { property: "og:description", content: "基于你的真实学习记录的 AI 英语学习助手。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AssistantPage,
});

const QUICK = [
  "我今天学了什么？",
  "帮我复习经常出错的词",
  "用我学过的词生成 5 个例句",
  "给我出一个小测试",
];

function AssistantPage() {
  const qc = useQueryClient();
  const fetchMessages = useServerFn(getMessages);
  const send = useServerFn(sendMessage);
  const clear = useServerFn(clearMessages);
  const { data: messages } = useQuery({ queryKey: ["messages"], queryFn: () => fetchMessages() });
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [pending]);

  async function submit(text: string) {
    const content = text.trim();
    if (!content || pending) return;
    setInput("");
    setPending(content);
    setError(null);
    try {
      await send({ data: { content } });
      await qc.invalidateQueries({ queryKey: ["messages"] });
    } catch {
      setError("助手暂时无法回复，请稍后再试。");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-10rem)] max-w-3xl flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl">AI 学习助手</h1>
          <p className="text-sm text-muted-foreground">它了解你真实的学习记录。</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={async () => {
            await clear();
            await qc.invalidateQueries({ queryKey: ["messages"] });
          }}
          className="glass-control rounded-full text-muted-foreground hover:text-foreground"
        >
          清空对话
        </Button>
      </div>

      <div ref={boxRef} className="mt-6 flex-1 space-y-6 overflow-y-auto pr-1">
        {!messages?.length && !pending && (
          <div className="ai-glass rise-in p-6">
            <p className="font-display text-lg">想从哪里开始？</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {QUICK.map((q) => (
                <Button
                  variant="outline"
                  size="sm"
                  key={q}
                  type="button"
                  onClick={() => submit(q)}
                  className="glass-control rounded-full hover:border-primary/40"
                >
                  {q}
                </Button>
              ))}
            </div>
          </div>
        )}

        {messages?.map((m) => (
          <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] text-sm leading-relaxed",
                m.role === "user"
                  ? "rounded-2xl bg-primary px-4 py-2.5 text-primary-foreground"
                  : "prose prose-sm max-w-none text-foreground",
              )}
            >
              {m.role === "user" ? m.content : <ReactMarkdown>{m.content}</ReactMarkdown>}
            </div>
          </div>
        ))}

        {pending && (
          <>
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground">{pending}</div>
            </div>
            <p className="animate-pulse text-sm text-muted-foreground">正在思考…</p>
          </>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(input);
        }}
        className="glass-panel mt-4 flex items-end gap-2 p-2"
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit(input);
            }
          }}
          placeholder="问点什么，比如：解释一下 maintain"
          className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2.5 text-sm outline-none"
        />
        <Button
          type="submit"
          disabled={!!pending}
          className="h-10 rounded-xl px-4"
        >
          发送
        </Button>
      </form>
    </div>
  );
}
