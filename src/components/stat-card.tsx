import type { ReactNode } from "react";

export function StatCard({
  label,
  labelAccessory,
  value,
}: {
  label: string;
  labelAccessory?: ReactNode;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-background px-4 py-3">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {labelAccessory}
      </div>
      <div className="mt-1 font-semibold text-lg">{value}</div>
    </div>
  );
}
