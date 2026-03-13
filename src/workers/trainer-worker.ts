/// <reference lib="webworker" />

import { createLogEntry } from "@/lib/trainer-core";
import type { GenerationConfig, TrainerCommand, TrainerEvent } from "@/lib/trainer-types";

type BrowserTrainer = import("@/lib/trainer-runtime").BrowserTrainer;

let activeRunId: string | null = null;
let activeTrainer: BrowserTrainer | null = null;
let trainerRuntimePromise: Promise<typeof import("@/lib/trainer-runtime")> | null = null;
let trainerStoragePromise: Promise<typeof import("@/lib/trainer-storage")> | null = null;

self.addEventListener("message", async (event: MessageEvent<TrainerCommand>) => {
  try {
    await handleCommand(event.data);
  } catch (error) {
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
      disposeActiveTrainer();
      activeRunId = command.runId;
      activeTrainer = await createNewTrainer(command.file, command.trainingConfig);
      await startTraining(activeTrainer, command.runId, command.generationConfig);
      return;
    }
    case "resumeTraining": {
      disposeActiveTrainer();
      activeRunId = command.runId;
      activeTrainer = await createTrainerFromCheckpoint(command.checkpoint, command.trainingConfig);
      await startTraining(activeTrainer, command.runId, command.generationConfig);
      return;
    }
    case "loadRun": {
      disposeActiveTrainer();
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
        disposeActiveTrainer();
      }
      return;
    }
    case "resetAll": {
      disposeActiveTrainer();
      postMessageSafe({
        runId: activeRunId ?? "reset",
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
  postMessageSafe({
    logEntry: createLogEntry("Training session started.", "success"),
    resolvedBackend: trainer.getResolvedBackend(),
    runId,
    type: "trainingStarted",
  });

  await trainer.train({
    generationConfig,
    onProgress: async (summary, isAutosave) => {
      if (summary.generatedResults) {
        if (!summary.checkpoint) {
          throw new Error("Training completed without a checkpoint payload.");
        }

        await persistTrainingCheckpoint(runId, summary.checkpoint);
        postMessageSafe({
          checkpointSavedAt: summary.checkpoint.exportedAt,
          datasetStats: summary.checkpoint.datasetStats,
          elapsedSeconds: summary.elapsedSeconds,
          generatedResults: summary.generatedResults,
          runId,
          temperatureKey: generationConfig.temperature.toFixed(1),
          type: "trainingCompleted",
        });
        postMessageSafe({
          logEntry: summary.logEntry,
          runId,
          type: "log",
        });
        return;
      }

      postMessageSafe({
        logEntry: summary.logEntry,
        runId,
        type: "trainingProgress",
      });

      if (isAutosave) {
        if (!summary.checkpoint) {
          throw new Error("Autosave was requested without a checkpoint payload.");
        }

        await persistTrainingCheckpoint(runId, summary.checkpoint);
        postMessageSafe({
          checkpointSavedAt: summary.checkpoint.exportedAt,
          datasetStats: summary.checkpoint.datasetStats,
          runId,
          type: "trainingCheckpoint",
        });
      }
    },
    onStart: async (logEntries) => {
      for (const logEntry of logEntries) {
        postMessageSafe({
          logEntry,
          runId,
          type: "log",
        });
      }
    },
    onTelemetry: async (point) => {
      postMessageSafe({
        point,
        runId,
        type: "trainingTelemetry",
      });
    },
  });
}

async function ensureActiveTrainer(
  runId: string,
  checkpoint: Extract<TrainerCommand, { checkpoint: unknown }>["checkpoint"],
) {
  if (activeTrainer && activeRunId === runId) {
    return activeTrainer;
  }

  disposeActiveTrainer();
  activeRunId = runId;
  activeTrainer = await createTrainerFromCheckpoint(checkpoint);
  return activeTrainer;
}

function disposeActiveTrainer() {
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
