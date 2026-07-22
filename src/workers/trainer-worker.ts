/// <reference lib="webworker" />

import { createLogEntry } from "@/lib/trainer-core";
import type { TrainerCommand, TrainerEvent, TrainingConfig } from "@/lib/trainer-types";

type BrowserTrainer = import("@/lib/trainer-runtime").BrowserTrainer;

let activeRunId: string | null = null;
let activeTrainer: BrowserTrainer | null = null;
let activeTrainingAbortController: AbortController | null = null;
let activeTrainingPromise: Promise<void> | null = null;
let activeTrainingSessionId = 0;
let trainerRuntimePromise: Promise<typeof import("@/lib/trainer-runtime")> | null = null;
let trainerStoragePromise: Promise<typeof import("@/lib/trainer-storage")> | null = null;

self.addEventListener("message", async (event: MessageEvent<TrainerCommand>) => {
  try {
    await handleCommand(event.data);
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    const message = error instanceof Error ? error.message : "Unknown worker error.";
    postMessageSafe({
      message,
      name: error instanceof Error ? error.name : undefined,
      runId: getRunId(event.data),
      stack: error instanceof Error ? error.stack : undefined,
      type: "error",
    });
  }
});

postMessageSafe({ type: "ready" });

async function handleCommand(command: TrainerCommand) {
  switch (command.type) {
    case "startTraining": {
      await stopActiveTrainer();
      activeRunId = command.runId;
      activeTrainer = await createNewTrainer(command.file, command.trainingConfig);
      await startTraining(activeTrainer, command.runId);
      return;
    }
    case "resumeTraining": {
      await stopActiveTrainer();
      activeRunId = command.runId;
      activeTrainer = await createTrainerFromCheckpoint(command.checkpoint, command.trainingConfig);
      await startTraining(activeTrainer, command.runId);
      return;
    }
    case "loadRun": {
      await stopActiveTrainer();
      activeRunId = command.runId;
      activeTrainer = await createTrainerFromCheckpoint(command.checkpoint);
      return;
    }
    case "generateSamples": {
      const trainer = await ensureActiveTrainer(command.runId, command.checkpoint);
      const temperatureKey = command.generationConfig.temperature.toFixed(1);
      const generatedResults = await trainer.generateSamples(
        command.generationConfig,
        undefined,
        (generatedResult, sampleIndex) => {
          postMessageSafe({
            generatedResult,
            isComplete: true,
            runId: command.runId,
            sampleIndex,
            temperatureKey,
            type: "generationSampled",
          });
        },
        (generatedResult, sampleIndex) => {
          postMessageSafe({
            generatedResult,
            isComplete: false,
            runId: command.runId,
            sampleIndex,
            temperatureKey,
            type: "generationSampled",
          });
        },
      );
      postMessageSafe({
        generatedResults,
        logEntry: createLogEntry(
          `Generated ${generatedResults.length.toLocaleString("en-US")} samples at temperature ${command.generationConfig.temperature.toFixed(1)}.`,
          "success",
        ),
        runId: command.runId,
        temperatureKey,
        type: "generationCompleted",
      });
      return;
    }
    case "deleteRun": {
      if (activeRunId === command.runId) {
        await stopActiveTrainer();
      }
      return;
    }
    case "warmRuntime": {
      await Promise.all([loadTrainerRuntime(), loadTrainerStorage()]);
      return;
    }
    case "resetAll": {
      const runId = activeRunId ?? "reset";
      await stopActiveTrainer();
      postMessageSafe({
        runId,
        type: "resetComplete",
      });
      return;
    }
    case "updateTrainingConfig": {
      if (activeTrainer && activeRunId === command.runId) {
        activeTrainer.updateTrainingConfig(command.trainingConfig);
      }
      return;
    }
    default: {
      const exhaustive = command;
      throw new Error(`Unsupported worker command: ${String(exhaustive)}`);
    }
  }
}

