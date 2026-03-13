import { describe, expect, it } from "vitest";
import { DEFAULT_TRAINING_CONFIG } from "@/lib/trainer-defaults";
import {
  canResumeTrainingRun,
  getTrainingRunCompletedSteps,
  resolveTrainingRunResumeTargetSteps,
  type TrainingRunRecord,
} from "@/lib/trainer-types";

function createRun(overrides?: Partial<TrainingRunRecord>): TrainingRunRecord {
  return {
    createdAt: 1,
    datasetStats: {
      characterCount: 10,
      documentCount: 1,
      lineCount: 1,
      tokenCount: 10,
      vocabSize: 5,
    },
    fileId: "file-1",
    fileName: "ideas.txt",
    generatedResults: {},
    id: "run-1",
    likes: [],
    logs: [],
    name: "ideas",
    status: "completed",
    telemetry: [],
    trainingConfig: {
      ...DEFAULT_TRAINING_CONFIG,
      steps: 3_000,
    },
    updatedAt: 1,
    ...overrides,
  };
}

describe("trainer-types", () => {
  it("derives completed steps from the furthest known progress point", () => {
    const run = createRun({
      checkpoint: {
        datasetData: new Int32Array([1]),
        datasetStats: {
          characterCount: 10,
          documentCount: 1,
          lineCount: 1,
          tokenCount: 10,
          vocabSize: 5,
        },
        exportedAt: 1,
        fileId: "file-1",
        fileName: "ideas.txt",
        modelConfig: DEFAULT_TRAINING_CONFIG.model,
        optimizerState: {
          firstMoments: [],
          secondMoments: [],
          step: 1,
        },
        requestedBackend: "cpu",
        resolvedBackend: "cpu",
        resumeState: {
          completedSteps: 2_250,
          finalLoss: 1.23,
          lastSavedAt: 1,
          totalTokens: 10,
        },
        rngState: 1,
        sourceFilter: {
          bitCount: 8,
          bits: new Uint8Array(1),
          falsePositiveRate: 1e-4,
          hashCount: 1,
          itemCount: 1,
          kind: "bloom",
          version: 1,
        },
        tokenizer: {
          blockSize: DEFAULT_TRAINING_CONFIG.model.blockSize,
          bosId: 0,
          idToChar: ["a"],
          vocabSize: 1,
        },
        trainingConfig: DEFAULT_TRAINING_CONFIG,
        weights: [],
      },
      telemetry: [
        {
          loss: 1.2,
          step: 2_300,
          stepsPerSecond: 2.5,
          time: 1,
          tokPerSecond: 128,
          totalSteps: 3_000,
          totalTokens: 12,
        },
      ],
    });

    expect(getTrainingRunCompletedSteps(run)).toBe(2_300);
  });

  it("extends completed runs by another session of requested steps", () => {
    const completedRun = createRun({
      checkpointSavedAt: 1,
      telemetry: [
        {
          loss: 1,
          step: 3_000,
          stepsPerSecond: 2.5,
          time: 1,
          tokPerSecond: 128,
          totalSteps: 3_000,
          totalTokens: 12,
        },
      ],
    });

    expect(resolveTrainingRunResumeTargetSteps(completedRun)).toBe(6_000);
    expect(canResumeTrainingRun(completedRun, 5_000)).toBe(true);
    expect(resolveTrainingRunResumeTargetSteps(completedRun, 5_000)).toBe(8_000);
  });

  it("keeps unfinished runs on their original target unless you raise it", () => {
    const interruptedRun = createRun({
      checkpointSavedAt: 1,
      status: "idle",
      telemetry: [
        {
          loss: 1,
          step: 2_300,
          stepsPerSecond: 2.5,
          time: 1,
          tokPerSecond: 128,
          totalSteps: 3_000,
          totalTokens: 12,
        },
      ],
    });

    expect(resolveTrainingRunResumeTargetSteps(interruptedRun)).toBe(3_000);
    expect(resolveTrainingRunResumeTargetSteps(interruptedRun, 5_000)).toBe(5_000);
  });
});
