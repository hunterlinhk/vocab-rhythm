import { Link, useRouterState } from "@tanstack/react-router";
import { Bot, BookOpen, Brain, ChartNoAxesCombined, ChevronDown, ChevronLeft, Crown, Menu, UserRound } from "lucide-react";
import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const nav = [
  {
    to: "/learn",
    label: "学习",
    icon: BookOpen,
    children: [
      { label: "单词拼写", to: "/learn" },
      { label: "背单词", to: "/memorize" },
      { label: "句子拼写", to: "/sentence" },
      { label: "词库", to: "/books" },
      { label: "学习计划", to: "/plan" },
    ],
  },
  {
    to: "/review",
    label: "复习",
    icon: Brain,
    children: [
      { label: "今日复习", to: "/review", search: { tab: "今日复习" } },
      { label: "错词", to: "/review", search: { tab: "错词" } },
      { label: "易错词", to: "/review", search: { tab: "易错词" } },
      { label: "误触记录", to: "/review", search: { tab: "误触记录" } },
    ],
  },
  {
    to: "/stats",
    label: "进度",
    icon: ChartNoAxesCombined,
    children: [
      { label: "今日数据", to: "/stats", search: { tab: "今日数据" } },
      { label: "历史记录", to: "/stats", search: { tab: "历史记录" } },
      { label: "学习分析", to: "/stats", search: { tab: "学习分析" } },
    ],
  },
  { to: "/assistant", label: "AI 助手", icon: Bot },
  { to: "/profile", label: "我的", icon: UserRound },
] as const;

const LEARN_PATHS = ["/learn", "/memorize", "/sentence", "/books", "/plan"];
const isActive = (itemTo: string, pathname: string) =>
  itemTo === "/learn" ? LEARN_PATHS.includes(pathname) : pathname === itemTo;

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // kept in the shell so the mobile drawer remembers what the user expanded or collapsed
  const [expandedItem, setExpandedItem] = useState<string | null>(() => {
    const parent = nav.find((item) => isActive(item.to, pathname));
    return parent && "children" in parent ? parent.to : null;
  });

  const handleSidebarPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch") return;
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const bounds = sidebar.getBoundingClientRect();
    sidebar.style.setProperty("--pointer-y", `${event.clientY - bounds.top}px`);
    sidebar.style.setProperty("--pointer-x", `${event.clientX - bounds.left}px`);
    sidebar.dataset["pointerActive"] = "true";
  };

  const handleSidebarPointerLeave = () => {
    if (sidebarRef.current) sidebarRef.current.dataset["pointerActive"] = "false";
  };

  return (
    <div className="app-background min-h-screen p-2 sm:p-3 lg:p-5">
      <div className="mx-auto flex min-h-[calc(100vh-1rem)] max-w-[1540px] gap-3 sm:min-h-[calc(100vh-1.5rem)] lg:min-h-[calc(100vh-2.5rem)] lg:gap-5">
        <aside ref={sidebarRef} onPointerMove={handleSidebarPointerMove} onPointerLeave={handleSidebarPointerLeave} className={cn("glass-sidebar sticky top-5 hidden h-[calc(100vh-2.5rem)] shrink-0 flex-col overflow-hidden transition-[width] duration-300 lg:flex", collapsed ? "w-[76px]" : "w-64")}>
          <div className="sidebar-pointer-light" aria-hidden="true" />
          <SidebarContent collapsed={collapsed} pathname={pathname} />
          <Button variant="ghost" size="icon" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "展开侧栏" : "收起侧栏"} title={collapsed ? "展开侧栏" : "收起侧栏"} className="absolute right-3 top-4 rounded-xl text-muted-foreground">
            <ChevronLeft className={cn("transition-transform", collapsed && "rotate-180")} />
          </Button>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="glass-mobile-bar sticky top-2 z-40 mb-3 flex h-14 items-center justify-between px-4 lg:hidden">
            <Link to="/home" className="font-display text-lg font-semibold text-foreground">Cadence <span className="font-sans text-xs font-medium text-muted-foreground">韵词</span></Link>
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
  const currentTab = useRouterState({
    select: (state) => (state.location.search as { tab?: string } | undefined)?.tab,
  });
  const activeParent = nav.find((item) => isActive(item.to, pathname));
  const [expandedItem, setExpandedItem] = useState<string | null>(
    activeParent && "children" in activeParent ? activeParent.to : null,
  );

  return (
    <>
      <div className={cn("relative z-10 flex h-20 items-center px-5", collapsed ? "justify-center px-2" : "gap-3")}>
        <Link to="/home" className={cn("brand-wordmark", collapsed && "brand-wordmark-collapsed")} aria-label="Cadence 首页">
          <span className="font-display text-lg font-semibold leading-none">{collapsed ? "C" : "Cadence"}</span>
          {!collapsed && <span className="font-sans text-[10px] font-semibold text-muted-foreground">韵词</span>}
        </Link>
      </div>

      <nav className="relative z-10 flex-1 overflow-y-auto px-3 py-3">
        {!collapsed && <p className="mb-2 px-3 text-[10px] font-semibold text-muted-foreground">学习空间</p>}
        <div className="space-y-1.5">
          {nav.map((item) => {
            const active = isActive(item.to, pathname);
            const hasChildren = "children" in item;
            const expanded = hasChildren && expandedItem === item.to;
            const Icon = item.icon;
            return (
              <div key={item.to}>
                <Link
                  to={item.to}
                  title={collapsed ? item.label : undefined}
                  aria-expanded={hasChildren ? expanded : undefined}
                  onClick={(event) => {
                    if (!hasChildren || collapsed) return;
                    if (active) event.preventDefault();
                    setExpandedItem((current) => current === item.to ? null : item.to);
                  }}
                  className={cn("sidebar-link group", collapsed && "justify-center px-0", active && "sidebar-link-active")}
                >
                  <Icon className="size-[18px] shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="flex-1">{item.label}</span>
                      {hasChildren ? (
                        <ChevronDown className={cn("size-3.5 transition-transform duration-300", expanded && "rotate-180")} />
                      ) : active ? <span className="size-1.5 rounded-full bg-primary" /> : null}
                    </>
                  )}
                </Link>
                {!collapsed && hasChildren && (
                  <div className={cn("sidebar-subnav", expanded && "sidebar-subnav-open")}>
                    <div className="overflow-hidden">
                      <div className="ml-[21px] mt-1 border-l border-border/70 py-1 pl-5">
                        {item.children.map((child, childIndex) => {
                          const childTab = "search" in child ? child.search.tab : undefined;
                          const childActive =
                            pathname === child.to &&
                            (childTab === undefined
                              ? true
                              : currentTab === undefined
                                ? childIndex === 0
                                : currentTab === childTab);
                          return (
                            <Link
                              key={child.label}
                              to={child.to}
                              search={("search" in child ? child.search : {}) as never}
                              className={cn(
                                "block py-1.5 text-xs transition-colors",
                                childActive
                                  ? "font-semibold text-foreground"
                                  : "text-muted-foreground hover:text-foreground",
                              )}
                            >
                              {child.label}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </nav>

      <div className="relative z-10 m-3 mt-auto">
        <Link to="/profile" className={cn("pro-sidebar glass-lift block p-4", collapsed && "flex justify-center p-3")}>
          <Crown className="size-5 text-primary" />
          {!collapsed && <><p className="mt-3 text-sm font-semibold">升级 Pro</p><p className="mt-1 text-xs leading-5 text-muted-foreground">更多词库与进阶分析</p></>}
        </Link>
      </div>
    </>
  );
}
