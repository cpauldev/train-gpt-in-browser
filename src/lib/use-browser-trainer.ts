import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { toastManager } from "@/components/ui/toast";
import { buildDreamPhraseArtifactSet, getRunArtifactFile } from "@/lib/dreamphrase-artifacts";
import {
  clampTemperature,
  createId,
  createLogEntry,
  getRunName,
  summarizeDatasetText,
} from "@/lib/trainer-core";
import { DEFAULT_GENERATION_CONFIG, DEFAULT_TRAINING_CONFIG } from "@/lib/trainer-defaults";
import { downloadModelFile } from "@/lib/trainer-export";
import {
  createWorkspaceFile,
  deleteTrainingRun,
  deleteWorkspaceFile,
  getTrainingRunArtifact,
  listTrainingRuns,
  listWorkspaceFiles,
  renameWorkspaceFile,
  resetTrainerStorage,
  saveTrainingRun,
  saveTrainingRunArtifacts,
  seedBuiltinWorkspaceFiles,
  updateWorkspaceFileContent,
  upsertImportedWorkspaceFile,
} from "@/lib/trainer-storage";
import {
  createGenerationConfig,
  type GenerationConfig,
  hasTrainingRun,
  type RunArtifactKind,
  type RunPanelTab,
  type TrainerCommand,
  type TrainerEvent,
  type TrainingConfig,
  type TrainingRunRecord,
  type WorkspaceFile,
} from "@/lib/trainer-types";
import { appendTrainingTelemetryPoint } from "@/lib/training-telemetry";
import {
  partitionWorkspaceImportFiles,
  summarizeRejectedWorkspaceImports,
} from "@/lib/workspace-imports";

type BusyState = {
  downloading: boolean;
  generating: boolean;
  hydrating: boolean;
  importing: boolean;
  resetting: boolean;
  workerReady: boolean;
};

