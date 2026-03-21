import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toastManager } from "@/components/ui/toast";
import {
  appendLogs,
  dedupeRunsByFileId,
  mergeRunIntoCollection,
  reconcileInterruptedRuns,
  replaceGeneratedResultsForTemperature,
  resolveRestoredSelection,
} from "@/lib/browser-trainer-state";
import {
  clampTemperature,
  createId,
  createLogEntry,
  getRunName,
  summarizeDatasetText,
} from "@/lib/trainer-core";
import { DEFAULT_GENERATION_CONFIG, DEFAULT_TRAINING_CONFIG } from "@/lib/trainer-defaults";
import { downloadModelFile } from "@/lib/trainer-export";
import { formatDurationSeconds } from "@/lib/trainer-presentation";
import {
  createWorkspaceFile,
  deleteTrainingRun,
  deleteWorkspaceFile,
  getActiveFileId,
  getActiveRunId,
  getTrainingRun,
  getTrainingRunArtifact,
  listTrainingRuns,
  listWorkspaceFiles,
  renameWorkspaceFile,
  resetTrainerStorage,
  saveTrainingRun,
  saveTrainingRunArtifacts,
  seedBuiltinWorkspaceFiles,
  setActiveFileId,
  setActiveRunId,
  updateWorkspaceFileContent,
  upsertImportedWorkspaceFile,
} from "@/lib/trainer-storage";
import {
  canResumeTrainingRun,
  createGenerationConfig,
  type DatasetTextSummary,
  type GenerationConfig,
  hasTrainingRun,
  isTrainingRunInProgress,
  type RunArtifactKind,
  type RunPanelTab,
  resolveTrainingRunResumeTargetSteps,
  type TrainerCommand,
  type TrainerEvent,
  type TrainingConfig,
  type TrainingRunRecord,
  type WorkspaceFile,
} from "@/lib/trainer-types";
import { waitForServiceWorkerReady } from "@/lib/service-worker";
import {
  appendTrainingTelemetryPoint,
  getLatestTrainingTelemetryElapsedSeconds,
  shouldPersistTrainingTelemetry,
} from "@/lib/training-telemetry";
import {
  partitionWorkspaceImportFiles,
  summarizeRejectedWorkspaceImports,
} from "@/lib/workspace-imports";

type BrowserTrainerBusyState = {
  downloading: boolean;
  generating: boolean;
  hydrating: boolean;
  importing: boolean;
  resetting: boolean;
  workerReady: boolean;
};

const INITIAL_BUSY_STATE: BrowserTrainerBusyState = {
  downloading: false,
  generating: false,
  hydrating: true,
  importing: false,
  resetting: false,
  workerReady: false,
};

