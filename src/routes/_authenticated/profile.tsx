import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { LogOut, UserRound } from "lucide-react";
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
    { name: "description", content: "管理韵词账号与学习设置。" },
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
        void qc.invalidateQueries({ queryKey: ["learning-problems"] });
        void qc.invalidateQueries({ queryKey: ["due-review-count"] });
      })
      .catch(() => {
        setShareReviewProgress(state?.shareReviewProgress ?? true);
        void qc.invalidateQueries({ queryKey: ["learning-state"] });
        void qc.invalidateQueries({ queryKey: ["stats"] });
        void qc.invalidateQueries({ queryKey: ["learning-problems"] });
        void qc.invalidateQueries({ queryKey: ["due-review-count"] });
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
      </section>

      <section className="glass-panel overflow-visible">
        <Setting title="严格拼写模式" info="拼错时清空输入，从头重新拼这个单词。"><Switch aria-label="严格拼写模式" checked={strict} onCheckedChange={toggleStrict}/></Setting>
        <Setting title="跨词书共享复习进度" info="开启时，同一个规范化单词在不同词书中共享认词或拼写进度；关闭时，每本词书分别维护进度。认词和拼写始终独立。">
          <Switch aria-label="跨词书共享复习进度" checked={shareReviewProgress} onCheckedChange={toggleReviewSharing}/>
        </Setting>
        <Setting title="网页键盘" info="手机拼写时显示页面内置键盘。"><Switch aria-label="网页键盘" checked={vk} onCheckedChange={setVirtualKeyboard}/></Setting>
      </section>

      <Button variant="ghost" onClick={async () => { await supabase.auth.signOut(); void navigate({ to: "/auth", replace: true }); }} className="rounded-full text-muted-foreground"><LogOut /> 退出登录</Button>
    </div>
  );
}

function Setting({ title, info, children }: { title: string; info?: string; children: ReactNode }) {
  return <div className="flex items-center gap-4 border-b border-border/50 px-5 py-4 last:border-0 sm:px-7"><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><p className="text-sm font-medium">{title}</p>{info && <SettingInfo text={info}/>}</div></div>{children}</div>;
}
