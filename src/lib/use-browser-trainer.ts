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
import { waitForServiceWorkerReady } from "@/lib/service-worker";
import {
  clampTemperature,
  createId,
  createLogEntry,
  getRunName,
  summarizeDatasetText,
} from "@/lib/trainer-core";
import {
  DEFAULT_GENERATION_CONFIG,
  DEFAULT_TRAINING_CONFIG,
  TRAINING_CONFIG_STORAGE_KEY,
} from "@/lib/trainer-defaults";
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
  type ResultsTab,
  type RunArtifactKind,
  resolveTrainingRunResumeTargetSteps,
  type TrainerCommand,
  type TrainerEvent,
  type TrainingConfig,
  type TrainingRunRecord,
  type WorkspaceFile,
} from "@/lib/trainer-types";
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

type CommitOptions = {
  transition?: boolean;
};

type GenerationProgress = {
  completedSamples: number;
  startedAt: number;
  tokensGenerated: number;
  tokensPerSecond: number;
  totalSamples: number;
};

const INITIAL_BUSY_STATE: BrowserTrainerBusyState = {
  downloading: false,
  generating: false,
  hydrating: true,
  importing: false,
  resetting: false,
  workerReady: false,
};

function mergeTrainingConfig(config: Partial<TrainingConfig> | null | undefined): TrainingConfig {
  return {
    ...DEFAULT_TRAINING_CONFIG,
    ...config,
    model: {
      ...DEFAULT_TRAINING_CONFIG.model,
      ...config?.model,
    },
  };
}

function loadStoredTrainingConfig() {
  if (typeof window === "undefined") {
    return DEFAULT_TRAINING_CONFIG;
  }

  try {
    const serializedConfig = window.localStorage.getItem(TRAINING_CONFIG_STORAGE_KEY);
    if (!serializedConfig) {
      return DEFAULT_TRAINING_CONFIG;
    }

    return mergeTrainingConfig(JSON.parse(serializedConfig) as Partial<TrainingConfig>);
  } catch {
    return DEFAULT_TRAINING_CONFIG;
  }
}

function saveStoredTrainingConfig(config: TrainingConfig) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(TRAINING_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Non-critical; the current session still uses the updated controls.
  }
}

function clearStoredTrainingConfig() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(TRAINING_CONFIG_STORAGE_KEY);
  } catch {
    // Non-critical; reset still applies for the current session.
  }
}

function getGenerationSampleKey(runId: string, temperatureKey: string, sampleIndex: number) {
  return `${runId}:${temperatureKey}:${sampleIndex}`;
}

function removePendingGenerationSamples(
  current: Set<string>,
  runId: string,
  temperatureKey?: string,
) {
  const prefix = temperatureKey ? `${runId}:${temperatureKey}:` : `${runId}:`;
  return new Set([...current].filter((key) => !key.startsWith(prefix)));
}

