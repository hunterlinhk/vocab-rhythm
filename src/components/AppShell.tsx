import { Link, useRouterState } from "@tanstack/react-router";
import { Bot, BookOpen, Brain, ChartNoAxesCombined, ChevronLeft, Crown, Home, Menu, UserRound } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/home", label: "首页", icon: Home },
  { to: "/learn", label: "学习", icon: BookOpen, children: ["单词拼写", "句子拼写", "词库", "学习计划"] },
  { to: "/review", label: "复习", icon: Brain, children: ["错词", "今日复习", "易错词", "误触记录"] },
  { to: "/stats", label: "进度", icon: ChartNoAxesCombined, children: ["今日数据", "历史记录", "学习分析"] },
  { to: "/assistant", label: "AI 助手", icon: Bot },
  { to: "/profile", label: "我的", icon: UserRound },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <div className="app-background min-h-screen p-2 sm:p-3 lg:p-5">
      <div className="mx-auto flex min-h-[calc(100vh-1rem)] max-w-[1540px] gap-3 sm:min-h-[calc(100vh-1.5rem)] lg:min-h-[calc(100vh-2.5rem)] lg:gap-5">
        <aside className={cn("glass-sidebar sticky top-5 hidden h-[calc(100vh-2.5rem)] shrink-0 flex-col overflow-hidden transition-[width] duration-300 lg:flex", collapsed ? "w-[76px]" : "w-64")}>
          <SidebarContent collapsed={collapsed} pathname={pathname} />
          <Button variant="ghost" size="icon" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "展开侧栏" : "收起侧栏"} title={collapsed ? "展开侧栏" : "收起侧栏"} className="absolute right-3 top-4 rounded-xl text-muted-foreground">
            <ChevronLeft className={cn("transition-transform", collapsed && "rotate-180")} />
          </Button>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="glass-mobile-bar sticky top-2 z-40 mb-3 flex h-14 items-center justify-between px-4 lg:hidden">
            <Link to="/home" className="font-display text-lg">韵词 <span className="font-sans text-xs text-muted-foreground">Cadence</span></Link>
            <Sheet>
              <SheetTrigger asChild><Button variant="ghost" size="icon" className="rounded-xl" aria-label="打开目录"><Menu /></Button></SheetTrigger>
              <SheetContent side="left" className="glass-drawer w-[86vw] border-card/60 p-0 sm:max-w-80"><SheetTitle className="sr-only">学习目录</SheetTitle><SidebarContent collapsed={false} pathname={pathname} /></SheetContent>
            </Sheet>
          </header>
          <main className="mx-auto w-full max-w-[1240px] px-2 py-4 sm:px-4 sm:py-6 lg:px-6 lg:py-7">{children}</main>
        </div>
      </div>
    </div>
  );
}

function SidebarContent({ collapsed, pathname }: { collapsed: boolean; pathname: string }) {
  return (
    <>
      <div className={cn("flex h-20 items-center px-5", collapsed ? "justify-center px-2" : "gap-3")}>
        <Link to="/home" className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-primary font-display text-lg text-primary-foreground shadow-lg shadow-primary/20">韵</Link>
        {!collapsed && <div><p className="font-display text-lg leading-none">韵词</p><p className="mt-1 text-[10px] font-medium text-muted-foreground">CADENCE</p></div>}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {!collapsed && <p className="mb-2 px-3 text-[10px] font-semibold text-muted-foreground">学习空间</p>}
        <div className="space-y-1.5">
          {nav.map((item) => {
            const active = pathname === item.to;
            const Icon = item.icon;
            return (
              <div key={item.to}>
                <Link to={item.to} title={collapsed ? item.label : undefined} className={cn("sidebar-link group", collapsed && "justify-center px-0", active && "sidebar-link-active")}>
                  <Icon className="size-[18px] shrink-0" />
                  {!collapsed && <><span className="flex-1">{item.label}</span>{active && <span className="size-1.5 rounded-full bg-primary" />}</>}
                </Link>
                {!collapsed && active && "children" in item && (
                  <div className="ml-[21px] mt-1 border-l border-border/70 py-1 pl-5">
                    {item.children.map((child, index) => (
                      <Link key={child} to={item.to === "/learn" && index === 1 ? "/sentence" : item.to} className="block py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">{child}</Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </nav>

      <div className="m-3 mt-auto">
        <Link to="/profile" className={cn("pro-sidebar glass-lift block p-4", collapsed && "flex justify-center p-3")}>
          <Crown className="size-5 text-primary" />
          {!collapsed && <><p className="mt-3 text-sm font-semibold">升级 Pro</p><p className="mt-1 text-xs leading-5 text-muted-foreground">更多词库与进阶分析</p></>}
        </Link>
      </div>
    </>
  );
}
