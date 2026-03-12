import { FileText, Plus, Upload } from "lucide-react";
import { PanelLoadingState } from "@/components/panel-loading-state";
import { SidebarFrameHeader } from "@/components/sidebar-frame-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Frame, FramePanel } from "@/components/ui/frame";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import {
  getTrainingRunStatusBadgeVariant,
  type TrainingRunRecord,
  type WorkspaceFile,
} from "@/lib/trainer-types";

const SELECTION_BUTTON_CLASS =
  "h-auto w-full flex-col items-start gap-3 px-4 py-4 text-left whitespace-normal sm:h-auto";

export function SidebarListView({
  files,
  isHydrating,
  onCreateFile,
  onResetLocalData,
  onImportClick,
  onOpenFile,
  runs,
}: {
  files: WorkspaceFile[];
  isHydrating: boolean;
  onCreateFile: () => void;
  onResetLocalData: () => void;
  onImportClick: () => void;
  onOpenFile: (file: WorkspaceFile) => Promise<void>;
  runs: TrainingRunRecord[];
}) {
  const runByFileId = new Map(runs.map((run) => [run.fileId, run]));

  return (
    <Frame className="h-full overflow-hidden xl:min-h-0">
      <SidebarFrameHeader onResetLocalData={onResetLocalData} title="Workspace" />

      <FramePanel className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
        <ScrollArea className="flex-1" scrollFade scrollbarGutter>
          <div className="space-y-2 px-5 py-5">
            {isHydrating ? (
              <PanelLoadingState className="min-h-[18rem]" />
            ) : files.length === 0 ? (
              <Empty className="min-h-[18rem] px-4 py-4">
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

                return (
                  <DatasetListButton key={file.id} file={file} onOpenFile={onOpenFile} run={run} />
                );
              })
            )}
          </div>
        </ScrollArea>

        <div className="border-t border-border/70 px-5 py-4">
          <div className="flex items-stretch">
            <Button onClick={onCreateFile} className="min-w-0 flex-1 gap-2">
              <Plus className="size-4" />
              New Dataset
            </Button>
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="outline" className="ml-2 min-w-0 flex-1 gap-2" />}
                onClick={onImportClick}
              >
                <Upload className="size-4" />
                Upload Dataset
              </TooltipTrigger>
              <TooltipPopup>Import .txt files</TooltipPopup>
            </Tooltip>
          </div>
        </div>
      </FramePanel>
    </Frame>
  );
}

function DatasetListButton({
  file,
  onOpenFile,
  run,
}: {
  file: WorkspaceFile;
  onOpenFile: (file: WorkspaceFile) => Promise<void>;
  run?: TrainingRunRecord;
}) {
  return (
    <Button
      variant="ghost"
      onClick={() => void onOpenFile(file)}
      className={SELECTION_BUTTON_CLASS}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <FileText className="size-4 text-muted-foreground" />
          <span className="font-medium text-sm">{file.title ?? file.name}</span>
          {file.source === "user" ? <Badge variant="outline">Local</Badge> : null}
          {run ? (
            <Badge variant={getTrainingRunStatusBadgeVariant(run.status)}>{run.status}</Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{getDatasetListDescription(file)}</p>
      </div>
    </Button>
  );
}

function getDatasetListDescription(file: WorkspaceFile) {
  return file.description ?? "Custom local dataset";
}