function createGenerationProgress(totalSamples: number): GenerationProgress {
  return {
    completedSamples: 0,
    startedAt: performance.now(),
    tokensGenerated: 0,
    tokensPerSecond: 0,
    totalSamples,
  };
}

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
  const generationSampleLengthsRef = useRef<Map<string, number>>(new Map());

  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [runs, setRuns] = useState<TrainingRunRecord[]>([]);
  const [selectedFileId, setSelectedFileIdState] = useState<string | null>(null);
  const [activeRunId, setActiveRunIdState] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ResultsTab>("generated");
  const [trainingConfig, setTrainingConfigState] =
    useState<TrainingConfig>(loadStoredTrainingConfig);
  const [generationConfig, setGenerationConfig] =
    useState<GenerationConfig>(DEFAULT_GENERATION_CONFIG);
  const [pendingGenerationSamples, setPendingGenerationSamples] = useState<Set<string>>(
    () => new Set(),
  );
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
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

  useEffect(() => {
    const runId = activeRunIdRef.current;
    if (!runId) {
      return;
    }

    const run = runsRef.current.find((r) => r.id === runId);
    if (!run || !isTrainingRunInProgress(run.status)) {
      return;
    }

    const workerEntry = trainingWorkersRef.current.get(runId);
    if (!workerEntry) {
      return;
    }

    workerEntry.worker.postMessage({
      runId,
      trainingConfig: {
        lossReadbackInterval: trainingConfig.lossReadbackInterval,
      },
      type: "updateTrainingConfig",
    });
  }, [trainingConfig.lossReadbackInterval]);

  const commitFiles = useCallback((nextFiles: WorkspaceFile[], options?: CommitOptions) => {
    const commit = () => {
      setFiles(nextFiles);
    };

    if (options?.transition === false) {
      commit();
      return;
    }

    startTransition(commit);
  }, []);

  const commitRuns = useCallback((nextRuns: TrainingRunRecord[], options?: CommitOptions) => {
    runsRef.current = nextRuns;

    const commit = () => {
      setRuns(nextRuns);
    };

    if (options?.transition === false) {
      commit();
      return;
    }

    startTransition(commit);
  }, []);

  const setTrainingConfig = useCallback(
    (config: TrainingConfig | ((current: TrainingConfig) => TrainingConfig)) => {
      setTrainingConfigState((current) => {
        const nextConfig = typeof config === "function" ? config(current) : config;
        saveStoredTrainingConfig(nextConfig);
        return nextConfig;
      });
    },
    [],
  );

  const resetTrainingConfig = useCallback(() => {
    clearStoredTrainingConfig();
    setTrainingConfigState(DEFAULT_TRAINING_CONFIG);
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

  const sendGenerationCommand = useCallback((runId: string, command: TrainerCommand) => {
    (trainingWorkersRef.current.get(runId)?.worker ?? previewWorkerRef.current)?.postMessage(
      command,
    );
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

        commitFiles(nextFiles, { transition: false });
        commitRuns(nextRuns, { transition: false });
        setGenerationConfig(DEFAULT_GENERATION_CONFIG);

        persistSelectedFileId(restoredSelection.selectedFileId);
        persistActiveRunId(restoredSelection.activeRunId);

        const restoredRun =
          nextRuns.find((run) => run.id === restoredSelection.activeRunId) ?? null;
        if (restoredRun) {
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

  const beginGenerationForRun = useCallback(
    async (run: TrainingRunRecord, temperature: number) => {
      const config = createGenerationConfig({
        numSamples: generationConfig.numSamples,
        requestedBlockSize:
          run.checkpoint?.tokenizer.blockSize ?? run.trainingConfig.model.blockSize,
        temperature: clampTemperature(temperature),
      });
      const temperatureKey = config.temperature.toFixed(1);

      setBusyState((current) => ({ ...current, generating: true }));
      generationSampleLengthsRef.current.clear();
      setGenerationProgress(createGenerationProgress(config.numSamples));
      setPendingGenerationSamples((current) =>
        removePendingGenerationSamples(current, run.id, temperatureKey),
      );
      await replaceRun(
        {
          ...run,
          generatedResults: replaceGeneratedResultsForTemperature(
            run.generatedResults,
            temperatureKey,
            [],
          ),
          updatedAt: Date.now(),
        },
        { persist: false },
      );
      setActiveTab("generated");
      sendGenerationCommand(run.id, {
        generationConfig: config,
        runId: run.id,
        type: "generateSamples",
      });
    },
    [generationConfig.numSamples, replaceRun, sendGenerationCommand],
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
          await beginGenerationForRun(nextRun, generationConfig.temperature);
          return;
        }

        case "generationCompleted": {
          setBusyState((current) => ({ ...current, generating: false }));
          generationSampleLengthsRef.current.clear();
          setGenerationProgress(null);
          setPendingGenerationSamples((current) =>
            removePendingGenerationSamples(current, event.runId, event.temperatureKey),
          );

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

        case "generationSampled": {
          const run = runsRef.current.find((item) => item.id === event.runId);
          if (!run) {
            return;
          }

          const currentResults = run.generatedResults[event.temperatureKey] ?? [];
          const nextResults = [...currentResults];
          nextResults[event.sampleIndex] = event.generatedResult;
          const sampleKey = getGenerationSampleKey(
            event.runId,
            event.temperatureKey,
            event.sampleIndex,
          );
          const previousLength = generationSampleLengthsRef.current.get(sampleKey) ?? 0;
          const nextLength = event.generatedResult.length;
          const tokenDelta = Math.max(nextLength - previousLength, 0);
          generationSampleLengthsRef.current.set(sampleKey, nextLength);

          setPendingGenerationSamples((current) => {
            const next = new Set(current);
            if (event.isComplete) {
              next.delete(sampleKey);
            } else {
              next.add(sampleKey);
            }
            return next;
          });
          setGenerationProgress((current) => {
            const progress = current ?? createGenerationProgress(generationConfig.numSamples);
            const tokensGenerated = progress.tokensGenerated + tokenDelta;
            const elapsedSeconds = Math.max((performance.now() - progress.startedAt) / 1000, 1e-9);

            return {
              ...progress,
              completedSamples: Math.max(
                progress.completedSamples,
                event.isComplete ? event.sampleIndex + 1 : event.sampleIndex,
              ),
              tokensGenerated,
              tokensPerSecond: tokensGenerated / elapsedSeconds,
            };
          });

          await replaceRun(
            {
              ...run,
              generatedResults: replaceGeneratedResultsForTemperature(
                run.generatedResults,
                event.temperatureKey,
                nextResults,
              ),
              updatedAt: Date.now(),
            },
            { persist: false },
          );
          setActiveTab("generated");
          return;
        }

        case "error": {
          setBusyState((current) => ({ ...current, downloading: false, generating: false }));
          generationSampleLengthsRef.current.clear();
          setGenerationProgress(null);
          const runId = event.runId;
          if (runId) {
            setPendingGenerationSamples((current) =>
              removePendingGenerationSamples(current, runId),
            );
          }
          const errorLogMessage = event.stack
            ? `${event.name ? `${event.name}: ` : ""}${event.message}\n${event.stack}`
            : event.message;
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
              logs: appendLogs(run.logs, [createLogEntry(errorLogMessage, "error")]),
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
    [beginGenerationForRun, generationConfig.numSamples, generationConfig.temperature, replaceRun],
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
      const onError = (event: ErrorEvent) => {
        void handleWorkerEvent({
          message: event.message || "Worker failed to start.",
          name: event.error instanceof Error ? event.error.name : undefined,
          runId,
          stack: event.error instanceof Error ? event.error.stack : undefined,
          type: "error",
        });
      };
      const onMessage = (event: MessageEvent<TrainerEvent>) => {
        const nextEvent = event.data;
        void handleWorkerEvent(nextEvent).finally(() => {
          if (nextEvent.type === "error") {
            terminateTrainingWorker(runId);
          }
        });
      };

      worker.addEventListener("error", onError);
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

    const onError = (event: ErrorEvent) => {
      void handleWorkerEvent({
        message: event.message || "Worker failed to start.",
        name: event.error instanceof Error ? event.error.name : undefined,
        runId: null,
        stack: event.error instanceof Error ? event.error.stack : undefined,
        type: "error",
      });
    };
    const onMessage = (event: MessageEvent<TrainerEvent>) => {
      void handleWorkerEvent(event.data);
    };

    worker.addEventListener("error", onError);
    worker.addEventListener("message", onMessage);
    void hydrate().catch(() => {});

    return () => {
      worker.removeEventListener("error", onError);
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
        generatedResults: {},
        likes: [],
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

  const generateForRun = useCallback(
    async (run: TrainingRunRecord | null, temperature: number) => {
      if (
        !run ||
        isTrainingRunInProgress(run.status) ||
        busyState.generating ||
        (!run.checkpoint && !run.checkpointSavedAt)
      ) {
        return;
      }

      await beginGenerationForRun(run, temperature);
    },
    [beginGenerationForRun, busyState.generating],
  );

  const generateForActiveRun = useCallback(
    async (temperature: number) => {
      await generateForRun(activeRun, temperature);
    },
    [activeRun, generateForRun],
  );

  const generateForRunId = useCallback(
    async (runId: string, temperature: number) => {
      await generateForRun(runsRef.current.find((run) => run.id === runId) ?? null, temperature);
    },
    [generateForRun],
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
      if (
        !run ||
        isTrainingRunInProgress(run.status) ||
        (!run.checkpoint && !run.checkpointSavedAt)
      ) {
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

  const toggleLikeForRun = useCallback(
    async (run: TrainingRunRecord | null, value: string) => {
      if (!run) {
        return;
      }

      const normalizedValue = value.trim();
      if (!normalizedValue) {
        return;
      }

      const likes = run.likes.includes(normalizedValue)
        ? run.likes.filter((item) => item !== normalizedValue)
        : [normalizedValue, ...run.likes];

      await replaceRun(
        {
          ...run,
          likes,
          updatedAt: Date.now(),
        },
        { persistCheckpoint: false },
      );
    },
    [replaceRun],
  );

  const toggleLike = useCallback(
    async (value: string) => {
      await toggleLikeForRun(activeRun, value);
    },
    [activeRun, toggleLikeForRun],
  );

  const toggleLikeForRunId = useCallback(
    async (runId: string, value: string) => {
      await toggleLikeForRun(runsRef.current.find((run) => run.id === runId) ?? null, value);
    },
    [toggleLikeForRun],
  );

  const resetAll = useCallback(async () => {
    setBusyState((current) => ({ ...current, generating: false, resetting: true }));
    try {
      terminateAllTrainingWorkers();
      sendPreviewCommand({ type: "resetAll" });
      await resetTrainerStorage();
      await hydrate({ suppressErrorToast: true });
      resetTrainingConfig();
      setGenerationConfig(DEFAULT_GENERATION_CONFIG);
      setPendingGenerationSamples(new Set());
      generationSampleLengthsRef.current.clear();
      setGenerationProgress(null);
    } catch (error) {
      toastManager.add({
        description: error instanceof Error ? error.message : "The browser data couldn't be reset.",
        title: "Reset failed",
        type: "error",
      });
    } finally {
      setBusyState((current) => ({ ...current, resetting: false }));
    }
  }, [hydrate, resetTrainingConfig, sendPreviewCommand, terminateAllTrainingWorkers]);

  const hasActiveTraining = useMemo(() => hasTrainingRun(runs), [runs]);

  return {
    busyState,
    generation: {
      activeTab,
      config: generationConfig,
      generateForActiveRun,
      generateForRun: generateForRunId,
      pendingSamples: pendingGenerationSamples,
      progress: generationProgress,
      setActiveTab,
      setConfig: setGenerationConfig,
      toggleLike,
      toggleLikeForRun: toggleLikeForRunId,
    },
    maintenance: {
      resetAll,
    },
    runs: {
      active: activeRun,
      all: runs,
      downloadArtifact: downloadRunArtifact,
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
