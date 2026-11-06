import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { authClient } from "@/integrations/auth/client";

export const Route = createFileRoute("/")({
  component: EntryRoute,
});

function EntryRoute() {
  const navigate = useNavigate();
  const session = authClient.useSession();

  useEffect(() => {
    if (!session.isPending) void navigate({ to: session.data?.user ? "/learn" : "/auth", replace: true });
  }, [navigate, session.data?.user, session.isPending]);

  return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">载入中…</div>;
}
