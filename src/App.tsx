import { RunPanel } from "@/components/run-panel";
import { SidebarEditorView } from "@/components/sidebar-editor-view";
import { SidebarListView } from "@/components/sidebar-list-view";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-media-query";
import { useAppTheme } from "@/lib/app-theme";
import { useBrowserTrainer } from "@/lib/use-browser-trainer";
import { useWorkspaceEditor } from "@/lib/use-workspace-editor";
import { useState } from "react";

const REPO_URL = "https://github.com/cpauldev/train-gpt-in-browser";

export default function App() {
  const isMobile = useIsMobile();
  const theme = useAppTheme();
  const trainer = useBrowserTrainer();
  const workspaceEditor = useWorkspaceEditor(trainer);
  const [mobileTab, setMobileTab] = useState<"run" | "workspace">("run");

  const workspacePanel = workspaceEditor.isEditorOpen ? (
    <SidebarEditorView {...workspaceEditor.editorViewProps} />
  ) : (
    <SidebarListView {...workspaceEditor.listViewProps} />
  );

  const runPanel = <RunPanel {...workspaceEditor.runPanelProps} repoUrl={REPO_URL} />;

  return (
    <TooltipProvider delay={200}>
      <AlertDialog
        open={workspaceEditor.resetDialogOpen}
        onOpenChange={workspaceEditor.setResetDialogOpen}
      >
        <main className="h-dvh overflow-hidden bg-background text-foreground lg:h-screen">
          <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-3 py-3 lg:min-h-0 lg:px-6 lg:py-5">
            {isMobile ? (
              <Tabs
                value={mobileTab}
                onValueChange={(value) => setMobileTab(value as "run" | "workspace")}
                className="min-h-0 flex-1 gap-3"
              >
                <div className="px-1">
                  <TabsList variant="underline" className="w-full">
                    <TabsTab value="run">Run</TabsTab>
                    <TabsTab value="workspace">Workspace</TabsTab>
                  </TabsList>
                </div>

                <TabsPanel value="run" className="min-h-0 flex-1">
                  <section className="h-full min-h-0 overflow-hidden">{runPanel}</section>
                </TabsPanel>

                <TabsPanel value="workspace" className="min-h-0 flex-1">
                  <section className="h-full min-h-0 overflow-hidden">{workspacePanel}</section>
                </TabsPanel>
              </Tabs>
            ) : (
              <section className="grid min-h-0 flex-1 gap-6 lg:grid-cols-2 lg:overflow-hidden">
                <section className="overflow-hidden lg:h-full lg:min-h-0">{runPanel}</section>

                <section className="overflow-hidden lg:h-full lg:min-h-0">
                  {workspacePanel}
                </section>
              </section>
            )}
          </div>
        </main>

        <input
          ref={workspaceEditor.fileInputRef}
          type="file"
          accept=".txt,text/plain"
          multiple
          aria-hidden="true"
          tabIndex={-1}
          className="pointer-events-none absolute -left-full size-px opacity-0"
          onChange={(event) => {
            void workspaceEditor.handleImportedFiles(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />

        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset local data?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes every saved run, custom file, cached result, and local preference in this
              browser, including your theme choice. The bundled datasets are restored automatically
              after the reset finishes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button variant="outline" disabled={trainer.busyState.resetting}>
                  Cancel
                </Button>
              }
            />
            <Button
              variant="destructive"
              onClick={() => {
                void (async () => {
                  await workspaceEditor.handleResetLocalData();
                  theme.resetPreference();
                })();
              }}
              disabled={trainer.busyState.resetting}
            >
              {trainer.busyState.resetting ? "Resetting..." : "Reset local data"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </TooltipProvider>
  );
}
