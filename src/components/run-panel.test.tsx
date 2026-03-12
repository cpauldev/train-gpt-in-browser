import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RunPanel } from "@/components/run-panel";
import { DEFAULT_GENERATION_CONFIG, DEFAULT_TRAINING_CONFIG } from "@/lib/trainer-defaults";
import type { TrainingRunRecord } from "@/lib/trainer-types";

function createRun(): TrainingRunRecord {
  return {
    checkpoint: {
      datasetData: new Int32Array([1, 2, 3]),
      datasetStats: {
        characterCount: 32,
        documentCount: 4,
        lineCount: 4,
        tokenCount: 36,
        vocabSize: 12,
      },
      exportedAt: Date.now(),
      fileId: "file-1",
      fileName: "ideas.txt",
      modelConfig: DEFAULT_TRAINING_CONFIG.model,
      optimizerState: {
        firstMoments: [],
        secondMoments: [],
        step: 3,
      },
      requestedBackend: "auto",
      resolvedBackend: "cpu",
      resumeState: {
        completedSteps: 3,
        finalLoss: 1.2345,
        lastSavedAt: Date.now(),
        totalTokens: 768,
      },
      rngState: 42,
      sourceFilter: {
        bitCount: 64,
        bits: new Uint8Array(8),
        falsePositiveRate: 1e-4,
        hashCount: 4,
        itemCount: 4,
        kind: "bloom",
        version: 1,
      },
      tokenizer: {
        blockSize: 32,
        bosId: 10,
        idToChar: ["a", "b"],
        vocabSize: 11,
      },
      trainingConfig: DEFAULT_TRAINING_CONFIG,
      weights: [],
    },
    createdAt: Date.now(),
    datasetStats: {
      characterCount: 32,
      documentCount: 4,
      lineCount: 4,
      tokenCount: 36,
      vocabSize: 12,
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
    trainingConfig: DEFAULT_TRAINING_CONFIG,
    updatedAt: Date.now(),
  };
}

describe("RunPanel", () => {
  it("renders generated results in the table layout", async () => {
    const onTemperatureChange = vi.fn();
    const onTabChange = vi.fn();
    const onToggleLike = vi.fn();

    render(
      <RunPanel
        activeRun={createRun()}
        activeTab="generated"
        displayedResults={Array.from({ length: 12 }, (_, index) => `result-${index + 1}`)}
        generationConfig={DEFAULT_GENERATION_CONFIG}
        isGenerating={false}
        isHydrating={false}
        onGenerate={vi.fn()}
        onTabChange={onTabChange}
        onTemperatureChange={onTemperatureChange}
        onToggleLike={onToggleLike}
        repoUrl="https://github.com/cpauldev/train-gpt-in-browser"
        workerReady={true}
      />,
    );

    expect(screen.getByText("result-1")).toBeTruthy();
    expect(screen.getByText("result-11")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^like result-1$/i }));

    expect(onToggleLike).toHaveBeenCalledWith("result-1");
  });

  it("disables generation while a run is actively training", () => {
    const trainingRun = {
      ...createRun(),
      status: "training" as const,
    };

    render(
      <RunPanel
        activeRun={trainingRun}
        activeTab="generated"
        displayedResults={[]}
        generationConfig={DEFAULT_GENERATION_CONFIG}
        isGenerating={false}
        isHydrating={false}
        onGenerate={vi.fn()}
        onTabChange={vi.fn()}
        onTemperatureChange={vi.fn()}
        onToggleLike={vi.fn()}
        repoUrl="https://github.com/cpauldev/train-gpt-in-browser"
        workerReady={true}
      />,
    );

    expect(screen.getByRole("button", { name: /training/i }).hasAttribute("disabled")).toBe(true);
  });

  it("shows a loading state while generation is in progress", () => {
    render(
      <RunPanel
        activeRun={createRun()}
        activeTab="generated"
        displayedResults={[]}
        generationConfig={DEFAULT_GENERATION_CONFIG}
        isGenerating
        isHydrating={false}
        onGenerate={vi.fn()}
        onTabChange={vi.fn()}
        onTemperatureChange={vi.fn()}
        onToggleLike={vi.fn()}
        repoUrl="https://github.com/cpauldev/train-gpt-in-browser"
        workerReady={true}
      />,
    );

    expect(screen.getByRole("button", { name: /generating/i }).hasAttribute("disabled")).toBe(true);
  });

  it("shows the empty no-run state when there is no active run", () => {
    render(
      <RunPanel
        activeRun={null}
        activeTab="generated"
        displayedResults={[]}
        generationConfig={DEFAULT_GENERATION_CONFIG}
        isGenerating={false}
        isHydrating={false}
        onGenerate={vi.fn()}
        onTabChange={vi.fn()}
        onTemperatureChange={vi.fn()}
        onToggleLike={vi.fn()}
        repoUrl="https://github.com/cpauldev/train-gpt-in-browser"
        workerReady={true}
      />,
    );

    expect(screen.getByText(/train gpt in browser/i)).toBeTruthy();
    expect(
      screen.getByText(/choose a dataset on the left, then start training to see results here/i),
    ).toBeTruthy();
  });
});
