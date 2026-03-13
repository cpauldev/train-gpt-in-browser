import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { getWorkspaceRuntimeStatus } from "@/lib/trainer-presentation";
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
  const status = getWorkspaceRuntimeStatus(hydrating, workerReady);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge variant={status.badgeVariant} className={cn("w-fit", className)}>
            {status.label}
          </Badge>
        }
      />
      <TooltipPopup align="end">
        <div className="space-y-1.5">
          <p>Worker: {status.workerLabel}</p>
          <p>Local data: {status.storageLabel}</p>
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}