export function useBrowserTrainer() {
  const workerRef = useRef<Worker | null>(null);
  const runsRef = useRef<TrainingRunRecord[]>([]);
  const importInFlightRef = useRef(false);

  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [runs, setRuns] = useState<TrainingRunRecord[]>([]);
  const [selectedFileId, setSelectedFileIdState] = useState<string | null>(null);
  const [activeRunId, setActiveRunIdState] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<RunPanelTab>("generated");
  const [trainingConfig, setTrainingConfig] = useState<TrainingConfig>(DEFAULT_TRAINING_CONFIG);
  const [generationConfig, setGenerationConfig] =
    useState<GenerationConfig>(DEFAULT_GENERATION_CONFIG);
  const [busyState, setBusyState] = useState<BusyState>({
    downloading: false,
    generating: false,
    hydrating: true,
    importing: false,
    resetting: false,
    workerReady: false,
  });

  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);
  const selectedFile = useMemo(
    () => files.find((file) => file.id === selectedFileId) ?? null,
    [files, selectedFileId],
  );
  const activeRun = useMemo(
    () => runs.find((run) => run.id === activeRunId) ?? null,
    [runs, activeRunId],
  );
  const selectedFileSummary = useMemo(() => {
    if (!selectedFile) {
      return null;
    }
    return summarizeDatasetText(selectedFile.content);
  }, [selectedFile]);

  const loadRunIntoWorker = useCallback((run: TrainingRunRecord | null) => {
    if (!run?.checkpoint || !workerRef.current) {
      return;
    }

    workerRef.current.postMessage({
      checkpoint: run.checkpoint,
      runId: run.id,
      type: "loadRun",
    } satisfies TrainerCommand);
  }, []);

  const activateRun = useCallback(
    async (runId: string | null, availableRuns = runsRef.current) => {
      setActiveRunIdState(runId);

      const run = availableRuns.find((item) => item.id === runId) ?? null;
      if (!run) {
        return null;
      }

      setTrainingConfig(run.trainingConfig);
      loadRunIntoWorker(run);
      return run;
    },
    [loadRunIntoWorker],
  );

  const clearSelection = useCallback(() => {
    setSelectedFileIdState(null);
    setActiveRunIdState(null);
  }, []);

  const selectFileAndRun = useCallback(
    async (fileId: string | null, availableRuns = runsRef.current) => {
      if (!fileId) {
        clearSelection();
        return null;
      }

      setSelectedFileIdState(fileId);

      const run = availableRuns.find((item) => item.fileId === fileId) ?? null;
      if (!run) {
        setActiveRunIdState(null);
        return null;
      }

      await activateRun(run.id, availableRuns);
      return run;
    },
    [activateRun, clearSelection],
  );

  const hydrate = useCallback(async () => {
    setBusyState((current) => ({ ...current, hydrating: true }));
    await seedBuiltinWorkspaceFiles();
    const [nextFiles, persistedRuns] = await Promise.all([
      listWorkspaceFiles(),
      listTrainingRuns(),
    ]);
    const { interruptedRunCount, runs: reconciledRuns } =
      await reconcileHydratedRuns(persistedRuns);
    const nextRuns = await normalizeHydratedRuns(reconciledRuns);

    setFiles(nextFiles);
    setRuns(nextRuns);
    runsRef.current = nextRuns;
    clearSelection();
    setTrainingConfig(DEFAULT_TRAINING_CONFIG);
    setGenerationConfig(DEFAULT_GENERATION_CONFIG);

    if (interruptedRunCount > 0) {
      toastManager.add({
        description:
          interruptedRunCount === 1
            ? "You can resume from your latest checkpoint."
            : "You can resume any run from its latest checkpoint.",
        title: interruptedRunCount === 1 ? "Run restored" : `${interruptedRunCount} runs restored`,
        type: "warning",
      });
    }

    setBusyState((current) => ({ ...current, hydrating: false }));
  }, [clearSelection]);

  const replaceRun = useCallback(
    async (
      run: TrainingRunRecord,
      options?: { persist?: boolean; persistCheckpoint?: boolean },
    ) => {
      const currentRuns = runsRef.current;
      const duplicateRuns = currentRuns.filter(
        (item) => item.fileId === run.fileId && item.id !== run.id,
      );
      const nextRuns = sortRunsByRecent([
        run,
        ...currentRuns.filter((item) => item.id !== run.id && item.fileId !== run.fileId),
      ]);

      if (duplicateRuns.length > 0) {
        await Promise.all(duplicateRuns.map((item) => deleteTrainingRun(item.id)));
      }

      runsRef.current = nextRuns;
      setRuns(nextRuns);
      if (options?.persist !== false) {
        await saveTrainingRun(run, {
          persistCheckpoint: options?.persistCheckpoint,
        });
      }
    },
    [],
  );

  const cacheRunExport = useCallback(
    async (run: TrainingRunRecord, artifactSet: Parameters<typeof saveTrainingRunArtifacts>[1]) => {
      const persistedRun = await saveTrainingRunArtifacts(run, artifactSet);
      await replaceRun(persistedRun, { persist: false });
      return persistedRun;
    },
    [replaceRun],
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
              status: "training",
              updatedAt: Date.now(),
            },
            { persist: false },
          );
          setActiveTab("generated");
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
              status: "training",
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
          await replaceRun(
            {
              ...run,
              status: "training",
              telemetry: appendTrainingTelemetryPoint(run.telemetry, event.point),
              updatedAt: Date.now(),
            },
            { persist: false },
          );
          return;
        }
        case "trainingCheckpoint": {
          const run = runsRef.current.find((item) => item.id === event.runId);
          if (!run) {
            return;
          }
          await replaceRun({
            ...run,
            checkpoint: event.checkpoint,
            datasetStats: event.checkpoint.datasetStats,
            updatedAt: Date.now(),
          });
          return;
        }
        case "trainingCompleted": {
          const run = runsRef.current.find((item) => item.id === event.runId);
          if (!run) {
            return;
          }
          const nextRun: TrainingRunRecord = {
            ...run,
            checkpoint: event.checkpoint,
            datasetStats: event.checkpoint.datasetStats,
            generatedResults: replaceGeneratedResultsForTemperature(
              run.generatedResults,
              event.temperatureKey,
              event.generatedResults,
            ),
            status: "completed",
            updatedAt: Date.now(),
          };
          await replaceRun(nextRun);
          setActiveRunIdState(event.runId);
          setActiveTab("generated");
          toastManager.add({
            description: "Your model is ready.",
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

  useEffect(() => {
    const worker = new Worker(new URL("../workers/trainer-worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;

    const onMessage = (event: MessageEvent<TrainerEvent>) => {
      void handleWorkerEvent(event.data);
    };

    worker.addEventListener("message", onMessage);
    void hydrate();

    return () => {
      worker.removeEventListener("message", onMessage);
      worker.terminate();
      workerRef.current = null;
    };
  }, [handleWorkerEvent, hydrate]);

  const createFile = useCallback(async (name: string) => {
    const file = await createWorkspaceFile(name, "");
    const nextFiles = await listWorkspaceFiles();
    setFiles(nextFiles);
    return file;
  }, []);

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
        let lastImportedId: string | null = null;
        for (const file of accepted) {
          const content = await file.text();
          const createdFile = await upsertImportedWorkspaceFile(file.name, content);
          lastImportedId = createdFile.id;
        }
        const nextFiles = await listWorkspaceFiles();
        setFiles(nextFiles);
        await selectFileAndRun(lastImportedId);
        return accepted.length;
      } finally {
        importInFlightRef.current = false;
        setBusyState((current) => ({ ...current, importing: false }));
      }
    },
    [selectFileAndRun],
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
        await clearSelection();
      }

      await Promise.all(
        relatedRunIds.map(async (runId) => {
          workerRef.current?.postMessage({
            runId,
            type: "deleteRun",
          } satisfies TrainerCommand);
          await deleteTrainingRun(runId);
        }),
      );
      await deleteWorkspaceFile(fileId);
      const [nextFiles, nextRuns] = await Promise.all([listWorkspaceFiles(), listTrainingRuns()]);
      setFiles(nextFiles);
      runsRef.current = nextRuns;
      setRuns(nextRuns);
    },
    [clearSelection, selectedFileId],
  );

  const startTraining = useCallback(
    async (fileOverride?: Pick<WorkspaceFile, "content" | "id" | "name">) => {
      if (hasTrainingRun(runsRef.current)) {
        return;
      }
      const fileToTrain = fileOverride ?? selectedFile;
      if (!fileToTrain || !workerRef.current) {
        return;
      }

      const existingRun = runsRef.current.find((item) => item.fileId === fileToTrain.id) ?? null;
      if (existingRun) {
        workerRef.current.postMessage({
          runId: existingRun.id,
          type: "deleteRun",
        } satisfies TrainerCommand);
        await deleteTrainingRun(existingRun.id);
        const filteredRuns = runsRef.current.filter((item) => item.id !== existingRun.id);
        runsRef.current = filteredRuns;
        setRuns(filteredRuns);
      }

      const summary = summarizeDatasetText(fileToTrain.content);
      const now = Date.now();
      const runId = createId("run");
      const run: TrainingRunRecord = {
        createdAt: now,
        datasetStats: {
          characterCount: summary.characterCount,
          documentCount: summary.documents.length,
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
        status: "training",
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
      setActiveRunIdState(runId);
      setActiveTab("generated");

      workerRef.current.postMessage({
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
      } satisfies TrainerCommand);
    },
    [generationConfig, replaceRun, selectedFile, trainingConfig],
  );

  const resumeRun = useCallback(
    async (runId: string) => {
      const run = runsRef.current.find((item) => item.id === runId);
      if (!run?.checkpoint || !workerRef.current || run.status === "training") {
        return;
      }

      const nextTrainingConfig: TrainingConfig = {
        ...run.trainingConfig,
        model: run.checkpoint.modelConfig,
      };
      await replaceRun({
        ...run,
        status: "training",
        trainingConfig: nextTrainingConfig,
        updatedAt: Date.now(),
      });
      setActiveRunIdState(runId);
      setActiveTab("generated");

      workerRef.current.postMessage({
        checkpoint: run.checkpoint,
        file: {
          content: "",
          id: run.fileId,
          name: run.fileName,
        },
        generationConfig: {
          ...generationConfig,
          requestedBlockSize: run.checkpoint.tokenizer.blockSize,
        },
        runId,
        trainingConfig: nextTrainingConfig,
        type: "resumeTraining",
      } satisfies TrainerCommand);
    },
    [generationConfig, replaceRun],
  );

  const generateForActiveRun = useCallback(
    async (temperature: number) => {
      if (
        !activeRun?.checkpoint ||
        !workerRef.current ||
        activeRun.status === "training" ||
        busyState.generating
      ) {
        return;
      }

      const config = createGenerationConfig({
        numSamples: generationConfig.numSamples,
        requestedBlockSize: activeRun.checkpoint.tokenizer.blockSize,
        temperature: clampTemperature(temperature),
      });

      setBusyState((current) => ({ ...current, generating: true }));
      workerRef.current.postMessage({
        checkpoint: activeRun.checkpoint,
        generationConfig: config,
        runId: activeRun.id,
        type: "generateSamples",
      } satisfies TrainerCommand);
    },
    [activeRun, busyState.generating, generationConfig],
  );

  const ensureRunArtifacts = useCallback(
    async (run: TrainingRunRecord) => {
      if (!run.checkpoint) {
        throw new Error("This run does not have a saved checkpoint yet.");
      }

      const model = await getTrainingRunArtifact(run.id, "model");

      if (model) {
        return { model };
      }

      const artifactSet = buildDreamPhraseArtifactSet(run.checkpoint, run.name);
      await cacheRunExport(run, artifactSet);
      return artifactSet;
    },
    [cacheRunExport],
  );

  const downloadRunArtifact = useCallback(
    async (runId: string, kind: RunArtifactKind) => {
      const run = runsRef.current.find((item) => item.id === runId);

      if (!run?.checkpoint || run.status === "training") {
        return;
      }

      setBusyState((current) => ({ ...current, downloading: true }));
      try {
        const artifactSet = await ensureRunArtifacts(run);
        const artifact = getRunArtifactFile(artifactSet, kind);
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
      if (hasTrainingRun(runsRef.current)) {
        return;
      }
      const runToRemove = runsRef.current.find((item) => item.id === runId);
      if (!runToRemove) {
        return;
      }

      const nextRuns = runsRef.current.filter((item) => item.id !== runId);
      flushSync(() => {
        runsRef.current = nextRuns;
        setRuns(nextRuns);

        if (activeRunId === runId) {
          setActiveRunIdState(null);
        }
      });

      workerRef.current?.postMessage({
        runId,
        type: "deleteRun",
      } satisfies TrainerCommand);
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
    [activeRunId, hydrate],
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
    workerRef.current?.postMessage({ type: "resetAll" } satisfies TrainerCommand);
    await resetTrainerStorage();
    await hydrate();
    setTrainingConfig(DEFAULT_TRAINING_CONFIG);
    setGenerationConfig(DEFAULT_GENERATION_CONFIG);
    toastManager.add({
      description: "Built-in datasets were restored.",
      title: "Local data cleared",
      type: "success",
    });
    setBusyState((current) => ({ ...current, resetting: false }));
  }, [hydrate]);

  return {
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
  };
}

function appendLogs(current: TrainingRunRecord["logs"], entries: TrainingRunRecord["logs"]) {
  return [...current, ...entries];
}

function replaceGeneratedResultsForTemperature(
  current: TrainingRunRecord["generatedResults"],
  temperatureKey: string,
  nextResults: string[],
) {
  return {
    ...current,
    [temperatureKey]: [...nextResults],
  };
}

async function normalizeHydratedRuns(runs: TrainingRunRecord[]) {
  const keptRuns = new Map<string, TrainingRunRecord>();
  const duplicateRunIds: string[] = [];

  for (const run of sortRunsByRecent(runs)) {
    if (!keptRuns.has(run.fileId)) {
      keptRuns.set(run.fileId, run);
      continue;
    }

    duplicateRunIds.push(run.id);
  }

  if (duplicateRunIds.length > 0) {
    await Promise.all(duplicateRunIds.map((runId) => deleteTrainingRun(runId)));
  }

  return sortRunsByRecent([...keptRuns.values()]);
}

async function reconcileHydratedRuns(runs: TrainingRunRecord[]) {
  const updatedAt = Date.now();
  let interruptedRunCount = 0;

  const nextRuns = await Promise.all(
    runs.map(async (run) => {
      if (run.status !== "training") {
        return run;
      }

      interruptedRunCount += 1;
      const message = run.checkpoint
        ? "Browser session ended before training completed. Resume this run to continue from the latest checkpoint."
        : "Browser session ended before the first checkpoint was saved. Start training again to recreate this run.";
      const nextRun: TrainingRunRecord = {
        ...run,
        lastError: run.checkpoint ? run.lastError : message,
        logs: appendLogs(run.logs, [createLogEntry(message, run.checkpoint ? "line" : "error")]),
        status: run.checkpoint ? "idle" : "error",
        updatedAt,
      };

      await saveTrainingRun(nextRun);
      return nextRun;
    }),
  );

  return {
    interruptedRunCount,
    runs: sortRunsByRecent(nextRuns),
  };
}

function sortRunsByRecent(runs: TrainingRunRecord[]) {
  return [...runs].sort((left, right) => right.updatedAt - left.updatedAt);
}
