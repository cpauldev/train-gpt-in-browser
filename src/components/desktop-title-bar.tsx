import { Brain, Copy, Minus, X } from "lucide-react";

const windowControls = [
  {
    label: "Minimize",
    icon: Minus,
    action: () => window.desktopWindow?.minimize(),
    destructive: false,
  },
  {
    label: "Maximize or restore",
    icon: Copy,
    action: () => window.desktopWindow?.toggleMaximize(),
    destructive: false,
  },
  {
    label: "Close",
    icon: X,
    action: () => window.desktopWindow?.close(),
    destructive: true,
  },
] as const;

export function DesktopTitleBar() {
  if (!window.desktopWindow) return null;

  return (
    <header className="desktop-drag-region relative flex h-9 shrink-0 items-center justify-end border-border border-b bg-background/95 text-muted-foreground">
      <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-2">
        <Brain className="size-4 text-foreground" strokeWidth={1.8} />
        <span className="truncate font-semibold text-foreground text-sm">Train GPT in Browser</span>
      </div>
      <div className="desktop-no-drag flex h-full">
        {windowControls.map(({ action, destructive, icon: Icon, label }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            onClick={action}
            className={
              destructive
                ? "flex w-12 items-center justify-center transition-colors hover:bg-red-500 hover:text-white"
                : "flex w-11 items-center justify-center transition-colors hover:bg-accent hover:text-accent-foreground"
            }
          >
            <Icon className="size-3.5" strokeWidth={1.8} />
          </button>
        ))}
      </div>
    </header>
  );
}
