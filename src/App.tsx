import { RunPanel } from "@/components/run-panel";
import { SidebarEditorView } from "@/components/sidebar-editor-view";
import { SidebarListView } from "@/components/sidebar-list-view";
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
import { useAppTheme } from "@/lib/app-theme";
import { useBrowserTrainer } from "@/lib/use-browser-trainer";
import { useWorkspaceEditor } from "@/lib/use-workspace-editor";

const REPO_URL = "https://github.com/cpauldev/train-gpt-in-browser";

export default function App() {
  const theme = useAppTheme();
  const trainer = useBrowserTrainer();
  const workspaceEditor = useWorkspaceEditor(trainer);

  return (
    <TooltipProvider delay={200}>
      <AlertDialog
        open={workspaceEditor.resetDialogOpen}
        onOpenChange={workspaceEditor.setResetDialogOpen}
      >
        <main className="min-h-screen bg-background text-foreground xl:h-screen xl:overflow-hidden">
          <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-5 sm:px-6 xl:h-full xl:min-h-0">
            <section className="grid min-h-0 flex-1 gap-6 lg:grid-cols-2 xl:overflow-hidden">
              <section className="overflow-hidden xl:h-full xl:min-h-0">
                {workspaceEditor.isEditorOpen ? (
                  <SidebarEditorView {...workspaceEditor.editorViewProps} />
                ) : (
                  <SidebarListView {...workspaceEditor.listViewProps} />
                )}
              </section>

              <section className="overflow-hidden xl:h-full xl:min-h-0">
                <RunPanel {...workspaceEditor.runPanelProps} repoUrl={REPO_URL} />
              </section>
            </section>
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
