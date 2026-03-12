import { useCallback, useEffect, useRef, useState } from "react";
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
import { formatTemperatureKey } from "@/lib/trainer-core";
import { createGenerationConfig, hasTrainingRun } from "@/lib/trainer-types";
import { useBrowserTrainer } from "@/lib/use-browser-trainer";

// import { resolveBasePath } from "@/lib/utils";

const REPO_URL = "https://github.com/cpauldev/train-gpt-in-browser";
// const BANNER_SRC = resolveBasePath("dreamphrasegpt.png");

export default function App() {
  const {
    activeRun,
    activeTab,
    busyState,
    createFile,
    downloadRunArtifact,
    files,
    generationConfig,
    generateForActiveRun,
    importFiles,
    removeFile,
    removeRun,
    resetAll,
    resumeRun,
    runs,
    saveSelectedFileContent,
    saveSelectedFileName,
    selectFile,
    selectedFile,
    selectedFileId,
    selectedFileSummary,
    setActiveTab,
    setGenerationConfig,
    setTrainingConfig,
    startTraining,
    toggleLike,
    trainingConfig,
  } = useBrowserTrainer();
  const [sidebarMode, setSidebarMode] = useState<"editor" | "list">("list");
  const [draftName, setDraftName] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selectedFileName = selectedFile?.name ?? "";
  const selectedFileContent = selectedFile?.content ?? "";
  const selectedFileRun = selectedFileId
    ? (runs.find((run) => run.fileId === selectedFileId) ?? null)
    : null;
  const trainingLocked = hasTrainingRun(runs);
  const isEditorOpen = sidebarMode === "editor";
  const visibleActiveRun = isEditorOpen && activeRun?.status !== "training" ? activeRun : null;
  const visibleGenerationConfig = generationConfig;
  const activeRunTitle = isEditorOpen
    ? (selectedFile?.title ?? selectedFile?.name ?? activeRun?.name ?? "")
    : "";

  useEffect(() => {
    if (!selectedFileId) {
      setDraftName("");
      setDraftContent("");
      setSidebarMode("list");
      return;
    }

    setDraftName(selectedFileName);
    setDraftContent(selectedFileContent);
  }, [selectedFileContent, selectedFileId, selectedFileName]);

  useEffect(() => {
    if (!selectedFile || sidebarMode !== "editor" || draftContent === selectedFile.content) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void saveSelectedFileContent(draftContent);
    }, 350);
    return () => window.clearTimeout(timeoutId);
  }, [draftContent, saveSelectedFileContent, selectedFile, sidebarMode]);

  useEffect(() => {
    if (!selectedFile || sidebarMode !== "editor" || draftName.trim() === selectedFile.name) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void saveSelectedFileName(draftName);
    }, 350);
    return () => window.clearTimeout(timeoutId);
  }, [draftName, saveSelectedFileName, selectedFile, sidebarMode]);

  const displayedResults = visibleActiveRun
    ? (visibleActiveRun.generatedResults[formatTemperatureKey(generationConfig.temperature)] ?? [])
    : [];

  const persistDraftFile = useCallback(async () => {
    if (!selectedFile) {
      return null;
    }

    const file = {
      content: draftContent,
      id: selectedFile.id,
      name: draftName,
    };
    await Promise.all([saveSelectedFileContent(file.content), saveSelectedFileName(file.name)]);
    return file;
  }, [draftContent, draftName, saveSelectedFileContent, saveSelectedFileName, selectedFile]);

  const openImportPicker = useCallback(() => {
    const input = fileInputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!input) {
      return;
    }

    if (typeof input.showPicker === "function") {
      input.showPicker();
      return;
    }

    input.click();
  }, []);

  const handleOpenFile = useCallback(
    async (fileId: string) => {
      await selectFile(fileId);
      setSidebarMode("editor");
    },
    [selectFile],
  );

  const handleCloseEditor = useCallback(() => {
    setSidebarMode("list");
    setActiveTab("generated");
    setDraftName("");
    setDraftContent("");
    void selectFile(null);
  }, [selectFile, setActiveTab]);

  const handleDeleteSelectedFile = useCallback(async () => {
    if (!selectedFile) {
      return;
    }

    await removeFile(selectedFile.id);
  }, [removeFile, selectedFile]);

  async function handleCreateFile() {
    const created = await createFile(`custom-${files.length + 1}.txt`);
    await handleOpenFile(created.id);
  }

  async function handleStartTraining() {
    const file = await persistDraftFile();
    if (file) {
      await startTraining(file);
    }
  }

  async function handleImportedFiles(fileList: FileList | null) {
    if (!fileList?.length) {
      return;
    }

    const importedCount = await importFiles(fileList);
    if (importedCount > 0) {
      setSidebarMode("editor");
    }
  }

  async function handleResetLocalData() {
    await resetAll();
    setActiveTab("generated");
    setSidebarMode("list");
    setResetDialogOpen(false);
  }

  return (
    <TooltipProvider delay={200}>
      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <main className="min-h-screen bg-background text-foreground xl:h-screen xl:overflow-hidden">
          <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-5 sm:px-6 xl:h-full xl:min-h-0">
            <section className="grid min-h-0 flex-1 gap-6 lg:grid-cols-2 xl:overflow-hidden">
              <section className="overflow-hidden xl:min-h-0 xl:h-full">
                {sidebarMode === "list" ? (
                  <SidebarListView
                    files={files}
                    isHydrating={busyState.hydrating}
                    onCreateFile={handleCreateFile}
                    onResetLocalData={() => setResetDialogOpen(true)}
                    onImportClick={openImportPicker}
                    onOpenFile={(file) => handleOpenFile(file.id)}
                    runs={runs}
                  />
                ) : (
                  <SidebarEditorView
                    canTrain={Boolean(selectedFile && selectedFileSummary?.documents.length)}
                    draftContent={draftContent}
                    draftName={draftName}
                    generationConfig={generationConfig}
                    isTraining={trainingLocked}
                    onBack={handleCloseEditor}
                    onResetLocalData={() => setResetDialogOpen(true)}
                    onDeleteFile={
                      selectedFile?.source === "user" ? handleDeleteSelectedFile : undefined
                    }
                    onDeleteModel={
                      selectedFileRun
                        ? () => {
                            void removeRun(selectedFileRun.id);
                          }
                        : undefined
                    }
                    onDraftContentChange={setDraftContent}
                    onDraftNameChange={setDraftName}
                    onSaveContent={saveSelectedFileContent}
                    onDownloadModel={
                      selectedFileRun?.checkpoint
                        ? () => void downloadRunArtifact(selectedFileRun.id, "model")
                        : undefined
                    }
                    onGenerationConfigChange={setGenerationConfig}
                    onResumeTraining={
                      selectedFileRun?.checkpoint
                        ? () => void resumeRun(selectedFileRun.id)
                        : undefined
                    }
                    onStartTraining={handleStartTraining}
                    onTrainingConfigChange={setTrainingConfig}
                    selectedFile={selectedFile}
                    selectedFileSummary={selectedFileSummary}
                    selectedRun={selectedFileRun}
                    trainingConfig={trainingConfig}
                  />
                )}
              </section>

              <section className="overflow-hidden xl:min-h-0 xl:h-full">
                <RunPanel
                  activeRun={visibleActiveRun}
                  activeTab={activeTab}
                  displayTitle={activeRunTitle}
                  displayedResults={displayedResults}
                  generationConfig={visibleGenerationConfig}
                  isGenerating={busyState.generating}
                  isHydrating={busyState.hydrating}
                  onGenerate={() => generateForActiveRun(visibleGenerationConfig.temperature)}
                  onTabChange={setActiveTab}
                  onTemperatureChange={(temperature) =>
                    setGenerationConfig((current) =>
                      createGenerationConfig({
                        ...current,
                        temperature: Number(formatTemperatureKey(temperature)),
                      }),
                    )
                  }
                  onToggleLike={toggleLike}
                  repoUrl={REPO_URL}
                  workerReady={busyState.workerReady}
                />
              </section>
            </section>
          </div>
        </main>

        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,text/plain"
          multiple
          aria-hidden="true"
          tabIndex={-1}
          className="pointer-events-none absolute -left-full size-px opacity-0"
          onChange={(event) => {
            void handleImportedFiles(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />

        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset local data?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes every saved run, custom file, cached result, and local preference in this
              browser. The bundled datasets are restored automatically after the reset finishes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button variant="outline" disabled={busyState.resetting}>
                  Cancel
                </Button>
              }
            />
            <Button
              variant="destructive"
              onClick={() => {
                void handleResetLocalData();
              }}
              disabled={busyState.resetting}
            >
              {busyState.resetting ? "Resetting..." : "Reset local data"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </TooltipProvider>
  );
}
