import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { preloadCodeEditorSurface } from "@/components/sidebar-editor-view";
import { formatTemperatureKey } from "@/lib/trainer-core";
import {
  canResumeTrainingRun,
  createGenerationConfig,
  isTrainingRunInProgress,
} from "@/lib/trainer-types";
import type { BrowserTrainerController } from "@/lib/use-browser-trainer";

type SidebarMode = "editor" | "list";

export function useWorkspaceEditor(trainer: BrowserTrainerController) {
  const { busyState, generation, maintenance, runs, training, workspace } = trainer;
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("list");
  const [draftName, setDraftName] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedRun = runs.getByFileId(workspace.selectedFileId);
  const selectedFileName = workspace.selectedFile?.name ?? "";
  const selectedFileContent = workspace.selectedFile?.content ?? "";
  const isEditorOpen = sidebarMode === "editor";
  const isSelectedRunTraining = selectedRun ? isTrainingRunInProgress(selectedRun.status) : false;
  const completedActiveRun =
    isEditorOpen && runs.active?.status === "completed" ? runs.active : null;
  const activeRunTitle =
    workspace.selectedFile?.title ?? workspace.selectedFile?.name ?? completedActiveRun?.name ?? "";
  const canResumeSelectedRun =
    selectedRun && canResumeTrainingRun(selectedRun, training.config.steps);

  const persistDraftContent = useEffectEvent((value: string) => {
    void workspace.saveSelectedFileContent(value);
  });
  const persistDraftName = useEffectEvent((value: string) => {
    void workspace.saveSelectedFileName(value);
  });

  useEffect(() => {
    if (!workspace.selectedFileId) {
      setDraftName("");
      setDraftContent("");
      setSidebarMode("list");
      return;
    }

    setDraftName(selectedFileName);
    setDraftContent(selectedFileContent);
  }, [selectedFileContent, selectedFileName, workspace.selectedFileId]);

  useEffect(() => {
    if (workspace.files.length === 0) {
      return;
    }

    void preloadCodeEditorSurface();
  }, [workspace.files.length]);

  useEffect(() => {
    if (
      !workspace.selectedFile ||
      sidebarMode !== "editor" ||
      draftContent === workspace.selectedFile.content
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      persistDraftContent(draftContent);
    }, 350);
    return () => window.clearTimeout(timeoutId);
  }, [draftContent, sidebarMode, workspace.selectedFile]);

  useEffect(() => {
    if (
      !workspace.selectedFile ||
      sidebarMode !== "editor" ||
      draftName.trim() === workspace.selectedFile.name
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      persistDraftName(draftName);
    }, 350);
    return () => window.clearTimeout(timeoutId);
  }, [draftName, sidebarMode, workspace.selectedFile]);

  const displayedResults = useMemo(() => {
    if (!completedActiveRun) {
      return [];
    }

    return (
      completedActiveRun.generatedResults[formatTemperatureKey(generation.config.temperature)] ?? []
    );
  }, [completedActiveRun, generation.config.temperature]);

  const persistDraftFile = useCallback(async () => {
    if (!workspace.selectedFile) {
      return null;
    }

    const file = {
      content: draftContent,
      id: workspace.selectedFile.id,
      name: draftName,
    };
    await Promise.all([
      workspace.saveSelectedFileContent(file.content),
      workspace.saveSelectedFileName(file.name),
    ]);
    return file;
  }, [draftContent, draftName, workspace]);

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
      await workspace.selectFile(fileId);
      setSidebarMode("editor");
    },
    [workspace],
  );

  const handleCloseEditor = useCallback(() => {
    setSidebarMode("list");
    generation.setActiveTab("generated");
    setDraftName("");
    setDraftContent("");
    void workspace.selectFile(null);
  }, [generation, workspace]);

  const handleDeleteSelectedFile = useCallback(async () => {
    if (!workspace.selectedFile) {
      return;
    }

    await workspace.removeFile(workspace.selectedFile.id);
  }, [workspace]);

  const handleCreateFile = useCallback(async () => {
    const created = await workspace.createFile(`custom-${workspace.files.length + 1}.txt`);
    await handleOpenFile(created.id);
  }, [handleOpenFile, workspace]);

  const handleStartTraining = useCallback(async () => {
    const file = await persistDraftFile();
    if (file) {
      await runs.start(file);
    }
  }, [persistDraftFile, runs]);
  const handleImportedFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList?.length) {
        return;
      }

      const importedCount = await workspace.importFiles(fileList);
      if (importedCount > 0) {
        setSidebarMode("editor");
      }
    },
    [workspace],
  );

  const handleResetLocalData = useCallback(async () => {
    await maintenance.resetAll();
    generation.setActiveTab("generated");
    setSidebarMode("list");
    setResetDialogOpen(false);
  }, [generation, maintenance]);

  return {
    editorViewProps: {
      canTrain: Boolean(workspace.selectedFile && workspace.selectedFileSummary?.documentCount),
      draftContent,
      draftName,
      generationConfig: generation.config,
      isTraining: isSelectedRunTraining,
      onBack: handleCloseEditor,
      onResetLocalData: () => setResetDialogOpen(true),
      onDeleteFile:
        workspace.selectedFile?.source === "user" ? handleDeleteSelectedFile : undefined,
      onDeleteModel: selectedRun
        ? () => {
            void runs.remove(selectedRun.id);
          }
        : undefined,
      onDraftContentChange: setDraftContent,
      onDraftNameChange: setDraftName,
      onDownloadModel:
        selectedRun && (selectedRun.checkpoint || selectedRun.checkpointSavedAt)
          ? () => void runs.downloadArtifact(selectedRun.id, "model")
          : undefined,
      onGenerationConfigChange: generation.setConfig,
      onResumeTraining: canResumeSelectedRun ? () => void runs.resume(selectedRun.id) : undefined,
      onSaveContent: workspace.saveSelectedFileContent,
      onStartTraining: handleStartTraining,
      onTrainingConfigChange: training.setConfig,
      selectedFile: workspace.selectedFile,
      selectedFileSummary: workspace.selectedFileSummary,
      selectedRun,
      trainingConfig: training.config,
    },
    fileInputRef,
    handleImportedFiles,
    isEditorOpen,
    listViewProps: {
      files: workspace.files,
      isHydrating: busyState.hydrating,
      isImporting: busyState.importing,
      onCreateFile: handleCreateFile,
      onImportClick: openImportPicker,
      onOpenFile: (file: { id: string }) => handleOpenFile(file.id),
      onResetLocalData: () => setResetDialogOpen(true),
      runs: runs.all,
    },
    resetDialogOpen,
    runPanelProps: {
      activeRun: completedActiveRun,
      activeTab: generation.activeTab,
      displayTitle: activeRunTitle,
      displayedResults,
      generationConfig: generation.config,
      isGenerating: busyState.generating,
      isHydrating: busyState.hydrating,
      onGenerate: () => generation.generateForActiveRun(generation.config.temperature),
      onTabChange: generation.setActiveTab,
      onTemperatureChange: (temperature: number) =>
        generation.setConfig((current) =>
          createGenerationConfig({
            ...current,
            temperature: Number(formatTemperatureKey(temperature)),
          }),
        ),
      onToggleLike: generation.toggleLike,
      workerReady: busyState.workerReady,
    },
    setResetDialogOpen,
    handleResetLocalData,
  };
}
