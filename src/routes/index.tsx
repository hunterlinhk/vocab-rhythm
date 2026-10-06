import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  component: EntryRoute,
});

function EntryRoute() {
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession()
      .then(({ data }) => {
        if (active) void navigate({ to: data.session ? "/learn" : "/auth", replace: true });
      })
      .catch(() => {
        if (active) void navigate({ to: "/auth", replace: true });
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">载入中…</div>;
}
