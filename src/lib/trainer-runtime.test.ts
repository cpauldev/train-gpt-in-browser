import { describe, expect, it } from "vitest";

import { BrowserTrainer } from "@/lib/trainer-runtime";
import {
  createGenerationConfig,
  createModelConfigFromDimensions,
  type TrainingConfig,
} from "@/lib/trainer-types";

function createTestTrainingConfig(): TrainingConfig {
  return {
    ampRequested: null,
    batchSize: 2,
    beta1: 0.9,
    beta2: 0.95,
    compileRequested: null,
    eps: 1e-8,
    learningRate: 3e-4,
    model: createModelConfigFromDimensions({
      blockSize: 4,
      nEmbd: 8,
      nHead: 2,
      nLayer: 1,
      vocabSize: 1,
    }),
    printEvery: 1,
    requestedBackend: "cpu",
    requestedDeviceLabel: "browser",
    requestedDtype: "auto",
    seed: 42,
    steps: 1,
    weightDecay: 0.01,
  };
}

describe("trainer-runtime", () => {
  it("resumes toward the original total step target instead of adding another full run", async () => {
    const trainingConfig = createTestTrainingConfig();
    const generationConfig = createGenerationConfig({
      numSamples: 0,
      requestedBlockSize: trainingConfig.model.blockSize,
      temperature: 0.8,
    });
    const file = {
      content: "alpha\nbeta\ngamma\ndelta\n",
      id: "file-1",
      name: "tiny.txt",
    };

    const trainer = await BrowserTrainer.createNew(file, trainingConfig);
    const firstStepSummaries: number[] = [];

    const firstRun = await trainer.train({
      generationConfig,
      onProgress: (summary) => {
        firstStepSummaries.push(summary.completedSteps);
      },
    });

    expect(firstRun.checkpoint.resumeState.completedSteps).toBe(1);
    expect(firstRun.checkpoint.resumeState.elapsedTrainingSeconds).toBeGreaterThan(0);
    expect(firstRun.checkpoint.optimizerState.step).toBe(1);
    expect(firstRun.generatedResults).toEqual([]);

    trainer.dispose();

    const resumedTrainingConfig: TrainingConfig = {
      ...createTestTrainingConfig(),
      steps: 2,
    };
    const resumedTrainer = await BrowserTrainer.fromCheckpoint(
      firstRun.checkpoint,
      resumedTrainingConfig,
    );

    const secondRun = await resumedTrainer.train({
      generationConfig,
      onProgress: () => {},
    });

    expect(firstStepSummaries).toContain(1);
    expect(secondRun.checkpoint.resumeState.completedSteps).toBe(2);
    expect(secondRun.checkpoint.resumeState.elapsedTrainingSeconds).toBeGreaterThan(
      firstRun.checkpoint.resumeState.elapsedTrainingSeconds ?? 0,
    );
    expect(secondRun.checkpoint.trainingConfig.steps).toBe(2);
    expect(secondRun.checkpoint.resumeState.totalTokens).toBeGreaterThan(
      firstRun.checkpoint.resumeState.totalTokens,
    );
    expect(secondRun.checkpoint.optimizerState.step).toBe(2);

    resumedTrainer.dispose();
  }, 20000);

  it("only materializes checkpoints when an autosave is due", async () => {
    const trainingConfig = {
      ...createTestTrainingConfig(),
      steps: 2,
    };
    const generationConfig = createGenerationConfig({
      numSamples: 0,
      requestedBlockSize: trainingConfig.model.blockSize,
      temperature: 0.8,
    });
    const file = {
      content: "alpha\nbeta\ngamma\ndelta\n",
      id: "file-2",
      name: "tiny-2.txt",
    };
    const trainer = await BrowserTrainer.createNew(file, trainingConfig);
    const checkpointStates: boolean[] = [];

    await trainer.train({
      generationConfig,
      onProgress: (summary) => {
        checkpointStates.push(Boolean(summary.checkpoint));
      },
    });

    expect(checkpointStates).toEqual([false, true, true]);

    trainer.dispose();
  }, 20000);
});
