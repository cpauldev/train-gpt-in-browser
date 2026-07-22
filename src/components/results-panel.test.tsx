import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResultsPanel } from "@/components/results-panel";
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

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  if (originalMatchMedia) {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
      writable: true,
    });
    return;
  }

  Reflect.deleteProperty(window, "matchMedia");
});

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: query.includes("(max-width: 1023px)") ? matches : false,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    })),
    writable: true,
  });
}

describe("ResultsPanel", () => {
  it("renders generated results in the table layout", async () => {
    const onTemperatureChange = vi.fn();
    const onTabChange = vi.fn();
    const onToggleLike = vi.fn();

    render(
      <ResultsPanel
        activeRun={createRun()}
        activeTab="generated"
        displayedResults={Array.from({ length: 12 }, (_, index) => `result-${index + 1}`)}
        generationConfig={DEFAULT_GENERATION_CONFIG}
        isGenerating={false}
        onGenerate={vi.fn()}
        onTabChange={onTabChange}
        onTemperatureChange={onTemperatureChange}
        onToggleLike={onToggleLike}
      />,
    );

    expect(screen.getByText("result-1")).toBeTruthy();
    expect(screen.getByText("result-11")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^like result-1$/i }));

    expect(onToggleLike).toHaveBeenCalledWith("result-1");
  });

  it("uses the same toggle action for liking and removing likes", () => {
    const onToggleLike = vi.fn();
    const run = {
      ...createRun(),
      likes: ["result-1"],
    };

    const props = {
      activeRun: run,
      displayedResults: ["result-1"],
      generationConfig: DEFAULT_GENERATION_CONFIG,
      isGenerating: false,
      onGenerate: vi.fn(),
      onTabChange: vi.fn(),
      onTemperatureChange: vi.fn(),
      onToggleLike,
    };

    const { rerender } = render(<ResultsPanel {...props} activeTab="generated" />);

    fireEvent.click(screen.getByRole("button", { name: /^like result-1$/i }));

    rerender(<ResultsPanel {...props} activeTab="likes" />);
    fireEvent.click(screen.getByRole("button", { name: /^remove result-1 from likes$/i }));

    expect(onToggleLike).toHaveBeenNthCalledWith(1, "result-1");
    expect(onToggleLike).toHaveBeenNthCalledWith(2, "result-1");
  });

  it("disables generation while a run is actively training", () => {
    const trainingRun = {
      ...createRun(),
      status: "training" as const,
    };

    render(
      <ResultsPanel
        activeRun={trainingRun}
        activeTab="generated"
        displayedResults={[]}
        generationConfig={DEFAULT_GENERATION_CONFIG}
        isGenerating={false}
        onGenerate={vi.fn()}
        onTabChange={vi.fn()}
        onTemperatureChange={vi.fn()}
        onToggleLike={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /training/i }).hasAttribute("disabled")).toBe(true);
  });

  it("shows a loading state while generation is in progress", () => {
    render(
      <ResultsPanel
        activeRun={createRun()}
        activeTab="generated"
        displayedResults={[]}
        generationConfig={DEFAULT_GENERATION_CONFIG}
        isGenerating
        onGenerate={vi.fn()}
        onTabChange={vi.fn()}
        onTemperatureChange={vi.fn()}
        onToggleLike={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /generating/i }).hasAttribute("disabled")).toBe(true);
  });

  it("allows generation when the checkpoint is persisted but not mounted in state", () => {
    const persistedRun: TrainingRunRecord = {
      ...createRun(),
      checkpoint: undefined,
      checkpointSavedAt: Date.now(),
    };

    render(
      <ResultsPanel
        activeRun={persistedRun}
        activeTab="generated"
        displayedResults={[]}
        generationConfig={DEFAULT_GENERATION_CONFIG}
        isGenerating={false}
        onGenerate={vi.fn()}
        onTabChange={vi.fn()}
        onTemperatureChange={vi.fn()}
        onToggleLike={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /^generate$/i }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("labels the action as regenerate when the current temperature has results", () => {
    render(
      <ResultsPanel
        activeRun={createRun()}
        activeTab="generated"
        displayedResults={["alpha"]}
        generationConfig={DEFAULT_GENERATION_CONFIG}
        isGenerating={false}
        onGenerate={vi.fn()}
        onTabChange={vi.fn()}
        onTemperatureChange={vi.fn()}
        onToggleLike={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /^regenerate$/i }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("disables pending generated result rows until the sample finishes", () => {
    const onToggleLike = vi.fn();

    render(
      <ResultsPanel
        activeRun={createRun()}
        activeTab="generated"
        displayedResults={["al", "beta"]}
        generationConfig={DEFAULT_GENERATION_CONFIG}
        isGenerating
        onGenerate={vi.fn()}
        onTabChange={vi.fn()}
        onTemperatureChange={vi.fn()}
        onToggleLike={onToggleLike}
        pendingResultIndexes={new Set([0])}
      />,
    );

    const pendingButton = screen.getByRole("button", { name: /^like al$/i });
    const finishedButton = screen.getByRole("button", { name: /^like beta$/i });

    expect(pendingButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(pendingButton);
    fireEvent.click(finishedButton);

    expect(onToggleLike).toHaveBeenCalledOnce();
    expect(onToggleLike).toHaveBeenCalledWith("beta");
  });

  it("shows the empty no-run state when there is no active run", () => {
    render(
      <ResultsPanel
        activeRun={null}
        activeTab="generated"
        displayedResults={[]}
        generationConfig={DEFAULT_GENERATION_CONFIG}
        isGenerating={false}
        onGenerate={vi.fn()}
        onTabChange={vi.fn()}
        onTemperatureChange={vi.fn()}
        onToggleLike={vi.fn()}
      />,
    );

    expect(screen.getByText(/results/i)).toBeTruthy();
    expect(screen.getByText(/complete training first, then generate samples here/i)).toBeTruthy();
  });

  it("renders generated results as a single column on mobile", () => {
    mockMatchMedia(true);

    render(
      <ResultsPanel
        activeRun={createRun()}
        activeTab="generated"
        displayedResults={["alpha", "beta"]}
        generationConfig={DEFAULT_GENERATION_CONFIG}
        isGenerating={false}
        onGenerate={vi.fn()}
        onTabChange={vi.fn()}
        onTemperatureChange={vi.fn()}
        onToggleLike={vi.fn()}
      />,
    );

    expect(screen.getByText("alpha").closest("tr")?.textContent).toContain("alpha");
    expect(screen.getByText("alpha").closest("tr")?.textContent).not.toContain("beta");
    expect(screen.getByText("beta").closest("tr")?.textContent).toBe("beta");
  });
});
