import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function WorkspaceStatusBadges({
  className,
  hydrating,
  workerReady,
}: {
  className?: string;
  hydrating: boolean;
  workerReady: boolean;
}) {
  const status = getWorkspaceStatus(hydrating, workerReady);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge variant={status.variant} className={cn("w-fit", className)}>
            {status.label}
          </Badge>
        }
      />
      <TooltipPopup align="end">
        <div className="space-y-1.5">
          <p>Worker: {workerReady ? "Ready" : "Starting"}</p>
          <p>Local data: {hydrating ? "Loading" : "Ready"}</p>
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

function getWorkspaceStatus(hydrating: boolean, workerReady: boolean) {
  if (workerReady && !hydrating) {
    return {
      label: "Local runtime ready",
      variant: "success" as const,
    };
  }

  if (workerReady) {
    return {
      label: "Loading local data",
      variant: "info" as const,
    };
  }

  return {
    label: "Preparing local runtime",
    variant: "warning" as const,
  };
}
