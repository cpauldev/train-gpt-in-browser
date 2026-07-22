import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
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
  const [deleteModelDialogOpen, setDeleteModelDialogOpen] = useState(false);
  const [isDeletingModel, setIsDeletingModel] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedRun = runs.getByFileId(workspace.selectedFileId);
  const selectedFileName = workspace.selectedFile?.name ?? "";
  const selectedFileContent = workspace.selectedFile?.content ?? "";
  const isEditorOpen = sidebarMode === "editor";
  const isSelectedRunTraining = selectedRun ? isTrainingRunInProgress(selectedRun.status) : false;
  const resultsRun = selectedRun ?? runs.active;
  const activeRunTitle =
    workspace.selectedFile?.title ?? workspace.selectedFile?.name ?? resultsRun?.name ?? "";
  const titleRun =
    runs.active && isTrainingRunInProgress(runs.active.status)
      ? runs.active
      : (selectedRun ?? runs.active);
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
    if (!resultsRun) {
      return [];
    }

    return resultsRun.generatedResults[formatTemperatureKey(generation.config.temperature)] ?? [];
  }, [resultsRun, generation.config.temperature]);

  const pendingResultIndexes = useMemo(() => {
    if (!resultsRun) {
      return new Set<number>();
    }

    const temperatureKey = formatTemperatureKey(generation.config.temperature);
    const indexes = new Set<number>();
    displayedResults.forEach((_, index) => {
      if (generation.pendingSamples.has(`${resultsRun.id}:${temperatureKey}:${index}`)) {
        indexes.add(index);
      }
    });
    return indexes;
  }, [displayedResults, generation.config.temperature, generation.pendingSamples, resultsRun]);

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

  const handleCloseEditor = useCallback(() => {
    setSidebarMode("list");
    void workspace.selectFile(null);
  }, [workspace]);

  const handleOpenFile = useCallback(
    async (fileId: string) => {
      if (workspace.selectedFile?.id === fileId) {
        handleCloseEditor();
        return;
      }

      await workspace.selectFile(fileId);
      setSidebarMode("editor");
    },
    [workspace, handleCloseEditor],
  );

  const handleDeleteSelectedFile = useCallback(async () => {
    if (!workspace.selectedFile) {
      return;
    }

    await workspace.removeFile(workspace.selectedFile.id);
  }, [workspace]);

  const handleDeleteSelectedModel = useCallback(async () => {
    if (!selectedRun) {
      return;
    }

    setIsDeletingModel(true);
    try {
      await runs.remove(selectedRun.id);
      setDeleteModelDialogOpen(false);
    } finally {
      setIsDeletingModel(false);
    }
  }, [runs, selectedRun]);

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
      onDeleteFile:
        workspace.selectedFile?.source === "user" ? handleDeleteSelectedFile : undefined,
      onDeleteModel: selectedRun ? () => setDeleteModelDialogOpen(true) : undefined,
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
    deleteModelDialogOpen,
    isEditorOpen,
    isDeletingModel,
    listViewProps: {
      files: workspace.files,
      isHydrating: busyState.hydrating,
      isImporting: busyState.importing,
      onCreateFile: handleCreateFile,
      onImportClick: openImportPicker,
      onOpenFile: (file: { id: string }) => handleOpenFile(file.id),
      onResetLocalData: () => setResetDialogOpen(true),
      runs: runs.all,
      selectedFileId: workspace.selectedFile?.id,
    },
    resetDialogOpen,
    setDeleteModelDialogOpen,
    resultsPanelProps: {
      activeRun: resultsRun,
      activeTab: generation.activeTab,
      displayTitle: activeRunTitle,
      displayedResults,
      generationProgress: generation.progress,
      generationConfig: generation.config,
      isGenerating: busyState.generating,
      isHydrating: busyState.hydrating,
      onGenerate: () => {
        if (resultsRun) {
          void generation.generateForRun(resultsRun.id, generation.config.temperature);
        } else {
          void generation.generateForActiveRun(generation.config.temperature);
        }
      },
      onResetLocalData: () => setResetDialogOpen(true),
      onTabChange: generation.setActiveTab,
      onTemperatureChange: (temperature: number) =>
        generation.setConfig((current) =>
          createGenerationConfig({
            ...current,
            temperature: Number(formatTemperatureKey(temperature)),
          }),
        ),
      onToggleLike: (value: string) => {
        if (resultsRun) {
          void generation.toggleLikeForRun(resultsRun.id, value);
        } else {
          void generation.toggleLike(value);
        }
      },
      pendingResultIndexes,
      workerReady: busyState.workerReady,
    },
    setResetDialogOpen,
    handleDeleteSelectedModel,
    handleResetLocalData,
    titleRun,
  };
}
