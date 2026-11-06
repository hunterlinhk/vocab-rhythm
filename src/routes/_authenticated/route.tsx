import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authClient } from "@/integrations/auth/client";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const previousUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (session.isPending) return;
    const userId = session.data?.user.id ?? null;
    if (previousUserId.current !== userId) {
      queryClient.clear();
      previousUserId.current = userId;
    }
    if (!userId) void navigate({ to: "/auth", replace: true });
  }, [navigate, queryClient, session.data?.user.id, session.isPending]);

  if (session.isPending || !session.data?.user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">载入中…</div>
    );
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