export function useBrowserTrainer() {
  const previewWorkerRef = useRef<Worker | null>(null);
  const trainingWorkersRef = useRef<
    Map<string, { onMessage: (event: MessageEvent<TrainerEvent>) => void; worker: Worker }>
  >(new Map());
  const runsRef = useRef<TrainingRunRecord[]>([]);
  const selectedFileIdRef = useRef<string | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const importInFlightRef = useRef(false);
  const offlineRuntimeWarmedRef = useRef(false);
  const fileSummaryCacheRef = useRef<
    Map<string, { summary: DatasetTextSummary; updatedAt: number }>
  >(new Map());
  const telemetryPersistedAtRef = useRef<Map<string, number>>(new Map());

  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [runs, setRuns] = useState<TrainingRunRecord[]>([]);
  const [selectedFileId, setSelectedFileIdState] = useState<string | null>(null);
  const [activeRunId, setActiveRunIdState] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<RunPanelTab>("generated");
  const [trainingConfig, setTrainingConfig] = useState<TrainingConfig>(DEFAULT_TRAINING_CONFIG);
  const [generationConfig, setGenerationConfig] =
    useState<GenerationConfig>(DEFAULT_GENERATION_CONFIG);
  const [busyState, setBusyState] = useState<BrowserTrainerBusyState>(INITIAL_BUSY_STATE);

  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);

  useEffect(() => {
    selectedFileIdRef.current = selectedFileId;
  }, [selectedFileId]);

  useEffect(() => {
    activeRunIdRef.current = activeRunId;
  }, [activeRunId]);

  const commitFiles = useCallback((nextFiles: WorkspaceFile[]) => {
    startTransition(() => {
      setFiles(nextFiles);
    });
  }, []);

  const commitRuns = useCallback((nextRuns: TrainingRunRecord[]) => {
    runsRef.current = nextRuns;
    startTransition(() => {
      setRuns(nextRuns);
    });
  }, []);

  const persistSelectedFileId = useCallback((nextFileId: string | null) => {
    setSelectedFileIdState(nextFileId);
    void setActiveFileId(nextFileId);
  }, []);

  const persistActiveRunId = useCallback((nextRunId: string | null) => {
    setActiveRunIdState(nextRunId);
    void setActiveRunId(nextRunId);
  }, []);

  const selectedFile = useMemo(
    () => files.find((file) => file.id === selectedFileId) ?? null,
    [files, selectedFileId],
  );
  const activeRun = useMemo(
    () => runs.find((run) => run.id === activeRunId) ?? null,
    [activeRunId, runs],
  );
  const getDatasetSummary = useCallback((file: WorkspaceFile) => {
    const cachedSummary = fileSummaryCacheRef.current.get(file.id);

    if (cachedSummary && cachedSummary.updatedAt === file.updatedAt) {
      return cachedSummary.summary;
    }

    const summary = summarizeDatasetText(file.content);
    fileSummaryCacheRef.current.set(file.id, {
      summary,
      updatedAt: file.updatedAt,
    });
    return summary;
  }, []);
  const selectedFileSummary = useMemo<DatasetTextSummary | null>(() => {
    if (!selectedFile) {
      return null;
    }

    return getDatasetSummary(selectedFile);
  }, [getDatasetSummary, selectedFile]);

  useEffect(() => {
    if (files.length === 0) {
      fileSummaryCacheRef.current.clear();
      return;
    }

    const activeFileIds = new Set(files.map((file) => file.id));
    for (const fileId of fileSummaryCacheRef.current.keys()) {
      if (!activeFileIds.has(fileId)) {
        fileSummaryCacheRef.current.delete(fileId);
      }
    }
  }, [files]);

  const sendPreviewCommand = useCallback((command: TrainerCommand) => {
    previewWorkerRef.current?.postMessage(command);
  }, []);

  const getRunForFile = useCallback(
    (fileId: string | null, availableRuns = runsRef.current) =>
      fileId ? (availableRuns.find((run) => run.fileId === fileId) ?? null) : null,
    [],
  );

  const loadRunIntoWorker = useCallback(
    (run: TrainingRunRecord | null) => {
      if (!run?.checkpoint) {
        return;
      }

      sendPreviewCommand({
        checkpoint: run.checkpoint,
        runId: run.id,
        type: "loadRun",
      });
    },
    [sendPreviewCommand],
  );

  const clearSelection = useCallback(() => {
    persistSelectedFileId(null);
    persistActiveRunId(null);
  }, [persistActiveRunId, persistSelectedFileId]);

  const activateRun = useCallback(
    async (runId: string | null, availableRuns = runsRef.current) => {
      persistActiveRunId(runId);

      const run = availableRuns.find((item) => item.id === runId) ?? null;
      if (!run) {
        return null;
      }

      persistSelectedFileId(run.fileId);
      setTrainingConfig(run.trainingConfig);
      loadRunIntoWorker(run);
      return run;
    },
    [loadRunIntoWorker, persistActiveRunId, persistSelectedFileId],
  );

  const selectFileAndRun = useCallback(
    async (fileId: string | null, availableRuns = runsRef.current) => {
      if (!fileId) {
        clearSelection();
        return null;
      }

      persistSelectedFileId(fileId);

      const run = getRunForFile(fileId, availableRuns);
      if (!run) {
        persistActiveRunId(null);
        return null;
      }

      await activateRun(run.id, availableRuns);
      return run;
    },
    [activateRun, clearSelection, getRunForFile, persistActiveRunId, persistSelectedFileId],
  );

  const hydrate = useCallback(
    async (options?: { suppressErrorToast?: boolean }) => {
      setBusyState((current) => ({ ...current, hydrating: true }));
      telemetryPersistedAtRef.current.clear();
      try {
        await seedBuiltinWorkspaceFiles();

        const [nextFiles, persistedRuns, persistedActiveFileId, persistedActiveRunId] =
          await Promise.all([
            listWorkspaceFiles(),
            listTrainingRuns(),
            getActiveFileId(),
            getActiveRunId(),
          ]);

        const {
          interruptedRunCount,
          nextRuns: reconciledRuns,
          updatedRuns,
        } = reconcileInterruptedRuns(persistedRuns);
        if (updatedRuns.length > 0) {
          await Promise.all(updatedRuns.map((run) => saveTrainingRun(run)));
        }

        const { duplicateRunIds, nextRuns } = dedupeRunsByFileId(reconciledRuns);
        if (duplicateRunIds.length > 0) {
          await Promise.all(duplicateRunIds.map((runId) => deleteTrainingRun(runId)));
        }

        const restoredSelection = resolveRestoredSelection({
          activeFileId: persistedActiveFileId,
          activeRunId: persistedActiveRunId,
          files: nextFiles,
          runs: nextRuns,
        });

        commitFiles(nextFiles);
        commitRuns(nextRuns);
        setGenerationConfig(DEFAULT_GENERATION_CONFIG);
        setTrainingConfig(DEFAULT_TRAINING_CONFIG);

        persistSelectedFileId(restoredSelection.selectedFileId);
        persistActiveRunId(restoredSelection.activeRunId);

        const restoredRun =
          nextRuns.find((run) => run.id === restoredSelection.activeRunId) ?? null;
        if (restoredRun) {
          setTrainingConfig(restoredRun.trainingConfig);
          loadRunIntoWorker(restoredRun);
        }

        if (interruptedRunCount > 0) {
          toastManager.add({
            description:
              interruptedRunCount === 1
                ? "You can resume from your latest checkpoint."
                : "You can resume any run from its latest checkpoint.",
            title:
              interruptedRunCount === 1 ? "Run restored" : `${interruptedRunCount} runs restored`,
            type: "warning",
          });
        }
      } catch (error) {
        if (!options?.suppressErrorToast) {
          toastManager.add({
            description:
              error instanceof Error ? error.message : "The browser data couldn't be loaded.",
            title: "Failed to load local data",
            type: "error",
          });
        }
        throw error;
      } finally {
        setBusyState((current) => ({ ...current, hydrating: false }));
      }
    },
    [commitFiles, commitRuns, loadRunIntoWorker, persistActiveRunId, persistSelectedFileId],
  );

  const replaceRun = useCallback(
    async (
      nextRun: TrainingRunRecord,
      options?: {
        persist?: boolean;
        persistCheckpoint?: boolean;
      },
    ) => {
      const { duplicateRuns, nextRuns } = mergeRunIntoCollection(runsRef.current, nextRun);

      if (duplicateRuns.length > 0) {
        await Promise.all(duplicateRuns.map((run) => deleteTrainingRun(run.id)));
      }

      commitRuns(nextRuns);

      if (options?.persist !== false) {
        await saveTrainingRun(nextRun, {
          persistCheckpoint: options?.persistCheckpoint,
        });
      }
    },
    [commitRuns],
  );

  const cacheRunExport = useCallback(
    async (run: TrainingRunRecord, artifactSet: Parameters<typeof saveTrainingRunArtifacts>[1]) => {
      const persistedRun = await saveTrainingRunArtifacts(run, artifactSet);
      await replaceRun(persistedRun, { persist: false });
      return persistedRun;
    },
    [replaceRun],
  );

  const loadLatestRunCheckpoint = useCallback(
    async (run: TrainingRunRecord | null) => {
      if (!run) {
        return null;
      }

      const persistedRun = await getTrainingRun(run.id);
      if (!persistedRun?.checkpoint) {
        return run.checkpoint ? run : null;
      }

      const hydratedRun: TrainingRunRecord = {
        ...run,
        checkpoint: persistedRun.checkpoint,
        checkpointSavedAt: persistedRun.checkpointSavedAt ?? persistedRun.checkpoint.exportedAt,
        datasetStats: persistedRun.datasetStats,
      };

      await replaceRun(hydratedRun, { persist: false });
      return hydratedRun;
    },
    [replaceRun],
  );

  const ensureRunCheckpointLoaded = useCallback(
    async (runId: string) => {
      const run = runsRef.current.find((item) => item.id === runId) ?? null;
      if (!run) {
        return null;
      }

      return loadLatestRunCheckpoint(run);
    },
    [loadLatestRunCheckpoint],
  );

  const handleWorkerEvent = useCallback(
    async (event: TrainerEvent) => {
      switch (event.type) {
        case "ready": {
          setBusyState((current) => ({ ...current, workerReady: true }));
          return;
        }

        case "trainingStarted": {
          const run = runsRef.current.find((item) => item.id === event.runId);
          if (!run) {
            return;
          }

          const logs = appendLogs(run.logs, [event.logEntry]);
          if (run.trainingConfig.requestedBackend !== "cpu" && event.resolvedBackend === "cpu") {
            logs.push(
              createLogEntry(
                "WebGPU is unavailable in this browser, so training is using the CPU fallback.",
                "error",
              ),
            );
            toastManager.add({
              description: "WebGPU isn't supported in this browser. Training may be slower.",
              title: "Running on CPU",
              type: "warning",
            });
          }

          await replaceRun(
            {
              ...run,
              logs,
              status: "starting",
              updatedAt: Date.now(),
            },
            { persist: false },
          );
          return;
        }

        case "log": {
          const run = runsRef.current.find((item) => item.id === event.runId);
          if (!run) {
            return;
          }

          await replaceRun(
            {
              ...run,
              logs: appendLogs(run.logs, [event.logEntry]),
              updatedAt: Date.now(),
            },
            { persist: false },
          );
          return;
        }

        case "trainingProgress": {
          const run = runsRef.current.find((item) => item.id === event.runId);
          if (!run) {
            return;
          }

          await replaceRun(
            {
              ...run,
              logs: appendLogs(run.logs, [event.logEntry]),
              updatedAt: Date.now(),
            },
            { persist: false },
          );
          return;
        }

        case "trainingTelemetry": {
          const run = runsRef.current.find((item) => item.id === event.runId);
          if (!run) {
            return;
          }

          const nextTelemetry = appendTrainingTelemetryPoint(run.telemetry, event.point);
          const updatedAt = Math.max(Date.now(), Math.round(event.point.time * 1000));
          const nextRun: TrainingRunRecord = {
            ...run,
            status: "training",
            telemetry: nextTelemetry,
            updatedAt,
          };
          const lastPersistedAt = telemetryPersistedAtRef.current.get(event.runId);
          const shouldPersistTelemetry = shouldPersistTrainingTelemetry(
            lastPersistedAt,
            event.point,
          );

          await replaceRun(
            nextRun,
            shouldPersistTelemetry ? { persistCheckpoint: false } : { persist: false },
          );
          if (shouldPersistTelemetry) {
            telemetryPersistedAtRef.current.set(event.runId, updatedAt);
          }
          return;
        }

        case "trainingCheckpoint": {
          const run = runsRef.current.find((item) => item.id === event.runId);
          if (!run) {
            return;
          }

          await replaceRun(
            {
              ...run,
              checkpointSavedAt: event.checkpointSavedAt,
              datasetStats: event.datasetStats,
              updatedAt: event.checkpointSavedAt,
            },
            { persistCheckpoint: false },
          );
          telemetryPersistedAtRef.current.set(event.runId, event.checkpointSavedAt);
          return;
        }

        case "trainingCompleted": {
          const run = runsRef.current.find((item) => item.id === event.runId);
          if (!run) {
            return;
          }

          const nextRun: TrainingRunRecord = {
            ...run,
            checkpoint: undefined,
            checkpointSavedAt: event.checkpointSavedAt,
            datasetStats: event.datasetStats,
            generatedResults: replaceGeneratedResultsForTemperature(
              run.generatedResults,
              event.temperatureKey,
              event.generatedResults,
            ),
            status: "completed",
            updatedAt: event.checkpointSavedAt,
          };

          await replaceRun(nextRun, { persistCheckpoint: false });
          telemetryPersistedAtRef.current.delete(event.runId);
          if (
            activeRunIdRef.current === event.runId ||
            selectedFileIdRef.current === nextRun.fileId
          ) {
            setActiveTab("generated");
          }
          toastManager.add({
            description: `Your model is ready. Completed in ${formatDurationSeconds(event.elapsedSeconds)}.`,
            title: "Training complete",
            type: "success",
          });
          return;
        }

        case "generationCompleted": {
          setBusyState((current) => ({ ...current, generating: false }));

          const run = runsRef.current.find((item) => item.id === event.runId);
          if (!run) {
            return;
          }

          await replaceRun(
            {
              ...run,
              generatedResults: replaceGeneratedResultsForTemperature(
                run.generatedResults,
                event.temperatureKey,
                event.generatedResults,
              ),
              logs: appendLogs(run.logs, [event.logEntry]),
              updatedAt: Date.now(),
            },
            { persistCheckpoint: false },
          );
          setActiveTab("generated");
          return;
        }

        case "error": {
          setBusyState((current) => ({ ...current, downloading: false, generating: false }));
          toastManager.add({
            description: event.message,
            title: "Training error",
            type: "error",
          });

          if (!event.runId) {
            return;
          }

          const run = runsRef.current.find((item) => item.id === event.runId);
          if (!run) {
            return;
          }

          await replaceRun(
            {
              ...run,
              lastError: event.message,
              logs: appendLogs(run.logs, [createLogEntry(event.message, "error")]),
              status: "error",
              updatedAt: Date.now(),
            },
            { persistCheckpoint: false },
          );
          return;
        }

        case "resetComplete": {
          return;
        }

        default: {
          const exhaustive: never = event;
          throw new Error(`Unhandled worker event: ${JSON.stringify(exhaustive)}`);
        }
      }
    },
    [replaceRun],
  );

  const terminateTrainingWorker = useCallback((runId: string) => {
    const workerEntry = trainingWorkersRef.current.get(runId);
    if (!workerEntry) {
      return;
    }

    workerEntry.worker.removeEventListener("message", workerEntry.onMessage);
    workerEntry.worker.terminate();
    trainingWorkersRef.current.delete(runId);
  }, []);

  const terminateAllTrainingWorkers = useCallback(() => {
    for (const runId of [...trainingWorkersRef.current.keys()]) {
      terminateTrainingWorker(runId);
    }
  }, [terminateTrainingWorker]);

  const spawnTrainingWorker = useCallback(
    (runId: string) => {
      terminateTrainingWorker(runId);

      const worker = new Worker(new URL("../workers/trainer-worker.ts", import.meta.url), {
        type: "module",
      });
      const onMessage = (event: MessageEvent<TrainerEvent>) => {
        const nextEvent = event.data;
        void handleWorkerEvent(nextEvent).finally(() => {
          if (
            nextEvent.type === "trainingCompleted" ||
            nextEvent.type === "error"
          ) {
            terminateTrainingWorker(runId);
          }
        });
      };

      worker.addEventListener("message", onMessage);
      trainingWorkersRef.current.set(runId, { onMessage, worker });
      return worker;
    },
    [handleWorkerEvent, terminateTrainingWorker],
  );

  useEffect(() => {
    const worker = new Worker(new URL("../workers/trainer-worker.ts", import.meta.url), {
      type: "module",
    });
    previewWorkerRef.current = worker;

    const onMessage = (event: MessageEvent<TrainerEvent>) => {
      void handleWorkerEvent(event.data);
    };

    worker.addEventListener("message", onMessage);
    void hydrate().catch(() => {});

    return () => {
      worker.removeEventListener("message", onMessage);
      worker.terminate();
      previewWorkerRef.current = null;
      terminateAllTrainingWorkers();
    };
  }, [handleWorkerEvent, hydrate, terminateAllTrainingWorkers]);

  useEffect(() => {
    if (!busyState.workerReady || offlineRuntimeWarmedRef.current) {
      return;
    }

    offlineRuntimeWarmedRef.current = true;

    void waitForServiceWorkerReady().then((registration) => {
      if (!registration || !previewWorkerRef.current) {
        return;
      }

      previewWorkerRef.current.postMessage({ type: "warmRuntime" });
    });
  }, [busyState.workerReady]);

  const createFile = useCallback(
    async (name: string) => {
      const file = await createWorkspaceFile(name, "");
      commitFiles(await listWorkspaceFiles());
      return file;
    },
    [commitFiles],
  );

  const importFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const filesToImport = Array.from(fileList);
      if (filesToImport.length === 0 || importInFlightRef.current) {
        return 0;
      }

      const { accepted, rejected } = partitionWorkspaceImportFiles(filesToImport);
      const rejectedDescription = summarizeRejectedWorkspaceImports(rejected);

      if (rejectedDescription) {
        toastManager.add({
          description: rejectedDescription,
          title: accepted.length > 0 ? "Some files skipped" : "No files imported",
          type: "warning",
        });
      }

      if (accepted.length === 0) {
        return 0;
      }

      importInFlightRef.current = true;
      setBusyState((current) => ({ ...current, importing: true }));

      try {
        const importedFiles = await Promise.all(
          accepted.map(async (file) => {
            const content = await file.text();
            return upsertImportedWorkspaceFile(file.name, content);
          }),
        );
        const lastImportedId = importedFiles.at(-1)?.id ?? null;

        commitFiles(await listWorkspaceFiles());
        await selectFileAndRun(lastImportedId);
        return accepted.length;
      } catch (error) {
        toastManager.add({
          description:
            error instanceof Error ? error.message : "The selected files couldn't be imported.",
          title: "Import failed",
          type: "error",
        });
        return 0;
      } finally {
        importInFlightRef.current = false;
        setBusyState((current) => ({ ...current, importing: false }));
      }
    },
    [commitFiles, selectFileAndRun],
  );

  const selectFile = useCallback(
    async (fileId: string | null) => {
      await selectFileAndRun(fileId);
    },
    [selectFileAndRun],
  );

  const saveSelectedFileContent = useCallback(
    async (content: string) => {
      if (!selectedFileId) {
        return;
      }

      const updatedFile = await updateWorkspaceFileContent(selectedFileId, content);
      setFiles((current) =>
        current.map((file) => (file.id === updatedFile.id ? updatedFile : file)),
      );
    },
    [selectedFileId],
  );

  const saveSelectedFileName = useCallback(
    async (name: string) => {
      if (!selectedFileId) {
        return;
      }

      const updatedFile = await renameWorkspaceFile(selectedFileId, name);
      setFiles((current) =>
        current.map((file) => (file.id === updatedFile.id ? updatedFile : file)),
      );
    },
    [selectedFileId],
  );

  const removeFile = useCallback(
    async (fileId: string) => {
      const relatedRunIds = runsRef.current
        .filter((run) => run.fileId === fileId)
        .map((run) => run.id);

      if (selectedFileId === fileId) {
        clearSelection();
      } else if (activeRunId && relatedRunIds.includes(activeRunId)) {
        persistActiveRunId(null);
      }

      await Promise.all(
        relatedRunIds.map(async (runId) => {
          terminateTrainingWorker(runId);
          sendPreviewCommand({
            runId,
            type: "deleteRun",
          });
          await deleteTrainingRun(runId);
        }),
      );
      await deleteWorkspaceFile(fileId);

      const [nextFiles, nextRuns] = await Promise.all([listWorkspaceFiles(), listTrainingRuns()]);
      commitFiles(nextFiles);
      commitRuns(nextRuns);
    },
    [
      activeRunId,
      clearSelection,
      commitFiles,
      commitRuns,
      persistActiveRunId,
      selectedFileId,
      sendPreviewCommand,
      terminateTrainingWorker,
    ],
  );

  const startTraining = useCallback(
    async (fileOverride?: Pick<WorkspaceFile, "content" | "id" | "name">) => {
      const fileToTrain = fileOverride ?? selectedFile;
      if (!fileToTrain) {
        return;
      }

      const existingRun = runsRef.current.find((item) => item.fileId === fileToTrain.id) ?? null;
      if (existingRun) {
        terminateTrainingWorker(existingRun.id);
        sendPreviewCommand({
          runId: existingRun.id,
          type: "deleteRun",
        });
        await deleteTrainingRun(existingRun.id);
        commitRuns(runsRef.current.filter((item) => item.id !== existingRun.id));
      }

      const summary = summarizeDatasetText(fileToTrain.content);
      const now = Date.now();
      const runId = createId("run");
      const run: TrainingRunRecord = {
        createdAt: now,
        datasetStats: {
          characterCount: summary.characterCount,
          documentCount: summary.documentCount,
          lineCount: summary.lineCount,
          tokenCount: summary.tokenCount,
          vocabSize: summary.vocabSize,
        },
        fileId: fileToTrain.id,
        fileName: fileToTrain.name,
        generatedResults: {},
        id: runId,
        likes: [],
        logs: [],
        name: getRunName(fileToTrain),
        status: "starting",
        telemetry: [],
        trainingConfig: {
          ...trainingConfig,
          model: {
            ...trainingConfig.model,
            vocabSize: summary.vocabSize,
          },
        },
        updatedAt: now,
      };

      await replaceRun(run);
      persistSelectedFileId(fileToTrain.id);
      persistActiveRunId(runId);
      setActiveTab("generated");

      spawnTrainingWorker(runId).postMessage({
        file: {
          content: fileToTrain.content,
          id: fileToTrain.id,
          name: fileToTrain.name,
        },
        generationConfig: createGenerationConfig({
          ...generationConfig,
          requestedBlockSize: run.trainingConfig.model.blockSize,
        }),
        runId,
        trainingConfig: run.trainingConfig,
        type: "startTraining",
      });
    },
    [
      commitRuns,
      generationConfig,
      persistActiveRunId,
      persistSelectedFileId,
      replaceRun,
      selectedFile,
      sendPreviewCommand,
      spawnTrainingWorker,
      terminateTrainingWorker,
      trainingConfig,
    ],
  );

  const resumeRun = useCallback(
    async (runId: string) => {
      const run = runsRef.current.find((item) => item.id === runId);
      if (!run || isTrainingRunInProgress(run.status)) {
        return;
      }

      const checkpointedRun = await loadLatestRunCheckpoint(run);
      if (!checkpointedRun?.checkpoint) {
        return;
      }

      const nextTrainingConfig: TrainingConfig = {
        ...trainingConfig,
        steps: resolveTrainingRunResumeTargetSteps(checkpointedRun, trainingConfig.steps),
        model: checkpointedRun.checkpoint.modelConfig,
      };
      const checkpoint = {
        ...checkpointedRun.checkpoint,
        resumeState: {
          ...checkpointedRun.checkpoint.resumeState,
          elapsedTrainingSeconds: Math.max(
            checkpointedRun.checkpoint.resumeState.elapsedTrainingSeconds ?? 0,
            getLatestTrainingTelemetryElapsedSeconds(checkpointedRun.telemetry),
          ),
        },
      };

      if (!canResumeTrainingRun(checkpointedRun, nextTrainingConfig.steps)) {
        toastManager.add({
          description: "This run does not have a resumable checkpoint.",
          title: "Resume unavailable",
          type: "warning",
        });
        return;
      }

      await replaceRun({
        ...checkpointedRun,
        checkpoint: undefined,
        checkpointSavedAt:
          checkpointedRun.checkpointSavedAt ?? checkpointedRun.checkpoint.exportedAt,
        status: "starting",
        trainingConfig: nextTrainingConfig,
        updatedAt: Date.now(),
      });
      persistSelectedFileId(run.fileId);
      persistActiveRunId(runId);
      setActiveTab("generated");

      spawnTrainingWorker(runId).postMessage({
        checkpoint,
        file: {
          content: "",
          id: checkpointedRun.fileId,
          name: checkpointedRun.fileName,
        },
        generationConfig: {
          ...generationConfig,
          requestedBlockSize: checkpoint.tokenizer.blockSize,
        },
        runId,
        trainingConfig: nextTrainingConfig,
        type: "resumeTraining",
      });
    },
    [
      trainingConfig,
      generationConfig,
      loadLatestRunCheckpoint,
      persistActiveRunId,
      persistSelectedFileId,
      replaceRun,
      spawnTrainingWorker,
    ],
  );

  const generateForActiveRun = useCallback(
    async (temperature: number) => {
      if (
        !activeRun ||
        isTrainingRunInProgress(activeRun.status) ||
        busyState.generating ||
        (!activeRun.checkpoint && !activeRun.checkpointSavedAt)
      ) {
        return;
      }

      setBusyState((current) => ({ ...current, generating: true }));
      const checkpointedRun = await loadLatestRunCheckpoint(activeRun);
      if (!checkpointedRun?.checkpoint) {
        setBusyState((current) => ({ ...current, generating: false }));
        return;
      }

      const config = createGenerationConfig({
        numSamples: generationConfig.numSamples,
        requestedBlockSize: checkpointedRun.checkpoint.tokenizer.blockSize,
        temperature: clampTemperature(temperature),
      });

      sendPreviewCommand({
        checkpoint: checkpointedRun.checkpoint,
        generationConfig: config,
        runId: checkpointedRun.id,
        type: "generateSamples",
      });
    },
    [activeRun, busyState.generating, generationConfig, loadLatestRunCheckpoint, sendPreviewCommand],
  );

  const ensureRunArtifacts = useCallback(
    async (run: TrainingRunRecord) => {
      const model = await getTrainingRunArtifact(run.id, "model");
      if (model) {
        return { model };
      }

      const checkpointedRun = await loadLatestRunCheckpoint(run);
      if (!checkpointedRun?.checkpoint) {
        throw new Error("This run does not have a saved checkpoint yet.");
      }

      const { buildDreamPhraseArtifactSet } = await import("@/lib/dreamphrase-artifacts");
      const artifactSet = buildDreamPhraseArtifactSet(
        checkpointedRun.checkpoint,
        checkpointedRun.name,
      );
      await cacheRunExport(checkpointedRun, artifactSet);
      return artifactSet;
    },
    [cacheRunExport, loadLatestRunCheckpoint],
  );

  const downloadRunArtifact = useCallback(
    async (runId: string, kind: RunArtifactKind) => {
      const run = runsRef.current.find((item) => item.id === runId);
      if (!run || isTrainingRunInProgress(run.status) || (!run.checkpoint && !run.checkpointSavedAt)) {
        return;
      }

      setBusyState((current) => ({ ...current, downloading: true }));

      try {
        const artifactSet = await ensureRunArtifacts(run);
        const artifact = artifactSet[kind];
        downloadModelFile(artifact);
        toastManager.add({
          description: "Your model file has been saved to Downloads.",
          title: "Download complete",
          type: "success",
        });
      } catch (error) {
        toastManager.add({
          description: error instanceof Error ? error.message : "The model file couldn't be saved.",
          title: "Download failed",
          type: "error",
        });
      } finally {
        setBusyState((current) => ({ ...current, downloading: false }));
      }
    },
    [ensureRunArtifacts],
  );

  const removeRun = useCallback(
    async (runId: string) => {
      const runToRemove = runsRef.current.find((item) => item.id === runId);
      if (!runToRemove || isTrainingRunInProgress(runToRemove.status)) {
        return;
      }

      commitRuns(runsRef.current.filter((item) => item.id !== runId));

      if (activeRunId === runId) {
        persistActiveRunId(null);
      }

      terminateTrainingWorker(runId);
      sendPreviewCommand({
        runId,
        type: "deleteRun",
      });

      telemetryPersistedAtRef.current.delete(runId);
      try {
        await deleteTrainingRun(runId);
      } catch (error) {
        await hydrate();
        toastManager.add({
          description: error instanceof Error ? error.message : "The model couldn't be deleted.",
          title: "Delete failed",
          type: "error",
        });
        return;
      }
    },
    [
      activeRunId,
      commitRuns,
      hydrate,
      persistActiveRunId,
      sendPreviewCommand,
      terminateTrainingWorker,
    ],
  );

  const toggleLike = useCallback(
    async (value: string) => {
      if (!activeRun) {
        return;
      }

      const normalizedValue = value.trim();
      if (!normalizedValue) {
        return;
      }

      const likes = activeRun.likes.includes(normalizedValue)
        ? activeRun.likes.filter((item) => item !== normalizedValue)
        : [normalizedValue, ...activeRun.likes];

      await replaceRun(
        {
          ...activeRun,
          likes,
          updatedAt: Date.now(),
        },
        { persistCheckpoint: false },
      );
    },
    [activeRun, replaceRun],
  );

  const resetAll = useCallback(async () => {
    setBusyState((current) => ({ ...current, generating: false, resetting: true }));
    try {
      terminateAllTrainingWorkers();
      sendPreviewCommand({ type: "resetAll" });
      await resetTrainerStorage();
      await hydrate({ suppressErrorToast: true });
      setTrainingConfig(DEFAULT_TRAINING_CONFIG);
      setGenerationConfig(DEFAULT_GENERATION_CONFIG);
    } catch (error) {
      toastManager.add({
        description: error instanceof Error ? error.message : "The browser data couldn't be reset.",
        title: "Reset failed",
        type: "error",
      });
    } finally {
      setBusyState((current) => ({ ...current, resetting: false }));
    }
  }, [hydrate, sendPreviewCommand, terminateAllTrainingWorkers]);

  const hasActiveTraining = useMemo(() => hasTrainingRun(runs), [runs]);

  return {
    busyState,
    generation: {
      activeTab,
      config: generationConfig,
      generateForActiveRun,
      setActiveTab,
      setConfig: setGenerationConfig,
      toggleLike,
    },
    maintenance: {
      resetAll,
    },
    runs: {
      active: activeRun,
      all: runs,
      downloadArtifact: downloadRunArtifact,
      ensureCheckpoint: ensureRunCheckpointLoaded,
      getByFileId: getRunForFile,
      remove: removeRun,
      resume: resumeRun,
      start: startTraining,
    },
    training: {
      config: trainingConfig,
      hasActiveTraining,
      setConfig: setTrainingConfig,
    },
    workspace: {
      createFile,
      files,
      importFiles,
      removeFile,
      saveSelectedFileContent,
      saveSelectedFileName,
      selectFile,
      selectedFile,
      selectedFileId,
      selectedFileSummary,
    },
  };
}

export type BrowserTrainerController = ReturnType<typeof useBrowserTrainer>;
