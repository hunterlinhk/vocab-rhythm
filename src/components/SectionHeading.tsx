import type { ReactNode } from "react";

export function SectionHeading({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="text-xs font-semibold text-primary">{eyebrow}</p>}
        <h2 className="mt-1 font-display text-2xl text-foreground">{title}</h2>
      </div>
      {action}
    </div>
  );
}