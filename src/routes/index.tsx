import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { WORD_BOOKS, TOTAL_WORDS } from "@/data/words";

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
  component: Home,
});

function Home() {
  const navigate = useNavigate();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
  }, []);

  const start = () => void navigate({ to: signedIn ? "/home" : "/auth" });

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <span className="font-display text-lg">韵词 Cadence</span>
        <Link to={signedIn ? "/home" : "/auth"} className="text-sm text-muted-foreground hover:text-foreground">
          {signedIn ? "进入学习" : "登录"}
        </Link>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-24">
        <section className="rise-in pt-16">
          <p className="font-mono text-sm text-primary">keyboard · rhythm · english</p>
          <h1 className="mt-4 max-w-2xl font-display text-5xl leading-tight sm:text-6xl">
            用一段连续的敲击，
            <br />
            把单词写进记忆里。
          </h1>
          <p className="mt-6 max-w-xl text-base text-muted-foreground">
            逐字输入英文单词与句子，获得即时清晰的字符反馈。系统记录你的正确、错误与误触，AI 助手基于真实记录陪你复习。
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={start}
              className="rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              开始练习
            </button>
            <Link
              to="/auth"
              className="rounded-full border border-border bg-card px-6 py-3 text-sm font-medium hover:border-primary/40"
            >
              查看学习记录
            </Link>
          </div>
        </section>

        <section className="mt-24 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Feature title="单词拼写" desc="看中文释义逐字敲出英文，错误即时高亮，可标记误触。" />
          <Feature title="句子拼写" desc="围绕正在学的词练整句，完成后展示译文与主谓宾结构。" />
          <Feature title="完成反馈" desc="细腻动效、发音回放与轻音效，节奏感适合长时间连续输入。" />
          <Feature title="AI 助手" desc="读取你真实的学习数据，回顾常错词、生成例句与小测试。" />
        </section>

        <section className="card-surface mt-16 rounded-3xl p-8">
          <p className="text-sm text-muted-foreground">当前示例词库 {TOTAL_WORDS} 词，后续将接入正式授权词库。</p>
          <div className="mt-5 flex flex-wrap gap-3">
            {WORD_BOOKS.map((b) => (
              <div key={b.id} className="rounded-2xl border border-border bg-card px-5 py-4">
                <p className="font-display text-lg">{b.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{b.words.length} 词</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function Feature({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="card-surface rounded-2xl p-5">
      <p className="font-display text-lg">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{desc}</p>
    </div>
  );
}
