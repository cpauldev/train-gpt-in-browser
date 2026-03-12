/// <reference lib="webworker" />

import { createLogEntry } from "@/lib/trainer-core";
import { BrowserTrainer } from "@/lib/trainer-runtime";
import type { GenerationConfig, TrainerCommand, TrainerEvent } from "@/lib/trainer-types";

let activeRunId: string | null = null;
let activeTrainer: BrowserTrainer | null = null;

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
      activeTrainer = await BrowserTrainer.createNew(command.file, command.trainingConfig);
      await startTraining(activeTrainer, command.runId, command.generationConfig);
      return;
    }
    case "resumeTraining": {
      disposeActiveTrainer();
      activeRunId = command.runId;
      activeTrainer = await BrowserTrainer.fromCheckpoint(
        command.checkpoint,
        command.trainingConfig,
      );
      await startTraining(activeTrainer, command.runId, command.generationConfig);
      return;
    }
    case "loadRun": {
      disposeActiveTrainer();
      activeRunId = command.runId;
      activeTrainer = await BrowserTrainer.fromCheckpoint(command.checkpoint);
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
        postMessageSafe({
          checkpoint: summary.checkpoint,
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
        postMessageSafe({
          checkpoint: summary.checkpoint,
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
  activeTrainer = await BrowserTrainer.fromCheckpoint(checkpoint);
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
  const transfer = getEventTransferables(event);
  if (transfer.length > 0) {
    self.postMessage(event, transfer);
    return;
  }

  self.postMessage(event);
}

function getEventTransferables(event: TrainerEvent) {
  switch (event.type) {
    case "trainingCheckpoint":
      return collectCheckpointTransferables(event.checkpoint);
    case "trainingCompleted":
      return collectCheckpointTransferables(event.checkpoint);
    default:
      return [];
  }
}

function collectCheckpointTransferables(
  checkpoint: Extract<TrainerEvent, { checkpoint: unknown }>["checkpoint"],
) {
  return [
    checkpoint.datasetData.buffer,
    checkpoint.sourceFilter.bits.buffer,
    ...checkpoint.weights.map((tensor) => tensor.values.buffer),
    ...checkpoint.optimizerState.firstMoments.map((tensor) => tensor.values.buffer),
    ...checkpoint.optimizerState.secondMoments.map((tensor) => tensor.values.buffer),
  ];
}
