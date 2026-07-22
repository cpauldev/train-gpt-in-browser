import { FileText, Plus, Upload } from "lucide-react";
import { PanelHeader } from "@/components/panel-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Frame, FramePanel } from "@/components/ui/frame";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import {
  formatLiveTrainingStatusLabel,
  formatTrainingRunStatusLabel,
} from "@/lib/trainer-presentation";
import {
  getTrainingRunStatusBadgeVariant,
  isTrainingRunInProgress,
  type TrainingRunRecord,
  type WorkspaceFile,
} from "@/lib/trainer-types";
import { getLatestTrainingTelemetry } from "@/lib/training-telemetry";
import { useAnimatedValue } from "@/lib/use-animated-value";

const SELECTION_BUTTON_CLASS =
  "h-auto w-full flex-col items-start gap-3 px-4 py-4 text-left whitespace-normal sm:h-auto";

export function DatasetsPanel({
  files,
  isHydrating,
  isImporting = false,
  onCreateFile,
  onResetLocalData,
  onImportClick,
  onOpenFile,
  runs,
  selectedFileId,
}: {
  files: WorkspaceFile[];
  isHydrating: boolean;
  isImporting?: boolean;
  onCreateFile: () => void;
  onResetLocalData: () => void;
  onImportClick: () => void;
  onOpenFile: (file: WorkspaceFile) => void | Promise<void>;
  runs: TrainingRunRecord[];
  selectedFileId?: string | null;
}) {
  const isBusy = isHydrating || isImporting;
  const runByFileId = new Map(runs.map((run) => [run.fileId, run]));

  return (
    <Frame className="h-full overflow-hidden lg:min-h-0">
      <PanelHeader onResetLocalData={onResetLocalData} title="Datasets" />

      <FramePanel className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
        <ScrollArea className="flex-1" scrollFade>
          <div className="space-y-2 px-4 py-4 lg:px-5 lg:py-5">
            {isHydrating && files.length === 0 ? (
              <Empty className="min-h-72 px-4 py-4">
                <EmptyHeader>
                  <EmptyTitle>Loading local data</EmptyTitle>
                  <EmptyDescription>
                    Loading datasets and saved runs from this browser.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : files.length === 0 ? (
              <Empty className="min-h-72 px-4 py-4">
                <EmptyHeader>
                  <EmptyTitle>No datasets yet</EmptyTitle>
                  <EmptyDescription>
                    Create a local dataset or upload a plain-text file to get started.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              files.map((file) => {
                const run = runByFileId.get(file.id);
                const isSelected = selectedFileId === file.id;

                return (
                  <DatasetListButton
                    key={file.id}
                    file={file}
                    onOpenFile={onOpenFile}
                    run={run}
                    isSelected={isSelected}
                  />
                );
              })
            )}
          </div>
        </ScrollArea>

        <div className="border-border/70 border-t px-4 py-4 lg:px-5">
          <div className="flex flex-col items-stretch gap-2 lg:flex-row lg:gap-0">
            <Button
              onClick={onCreateFile}
              className="w-full min-w-0 gap-2 lg:flex-1"
              disabled={isBusy}
            >
              <Plus />
              New Dataset
            </Button>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    className="w-full min-w-0 gap-2 lg:ml-2 lg:flex-1"
                    aria-label={isImporting ? "Importing files" : "Upload files"}
                    disabled={isBusy}
                  />
                }
                onClick={onImportClick}
              >
                <Upload />
                {isImporting ? "Importing..." : "Upload Dataset"}
              </TooltipTrigger>
              <TooltipPopup>
                {isHydrating
                  ? "Loading browser datasets"
                  : isImporting
                    ? "Reading local files"
                    : "Import .txt files"}
              </TooltipPopup>
            </Tooltip>
          </div>
        </div>
      </FramePanel>
    </Frame>
  );
}

function DatasetListButton({
  file,
  isSelected = false,
  onOpenFile,
  run,
}: {
  file: WorkspaceFile;
  isSelected?: boolean;
  onOpenFile: (file: WorkspaceFile) => void | Promise<void>;
  run?: TrainingRunRecord;
}) {
  return (
    <Button
      variant="ghost"
      onClick={() => void onOpenFile(file)}
      className={SELECTION_BUTTON_CLASS}
      data-active={isSelected ? "" : undefined}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <FileText className="text-muted-foreground" />
          <span className="font-medium text-sm">{file.title ?? file.name}</span>
          {file.source === "user" ? <Badge variant="outline">Local</Badge> : null}
          <DatasetRunBadge run={run} />
        </div>
        <p className="text-muted-foreground text-xs">{getDatasetListDescription(file)}</p>
      </div>
    </Button>
  );
}

function DatasetRunBadge({ run }: { run?: TrainingRunRecord }) {
  const latestPoint = getLatestTrainingTelemetry(run?.telemetry ?? []);
  const isLiveTraining =
    run?.status === "training" && Boolean(latestPoint && latestPoint.step < latestPoint.totalSteps);
  const animatedStep = useAnimatedValue(latestPoint?.step ?? 0, { enabled: isLiveTraining });

  if (!run) {
    return null;
  }

  const label =
    run.status === "starting"
      ? "Preparing..."
      : run.status === "training"
        ? formatLiveTrainingStatusLabel({
            step: isLiveTraining ? animatedStep : latestPoint?.step,
            totalSteps: latestPoint?.totalSteps,
          })
        : isTrainingRunInProgress(run.status)
          ? "Preparing..."
          : formatTrainingRunStatusLabel(run.status);

  return (
    <Badge className="tabular-nums" variant={getTrainingRunStatusBadgeVariant(run.status)}>
      {label}
    </Badge>
  );
}

function getDatasetListDescription(file: WorkspaceFile) {
  return file.description ?? "Custom local dataset";
}
