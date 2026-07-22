import { useEffect, useState } from "react";
import { DatasetsPanel } from "@/components/datasets-panel";
import { DesktopTitleBar } from "@/components/desktop-title-bar";
import { EditorPanel } from "@/components/editor-panel";
import { ResultsPanel } from "@/components/results-panel";
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
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WelcomePanel } from "@/components/welcome-panel";
import { useIsMobile } from "@/hooks/use-media-query";
import { useAppTheme } from "@/lib/app-theme";
import { useBrowserTrainer } from "@/lib/use-browser-trainer";
import { useTrainingPageTitle } from "@/lib/use-training-page-title";
import { useWorkspaceEditor } from "@/lib/use-workspace-editor";
import { cn } from "@/lib/utils";

const REPO_URL = "https://github.com/cpauldev/train-gpt-in-browser";
const WORKSPACE_TRANSITION_MS = 500;
type DesktopView = "overview" | "workspace";
type MobileTab = "welcome" | "datasets" | "editor" | "results";

export default function App() {
  const isMobile = useIsMobile();
  const theme = useAppTheme();
  const trainer = useBrowserTrainer();
  const workspaceEditor = useWorkspaceEditor(trainer);

  const hasSelectedFile = Boolean(trainer.workspace.selectedFile);
  const currentView: DesktopView = hasSelectedFile ? "workspace" : "overview";
  const [mobileTab, setMobileTab] = useState<MobileTab>("welcome");
  const [displayedView, setDisplayedView] = useState(currentView);
  const [frozenWorkspaceProps, setFrozenWorkspaceProps] = useState(workspaceEditor);

  useEffect(() => {
    if (currentView === "workspace" && workspaceEditor.editorViewProps.selectedFile) {
      setFrozenWorkspaceProps(workspaceEditor);
    }
  }, [currentView, workspaceEditor]);

  useEffect(() => {
    if (currentView === "workspace") {
      setDisplayedView(currentView);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setDisplayedView("overview");
    }, WORKSPACE_TRANSITION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [currentView]);

  useEffect(() => {
    if (isMobile && hasSelectedFile) {
      setMobileTab("editor");
    }
  }, [isMobile, hasSelectedFile]);

  useTrainingPageTitle({
    fileTitle:
      trainer.workspace.selectedFile?.title ??
      trainer.workspace.selectedFile?.name ??
      trainer.runs.active?.name,
    run: workspaceEditor.titleRun,
  });

  const welcomePanel = (
    <WelcomePanel
      isHydrating={trainer.busyState.hydrating}
      repoUrl={REPO_URL}
      workerReady={trainer.busyState.workerReady}
    />
  );
  const datasetsPanel = <DatasetsPanel {...workspaceEditor.listViewProps} />;
  const shouldUseFrozenProps = currentView === "overview";
  const workspaceProps = shouldUseFrozenProps ? frozenWorkspaceProps : workspaceEditor;

  const editorPanel = <EditorPanel {...workspaceProps.editorViewProps} />;
  const resultsPanel = <ResultsPanel {...workspaceProps.resultsPanelProps} />;

  return (
    <TooltipProvider delay={200}>
      <div className="flex h-dvh flex-col overflow-hidden bg-background">
        <DesktopTitleBar />
        <AlertDialog
          open={workspaceEditor.resetDialogOpen}
          onOpenChange={workspaceEditor.setResetDialogOpen}
        >
          <main className="min-h-0 flex-1 overflow-hidden bg-background text-foreground">
            <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-3 py-3 lg:min-h-0 lg:px-6 lg:py-5">
              {isMobile ? (
                <Tabs
                  value={mobileTab}
                  onValueChange={(value) => setMobileTab(value as MobileTab)}
                  className="min-h-0 flex-1 gap-3"
                >
                  <div className="px-1">
                    <TabsList variant="underline" className="w-full">
                      <TabsTab value="welcome">Welcome</TabsTab>
                      <TabsTab value="datasets">Datasets</TabsTab>
                      <TabsTab value="editor" disabled={!hasSelectedFile}>
                        Editor
                      </TabsTab>
                      <TabsTab value="results">Results</TabsTab>
                    </TabsList>
                  </div>

                  <TabsPanel value="welcome" className="min-h-0 flex-1">
                    <section className="h-full min-h-0 overflow-hidden">{welcomePanel}</section>
                  </TabsPanel>

                  <TabsPanel value="datasets" className="min-h-0 flex-1">
                    <section className="h-full min-h-0 overflow-hidden">{datasetsPanel}</section>
                  </TabsPanel>

                  <TabsPanel value="editor" className="min-h-0 flex-1">
                    <section className="h-full min-h-0 overflow-hidden">{editorPanel}</section>
                  </TabsPanel>

                  <TabsPanel value="results" className="min-h-0 flex-1">
                    <section className="h-full min-h-0 overflow-hidden">{resultsPanel}</section>
                  </TabsPanel>
                </Tabs>
              ) : (
                <section className="relative min-h-0 flex-1 overflow-hidden">
                  <div
                    className={cn(
                      "grid h-full min-h-0 gap-6 transition-all duration-500 ease-in-out",
                      "lg:w-[calc(200%+1.5rem)] lg:grid-cols-[repeat(4,minmax(0,calc((100%-4.5rem)/4)))]",
                      displayedView === "overview" && "lg:translate-x-0",
                      displayedView === "workspace" && "lg:translate-x-[calc(-50%-0.75rem)]",
                    )}
                  >
                    <section
                      className={cn(
                        "overflow-hidden transition-opacity duration-500 lg:h-full lg:min-h-0",
                        displayedView === "workspace" && "lg:opacity-0",
                      )}
                    >
                      {welcomePanel}
                    </section>

                    <section
                      className={cn(
                        "overflow-hidden transition-opacity duration-500 lg:h-full lg:min-h-0",
                        displayedView === "workspace" && "lg:opacity-0",
                      )}
                    >
                      {datasetsPanel}
                    </section>

                    <section
                      className={cn(
                        "overflow-hidden transition-opacity duration-500 lg:h-full lg:min-h-0",
                        displayedView === "overview" && "lg:opacity-0",
                      )}
                    >
                      {editorPanel}
                    </section>

                    <section
                      className={cn(
                        "overflow-hidden transition-opacity duration-500 lg:h-full lg:min-h-0",
                        displayedView === "overview" && "lg:opacity-0",
                      )}
                    >
                      {resultsPanel}
                    </section>
                  </div>
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
              <AlertDialogTitle>Reset Local Data?</AlertDialogTitle>
              <AlertDialogDescription>
                Your saved runs, custom files, and preferences will be deleted.
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
                loading={trainer.busyState.resetting}
                disabled={trainer.busyState.resetting}
              >
                Reset Local Data
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>

        <AlertDialog
          open={workspaceEditor.deleteModelDialogOpen}
          onOpenChange={workspaceEditor.setDeleteModelDialogOpen}
        >
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Model?</AlertDialogTitle>
              <AlertDialogDescription>
                This saved model and its generated results will be deleted. The dataset file will
                stay in your workspace.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose
                render={
                  <Button variant="outline" disabled={workspaceEditor.isDeletingModel}>
                    Cancel
                  </Button>
                }
              />
              <Button
                variant="destructive"
                onClick={() => {
                  void workspaceEditor.handleDeleteSelectedModel();
                }}
                loading={workspaceEditor.isDeletingModel}
                disabled={workspaceEditor.isDeletingModel}
              >
                Delete Model
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
