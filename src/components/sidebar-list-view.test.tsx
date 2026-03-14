import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SidebarListView } from "@/components/sidebar-list-view";
import { DEFAULT_TRAINING_CONFIG } from "@/lib/trainer-defaults";
import type { TrainingRunRecord, WorkspaceFile } from "@/lib/trainer-types";

function createFile(overrides: Partial<WorkspaceFile> = {}): WorkspaceFile {
  return {
    content: "alpha\nbeta\n",
    createdAt: Date.now(),
    id: "file-1",
    name: "ideas.txt",
    source: "user",
    updatedAt: Date.now(),
    ...overrides,
  };
}

function createRun(overrides: Partial<TrainingRunRecord> = {}): TrainingRunRecord {
  return {
    checkpoint: {
      datasetData: new Int32Array([1, 2, 3]),
      datasetStats: {
        characterCount: 9,
        documentCount: 2,
        lineCount: 2,
        tokenCount: 11,
        vocabSize: 7,
      },
      exportedAt: Date.now(),
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
        completedSteps: 1,
        finalLoss: 1,
        lastSavedAt: Date.now(),
        totalTokens: 16,
      },
      rngState: 42,
      sourceFilter: {
        bitCount: 8,
        bits: new Uint8Array(1),
        falsePositiveRate: 1e-4,
        hashCount: 1,
        itemCount: 2,
        kind: "bloom",
        version: 1,
      },
      tokenizer: {
        blockSize: 4,
        bosId: 2,
        idToChar: ["a", "b"],
        vocabSize: 3,
      },
      trainingConfig: DEFAULT_TRAINING_CONFIG,
      weights: [],
    },
    createdAt: Date.now(),
    datasetStats: {
      characterCount: 9,
      documentCount: 2,
      lineCount: 2,
      tokenCount: 11,
      vocabSize: 7,
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
    ...overrides,
  };
}

describe("SidebarListView", () => {
  it("routes dataset create, upload, and open actions from the merged list", () => {
    const onCreateFile = vi.fn();
    const onImportClick = vi.fn();
    const onOpenFile = vi.fn().mockResolvedValue(undefined);
    const file = createFile();
    const run = createRun();

    render(
      <SidebarListView
        files={[file]}
        isHydrating={false}
        onCreateFile={onCreateFile}
        onResetLocalData={vi.fn()}
        onImportClick={onImportClick}
        onOpenFile={onOpenFile}
        runs={[run]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /new dataset/i }));
    fireEvent.click(screen.getByRole("button", { name: /upload files/i }));
    fireEvent.click(screen.getByRole("button", { name: /ideas\.txt/i }));

    expect(onCreateFile).toHaveBeenCalledOnce();
    expect(onImportClick).toHaveBeenCalledOnce();
    expect(onOpenFile).toHaveBeenCalledWith(file);
    expect(screen.getByText(/custom local dataset/i)).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
  });

  it("title-cases non-live status badges", () => {
    render(
      <SidebarListView
        files={[createFile()]}
        isHydrating={false}
        onCreateFile={vi.fn()}
        onResetLocalData={vi.fn()}
        onImportClick={vi.fn()}
        onOpenFile={vi.fn().mockResolvedValue(undefined)}
        runs={[createRun({ status: "idle" })]}
      />,
    );

    expect(screen.getByText("Idle")).toBeTruthy();
  });

  it("shows the empty dataset state when there are no files", () => {
    render(
      <SidebarListView
        files={[]}
        isHydrating={false}
        onCreateFile={vi.fn()}
        onResetLocalData={vi.fn()}
        onImportClick={vi.fn()}
        onOpenFile={vi.fn().mockResolvedValue(undefined)}
        runs={[]}
      />,
    );

    expect(screen.getByText(/no datasets yet/i)).toBeTruthy();
    expect(
      screen.getByText(/create a local dataset or upload a plain-text file to get started/i),
    ).toBeTruthy();
  });

  it("shows a centered loading state while hydration is in progress", () => {
    render(
      <SidebarListView
        files={[]}
        isHydrating
        onCreateFile={vi.fn()}
        onResetLocalData={vi.fn()}
        onImportClick={vi.fn()}
        onOpenFile={vi.fn().mockResolvedValue(undefined)}
        runs={[]}
      />,
    );

    expect(screen.getByText(/loading local data/i)).toBeTruthy();
    expect(screen.getByText(/loading datasets and saved runs from this browser/i)).toBeTruthy();
  });

  it("shows live training progress in the dataset badge while a run is active", () => {
    render(
      <SidebarListView
        files={[createFile()]}
        isHydrating={false}
        onCreateFile={vi.fn()}
        onResetLocalData={vi.fn()}
        onImportClick={vi.fn()}
        onOpenFile={vi.fn().mockResolvedValue(undefined)}
        runs={[
          createRun({
            status: "training",
            telemetry: [
              {
                elapsedTimeSeconds: 12,
                loss: 1.2345,
                step: 420,
                stepsPerSecond: 3.5,
                time: 12,
                tokPerSecond: 256,
                totalSteps: 3_000,
                totalTokens: 1_024,
              },
            ],
          }),
        ]}
      />,
    );

    expect(screen.getByText("Training 420/3,000 (14%)")).toBeTruthy();
  });

  it("shows a preparing badge before training telemetry starts", () => {
    render(
      <SidebarListView
        files={[createFile()]}
        isHydrating={false}
        onCreateFile={vi.fn()}
        onResetLocalData={vi.fn()}
        onImportClick={vi.fn()}
        onOpenFile={vi.fn().mockResolvedValue(undefined)}
        runs={[
          createRun({
            status: "starting",
            telemetry: [],
          }),
        ]}
      />,
    );

    expect(screen.getByText("Preparing...")).toBeTruthy();
  });
});
