import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { authClient } from "@/integrations/auth/client";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "登录 · 韵词 Cadence 英语打字学习" },
      { name: "description", content: "登录韵词 Cadence，同步你的单词打字学习进度、错误记录与 AI 助手对话。" },
      { property: "og:title", content: "登录 · 韵词 Cadence" },
      { property: "og:description", content: "登录后即可同步学习进度与 AI 英语学习助手。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const session = authClient.useSession();

  useEffect(() => {
    if (session.data?.user) void navigate({ to: "/learn", replace: true });
  }, [navigate, session.data?.user]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    if (mode === "up") {
      const { error } = await authClient.signUp.email({
        email,
        password,
        name: email.split("@")[0] ?? "Cadence learner",
      });
      setLoading(false);
      if (error) setMsg(error.message ?? "注册失败，请稍后重试。");
      else void navigate({ to: "/learn", replace: true });
      return;
    }
    const { error } = await authClient.signIn.email({ email, password });
    setLoading(false);
    if (error) setMsg(error.message ?? "登录失败，请检查邮箱和密码。");
    else void navigate({ to: "/learn", replace: true });
  }

  async function google() {
    setLoading(true);
    setMsg(null);
    const { error } = await authClient.signIn.social({
      provider: "google",
      callbackURL: `${window.location.origin}/learn`,
    });
    if (error) {
      setLoading(false);
      setMsg("Google 登录失败，请稍后再试。");
    }
  }

  async function guest() {
    setLoading(true);
    setMsg(null);
    const { error } = await authClient.signIn.anonymous();
    setLoading(false);
    if (error) {
      setMsg(error.message ?? "访客登录失败，请稍后重试。");
      return;
    }
    void navigate({ to: "/learn", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <div className="card-surface rise-in w-full max-w-md rounded-3xl p-8">
        <Link to="/learn" className="font-display text-xl">
          韵词 Cadence
        </Link>
        <h1 className="mt-6 font-display text-2xl">{mode === "in" ? "欢迎回来" : "创建账号"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">同步你的学习记录与 AI 助手对话。</p>

        <button
          type="button"
          onClick={google}
          className="mt-6 w-full rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium transition-colors hover:border-primary/40"
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


        <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> 或使用邮箱 <span className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="邮箱"
            className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-primary/50"
          />
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密码（至少 6 位）"
            className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-primary/50"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {loading ? "处理中…" : mode === "in" ? "登录" : "注册"}
          </button>
        </form>

        {msg && <p className="mt-4 text-sm text-muted-foreground">{msg}</p>}

        <button
          type="button"
          onClick={() => setMode(mode === "in" ? "up" : "in")}
          className="mt-6 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {mode === "in" ? "还没有账号？去注册" : "已有账号？去登录"}
        </button>
      </div>
    </div>
  );
}
