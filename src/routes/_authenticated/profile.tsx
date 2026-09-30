import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, ChevronRight, Crown, Headphones, Keyboard, LogOut, Moon, Network, ShieldCheck, UserRound } from "lucide-react";
import { setVirtualKeyboard, useVirtualKeyboard } from "@/lib/virtual-keyboard";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { saveSettings } from "@/lib/learning.functions";
import { useLearningState } from "@/hooks/use-learning-state";
import { queueLearningStateWrite } from "@/lib/learning-state.runtime";
import { supabase } from "@/integrations/supabase/client";
import { SettingInfo } from "@/components/setting-info";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({ meta: [
    { title: "我的 · 韵词 Cadence" },
    { name: "description", content: "管理韵词账号、会员、发音、主题与学习设置。" },
    { property: "og:title", content: "我的 · 韵词 Cadence" },
    { property: "og:description", content: "账号、会员与学习偏好设置。" },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: ProfilePage,
});

function ProfilePage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("学习者");
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [sound, setSound] = useState(true);
  const persistSettings = useServerFn(saveSettings);
  const qc = useQueryClient();
  const { data: state } = useLearningState();
  const [strict, setStrict] = useState(false);
  const [shareReviewProgress, setShareReviewProgress] = useState(true);
  const vk = useVirtualKeyboard();

  useEffect(() => {
    if (state) {
      setStrict(state.strictSpelling);
      setShareReviewProgress(state.shareReviewProgress ?? true);
    }
  }, [state]);
  useEffect(() => { void supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? "学习者")); }, []);

  const toggleStrict = (on: boolean) => {
    setStrict(on);
    void queueLearningStateWrite(() => persistSettings({ data: { strictSpelling: on } }))
      .then(() => void qc.invalidateQueries({ queryKey: ["learning-state"] }))
      .catch(() => undefined);
  };

  const toggleReviewSharing = (on: boolean) => {
    setShareReviewProgress(on);
    void queueLearningStateWrite(() => persistSettings({ data: { shareReviewProgress: on } }))
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["learning-state"] });
        void qc.invalidateQueries({ queryKey: ["stats"] });
      })
      .catch(() => {
        setShareReviewProgress(state?.shareReviewProgress ?? true);
        void qc.invalidateQueries({ queryKey: ["learning-state"] });
        void qc.invalidateQueries({ queryKey: ["stats"] });
        toast.error("保存复习设置失败，请重试");
      });
  };

  return (
    <div className="space-y-7 pb-8">
      <div><p className="text-sm font-medium text-primary">PERSONAL</p><h1 className="mt-2 font-display text-4xl">我的</h1></div>
      <section className="glass-hero flex flex-col gap-6 rounded-[2rem] p-7 sm:flex-row sm:items-center sm:justify-between sm:p-9">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20"><UserRound /></div>
          <div className="min-w-0"><p className="truncate font-display text-2xl">{email}</p><p className="mt-1 text-sm text-muted-foreground">免费账户 · 学习记录已同步</p></div>
        </div>
        <Button variant="outline" className="glass-control rounded-full">编辑资料</Button>
      </section>

      <section className="pro-glass glass-lift flex flex-col gap-6 p-7 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="flex items-center gap-2 text-primary"><Crown className="size-5"/><span className="text-sm font-semibold">Cadence Pro</span></div><h2 className="mt-4 font-display text-3xl">让复习与 AI 更懂你</h2><p className="mt-2 text-sm text-muted-foreground">解锁无限 AI 辅助、进阶学习分析和更多正式词库。</p></div>
        <Button className="shrink-0 rounded-full px-6">升级 Pro</Button>
      </section>

      <section className="glass-panel overflow-visible">
        <Setting icon={Headphones} title="完成后自动发音" description="每题完成后朗读单词或句子"><Switch checked={autoSpeak} onCheckedChange={setAutoSpeak}/></Setting>
        <Setting icon={ShieldCheck} title="严格拼写模式" description="拼错时清空输入，从头重新拼这个单词"><Switch checked={strict} onCheckedChange={toggleStrict}/></Setting>
        <Setting icon={Network} title="跨词书共享复习进度" info="开启时，同一个规范化单词在不同词书中共享认词或拼写进度；关闭时，每本词书分别维护进度。认词和拼写始终独立。">
          <Switch checked={shareReviewProgress} onCheckedChange={toggleReviewSharing}/>
        </Setting>
        <Setting icon={Keyboard} title="网页键盘" description="手机拼写时显示页面内置键盘"><Switch checked={vk} onCheckedChange={setVirtualKeyboard}/></Setting>
        <Setting icon={Bell} title="按键与完成音效" description="保留轻量、克制的操作反馈"><Switch checked={sound} onCheckedChange={setSound}/></Setting>
        <Setting icon={Moon} title="主题" description="当前为浅色玻璃主题"><ChevronRight className="size-5 text-muted-foreground"/></Setting>
      </section>

      <Button variant="ghost" onClick={async () => { await supabase.auth.signOut(); void navigate({ to: "/" }); }} className="rounded-full text-muted-foreground"><LogOut /> 退出登录</Button>
    </div>
  );
}

function Setting({ icon: Icon, title, description, info, children }: { icon: typeof Headphones; title: string; description?: string; info?: string; children: ReactNode }) {
  return <div className="flex items-center gap-4 border-b border-border/50 px-5 py-4 last:border-0 sm:px-7"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary/70 text-primary"><Icon className="size-5"/></div><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><p className="text-sm font-medium">{title}</p>{info && <SettingInfo text={info}/>}</div>{description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}</div>{children}</div>;
}