async function startTraining(trainer: BrowserTrainer, runId: string) {
  const sessionId = ++activeTrainingSessionId;
  const abortController = new AbortController();
  activeTrainingAbortController = abortController;

  postTrainingEvent(sessionId, abortController.signal, {
    logEntry: createLogEntry("Training session started.", "success"),
    resolvedBackend: trainer.getResolvedBackend(),
    runId,
    type: "trainingStarted",
  });

  const trainingPromise = trainer
    .train({
      onProgress: async (summary, isAutosave) => {
        const isComplete = summary.checkpoint && summary.completedSteps >= summary.totalSteps;
        postTrainingEvent(sessionId, abortController.signal, {
          logEntry: summary.logEntry,
          runId,
          type: isComplete ? "log" : "trainingProgress",
        });

        if (isAutosave) {
          if (!summary.checkpoint) {
            throw new Error("Autosave was requested without a checkpoint payload.");
          }

          await persistTrainingCheckpoint(runId, summary.checkpoint);
          if (isComplete) {
            postTrainingEvent(sessionId, abortController.signal, {
              checkpointSavedAt: summary.checkpoint.exportedAt,
              datasetStats: summary.checkpoint.datasetStats,
              elapsedSeconds: summary.elapsedSeconds,
              runId,
              type: "trainingCompleted",
            });
          } else {
            postTrainingEvent(sessionId, abortController.signal, {
              checkpointSavedAt: summary.checkpoint.exportedAt,
              datasetStats: summary.checkpoint.datasetStats,
              runId,
              type: "trainingCheckpoint",
            });
          }
        }
      },
      onStart: async (logEntries) => {
        for (const logEntry of logEntries) {
          postTrainingEvent(sessionId, abortController.signal, {
            logEntry,
            runId,
            type: "log",
          });
        }
      },
      onTelemetry: async (point) => {
        postTrainingEvent(sessionId, abortController.signal, {
          point,
          runId,
          type: "trainingTelemetry",
        });
      },
      signal: abortController.signal,
    })
    .then(() => {})
    .catch((error) => {
      if (isAbortError(error)) {
        return;
      }
      throw error;
    })
    .finally(() => {
      if (activeTrainingPromise === trainingPromise) {
        activeTrainingPromise = null;
      }
      if (activeTrainingAbortController === abortController) {
        activeTrainingAbortController = null;
      }
    });

  activeTrainingPromise = trainingPromise;
  await trainingPromise;
}

async function ensureActiveTrainer(
  runId: string,
  checkpoint: Extract<TrainerCommand, { type: "generateSamples" }>["checkpoint"],
) {
  if (activeTrainer && activeRunId === runId) {
    return activeTrainer;
  }

  const nextCheckpoint = checkpoint ?? (await loadCheckpointForRun(runId));
  if (!nextCheckpoint) {
    throw new Error("Cannot generate samples before the model is loaded.");
  }

  await stopActiveTrainer();
  activeRunId = runId;
  activeTrainer = await createTrainerFromCheckpoint(nextCheckpoint);
  return activeTrainer;
}

async function loadCheckpointForRun(runId: string) {
  const { getTrainingRun } = await loadTrainerStorage();
  return (await getTrainingRun(runId))?.checkpoint ?? null;
}

async function stopActiveTrainer() {
  const abortController = activeTrainingAbortController;
  activeTrainingAbortController = null;
  if (abortController) {
    abortController.abort();
  }

  const trainingPromise = activeTrainingPromise;
  if (trainingPromise) {
    activeTrainingPromise = null;
    await trainingPromise;
  }

  activeTrainer?.dispose();
  activeTrainer = null;
  activeRunId = null;
}

function getRunId(command: TrainerCommand) {
  return "runId" in command ? command.runId : null;
}

function postMessageSafe(event: TrainerEvent) {
  self.postMessage(event);
}

function postTrainingEvent(sessionId: number, signal: AbortSignal, event: TrainerEvent) {
  if (signal.aborted || sessionId !== activeTrainingSessionId) {
    return;
  }
  postMessageSafe(event);
}

async function createNewTrainer(
  file: Extract<TrainerCommand, { file: unknown }>["file"],
  trainingConfig: TrainingConfig,
) {
  const { BrowserTrainer } = await loadTrainerRuntime();
  return BrowserTrainer.createNew(file, trainingConfig);
}

async function createTrainerFromCheckpoint(
  checkpoint: Extract<TrainerCommand, { checkpoint: unknown }>["checkpoint"],
  trainingConfig?: TrainingConfig,
) {
  const { BrowserTrainer } = await loadTrainerRuntime();
  return BrowserTrainer.fromCheckpoint(checkpoint, trainingConfig);
}

async function persistTrainingCheckpoint(
  runId: string,
  checkpoint: Extract<TrainerCommand, { checkpoint: unknown }>["checkpoint"],
) {
  const { saveTrainingCheckpoint } = await loadTrainerStorage();
  await saveTrainingCheckpoint(runId, checkpoint);
}

async function loadTrainerRuntime() {
  if (!trainerRuntimePromise) {
    trainerRuntimePromise = import("@/lib/trainer-runtime");
  }

  return trainerRuntimePromise;
}

async function loadTrainerStorage() {
  if (!trainerStoragePromise) {
    trainerStoragePromise = import("@/lib/trainer-storage");
  }

  return trainerStoragePromise;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}
