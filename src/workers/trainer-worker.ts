/// <reference lib="webworker" />

import { createLogEntry } from "@/lib/trainer-core";
import type { GenerationConfig, TrainerCommand, TrainerEvent } from "@/lib/trainer-types";

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
    postMessageSafe({
      message: error instanceof Error ? error.message : "Unknown worker error.",
      runId: getRunId(event.data),
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
      await startTraining(activeTrainer, command.runId, command.generationConfig);
      return;
    }
    case "resumeTraining": {
      await stopActiveTrainer();
      activeRunId = command.runId;
      activeTrainer = await createTrainerFromCheckpoint(command.checkpoint, command.trainingConfig);
      await startTraining(activeTrainer, command.runId, command.generationConfig);
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
      const generatedResults = await trainer.generateSamples(command.generationConfig);
      postMessageSafe({
        generatedResults,
        logEntry: createLogEntry(
          `Generated ${generatedResults.length.toLocaleString("en-US")} samples at temperature ${command.generationConfig.temperature.toFixed(1)}.`,
          "success",
        ),
        runId: command.runId,
        temperatureKey: command.generationConfig.temperature.toFixed(1),
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
    case "resetAll": {
      const runId = activeRunId ?? "reset";
      await stopActiveTrainer();
      postMessageSafe({
        runId,
        type: "resetComplete",
      });
      return;
    }
    default: {
      const exhaustive = command;
      throw new Error(`Unsupported worker command: ${String(exhaustive)}`);
    }
  }
}

async function startTraining(
  trainer: BrowserTrainer,
  runId: string,
  generationConfig: GenerationConfig,
) {
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
      generationConfig,
      onProgress: async (summary, isAutosave) => {
        if (summary.generatedResults) {
          if (!summary.checkpoint) {
            throw new Error("Training completed without a checkpoint payload.");
          }

          await persistTrainingCheckpoint(runId, summary.checkpoint);
          postTrainingEvent(sessionId, abortController.signal, {
            checkpointSavedAt: summary.checkpoint.exportedAt,
            datasetStats: summary.checkpoint.datasetStats,
            elapsedSeconds: summary.elapsedSeconds,
            generatedResults: summary.generatedResults,
            runId,
            temperatureKey: generationConfig.temperature.toFixed(1),
            type: "trainingCompleted",
          });
          postTrainingEvent(sessionId, abortController.signal, {
            logEntry: summary.logEntry,
            runId,
            type: "log",
          });
          return;
        }

        postTrainingEvent(sessionId, abortController.signal, {
          logEntry: summary.logEntry,
          runId,
          type: "trainingProgress",
        });

        if (isAutosave) {
          if (!summary.checkpoint) {
            throw new Error("Autosave was requested without a checkpoint payload.");
          }

          await persistTrainingCheckpoint(runId, summary.checkpoint);
          postTrainingEvent(sessionId, abortController.signal, {
            checkpointSavedAt: summary.checkpoint.exportedAt,
            datasetStats: summary.checkpoint.datasetStats,
            runId,
            type: "trainingCheckpoint",
          });
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
  checkpoint: Extract<TrainerCommand, { checkpoint: unknown }>["checkpoint"],
) {
  if (activeTrainer && activeRunId === runId) {
    return activeTrainer;
  }

  await stopActiveTrainer();
  activeRunId = runId;
  activeTrainer = await createTrainerFromCheckpoint(checkpoint);
  return activeTrainer;
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

async function createNewTrainer(
  file: Extract<TrainerCommand, { file: unknown }>["file"],
  trainingConfig: Extract<TrainerCommand, { trainingConfig: unknown }>["trainingConfig"],
) {
  const { BrowserTrainer } = await loadTrainerRuntime();
  return BrowserTrainer.createNew(file, trainingConfig);
}

async function createTrainerFromCheckpoint(
  checkpoint: Extract<TrainerCommand, { checkpoint: unknown }>["checkpoint"],
  trainingConfig?: Extract<TrainerCommand, { trainingConfig: unknown }>["trainingConfig"],
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

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}
