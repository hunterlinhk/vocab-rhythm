import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import type { ReactNode } from "react";

const nav = [
  { to: "/learn", label: "单词" },
  { to: "/sentence", label: "句子" },
  { to: "/stats", label: "记录" },
  { to: "/assistant", label: "AI 助手" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link to="/" className="font-display text-lg tracking-tight">
            韵词 <span className="text-muted-foreground text-sm">Cadence</span>
          </Link>
          <nav className="flex items-center gap-1">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="rounded-full px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                activeProps={{ className: "bg-card text-foreground shadow-sm border border-border/70" }}
              >
                {n.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={async () => {
                await supabase.auth.signOut();
                void navigate({ to: "/" });
              }}
              className="ml-2 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              退出
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-10">{children}</main>
    </div>
  );
}
