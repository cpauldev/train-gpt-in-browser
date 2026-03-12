import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export function PanelLoadingState({
  className,
  description = "Loading datasets and saved runs from this browser.",
  title = "Loading local data",
}: {
  className?: string;
  description?: string;
  title?: string;
}) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-3 px-6 text-center", className)}
    >
      <Spinner className="size-5 text-muted-foreground" />
      <div className="space-y-1">
        <p className="font-medium text-sm text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
