import { useState } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/** Compact help affordance: hover/focus on desktop, tap to toggle on touch screens. */
export function SettingInfo({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <span className={cn("group relative inline-flex", className)}>
      <button
        type="button"
        aria-label="说明"
        aria-expanded={open}
        onClick={(event) => {
          if (open) event.currentTarget.blur();
          setOpen(!open);
        }}
        className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info className="size-3.5" aria-hidden="true" />
      </button>
      <span
        role="tooltip"
        className={cn(
          "invisible absolute right-0 top-full z-50 mt-2 w-60 rounded-xl border border-border/70 bg-popover px-3 py-2 text-left text-xs leading-relaxed text-popover-foreground opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100",
          open && "visible opacity-100",
        )}
      >
        {text}
      </span>
    </span>
  );
}
