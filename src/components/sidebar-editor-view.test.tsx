import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SidebarEditorView } from "@/components/sidebar-editor-view";
import { DEFAULT_GENERATION_CONFIG, DEFAULT_TRAINING_CONFIG } from "@/lib/trainer-defaults";
import type { TrainingRunRecord, WorkspaceFile } from "@/lib/trainer-types";

vi.mock("liveline", () => ({
  Liveline: ({
    emptyText,
    loading,
    value,
  }: {
    emptyText?: string;
    loading?: boolean;
    value: number;
  }) => (
    <div data-testid="liveline">{loading ? "loading" : `${emptyText ?? "chart"} ${value}`}</div>
  ),
}));

const selectedFile: WorkspaceFile = {
  content: "alpha\nbeta\n",
  createdAt: Date.now(),
  id: "file-1",
  name: "ideas.txt",
  source: "user",
  updatedAt: Date.now(),
};

function createRun(): TrainingRunRecord {
  return {
    checkpoint: {
      datasetData: new Int32Array([1, 2, 3]),
      datasetStats: {
        characterCount: 9,
        documentCount: 2,
        lineCount: 2,
        tokenCount: 11,
        vocabSize: 8,
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
      vocabSize: 8,
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

describe("SidebarEditorView", () => {
  it("supports back navigation and editing", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onDeleteFile = vi.fn();
    const onDeleteModel = vi.fn();
    const onDownloadModel = vi.fn();
    const onDraftContentChange = vi.fn();
    const onDraftNameChange = vi.fn();
    const onGenerationConfigChange = vi.fn();
    const onResumeTraining = vi.fn();
    const onStartTraining = vi.fn().mockResolvedValue(undefined);
    const onTrainingConfigChange = vi.fn();

    render(
      <SidebarEditorView
        canTrain
        draftContent={selectedFile.content}
        draftName={selectedFile.name}
        generationConfig={DEFAULT_GENERATION_CONFIG}
        isTraining={false}
        onBack={onBack}
        onResetLocalData={vi.fn()}
        onDeleteFile={onDeleteFile}
        onDeleteModel={onDeleteModel}
        onDownloadModel={onDownloadModel}
        onDraftContentChange={onDraftContentChange}
        onDraftNameChange={onDraftNameChange}
        onGenerationConfigChange={onGenerationConfigChange}
        onResumeTraining={onResumeTraining}
        onStartTraining={onStartTraining}
        onTrainingConfigChange={onTrainingConfigChange}
        selectedFile={selectedFile}
        selectedFileSummary={{
          characterCount: 9,
          documents: ["alpha", "beta"],
          lineCount: 2,
          tokenCount: 11,
          vocabSize: 8,
        }}
        selectedRun={createRun()}
        trainingConfig={DEFAULT_TRAINING_CONFIG}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    fireEvent.change(screen.getByDisplayValue("ideas.txt"), {
      target: { value: "renamed.txt" },
    });
    fireEvent.click(screen.getByRole("button", { name: /download model/i }));
    fireEvent.click(screen.getByRole("button", { name: /delete model/i }));
    await user.click(screen.getByRole("tab", { name: /source/i }));
    expect(screen.getByRole("textbox", { name: /source text/i })).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: /training/i }));
    expect(screen.getByText(/live stats/i)).toBeTruthy();
    expect(screen.getByTestId("liveline")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /continue training/i }));
    fireEvent.click(screen.getByRole("tab", { name: /overview/i }));
    fireEvent.click(screen.getByRole("button", { name: /delete file/i }));

    expect(onBack).toHaveBeenCalledOnce();
    expect(onDraftNameChange).toHaveBeenCalledWith("renamed.txt");
    expect(onStartTraining).not.toHaveBeenCalled();
    expect(onResumeTraining).toHaveBeenCalledOnce();
    expect(onDownloadModel).toHaveBeenCalledOnce();
    expect(onDeleteModel).toHaveBeenCalledOnce();
    expect(onDeleteFile).toHaveBeenCalledOnce();
  });

  it("locks the file name for built-in datasets", () => {
    render(
      <SidebarEditorView
        canTrain
        draftContent={selectedFile.content}
        draftName="english_words.txt"
        generationConfig={DEFAULT_GENERATION_CONFIG}
        isTraining={false}
        onBack={vi.fn()}
        onResetLocalData={vi.fn()}
        onDraftContentChange={vi.fn()}
        onDraftNameChange={vi.fn()}
        onGenerationConfigChange={vi.fn()}
        onStartTraining={vi.fn().mockResolvedValue(undefined)}
        onTrainingConfigChange={vi.fn()}
        selectedFile={{ ...selectedFile, name: "english_words.txt", source: "builtin" }}
        selectedFileSummary={{
          characterCount: 9,
          documents: ["alpha", "beta"],
          lineCount: 2,
          tokenCount: 11,
          vocabSize: 8,
        }}
        selectedRun={null}
        trainingConfig={DEFAULT_TRAINING_CONFIG}
      />,
    );

    expect(screen.getByDisplayValue("english_words.txt").hasAttribute("disabled")).toBe(true);
  });

  it("opens the live training stats automatically when the selected run starts training", async () => {
    const initialRun = createRun();
    const trainingRun: TrainingRunRecord = {
      ...initialRun,
      telemetry: [
        {
          loss: 1.2345,
          step: 1,
          stepsPerSecond: 2.5,
          time: Date.now() / 1000,
          tokPerSecond: 128,
          totalSteps: 100,
          totalTokens: 16,
        },
      ],
      status: "training",
    };

    const { rerender } = render(
      <SidebarEditorView
        canTrain
        draftContent={selectedFile.content}
        draftName={selectedFile.name}
        generationConfig={DEFAULT_GENERATION_CONFIG}
        isTraining={false}
        onBack={vi.fn()}
        onResetLocalData={vi.fn()}
        onDraftContentChange={vi.fn()}
        onDraftNameChange={vi.fn()}
        onGenerationConfigChange={vi.fn()}
        onResumeTraining={vi.fn()}
        onStartTraining={vi.fn().mockResolvedValue(undefined)}
        onTrainingConfigChange={vi.fn()}
        selectedFile={selectedFile}
        selectedFileSummary={{
          characterCount: 9,
          documents: ["alpha", "beta"],
          lineCount: 2,
          tokenCount: 11,
          vocabSize: 8,
        }}
        selectedRun={initialRun}
        trainingConfig={DEFAULT_TRAINING_CONFIG}
      />,
    );

    rerender(
      <SidebarEditorView
        canTrain
        draftContent={selectedFile.content}
        draftName={selectedFile.name}
        generationConfig={DEFAULT_GENERATION_CONFIG}
        isTraining
        onBack={vi.fn()}
        onResetLocalData={vi.fn()}
        onDraftContentChange={vi.fn()}
        onDraftNameChange={vi.fn()}
        onGenerationConfigChange={vi.fn()}
        onResumeTraining={vi.fn()}
        onStartTraining={vi.fn().mockResolvedValue(undefined)}
        onTrainingConfigChange={vi.fn()}
        selectedFile={selectedFile}
        selectedFileSummary={{
          characterCount: 9,
          documents: ["alpha", "beta"],
          lineCount: 2,
          tokenCount: 11,
          vocabSize: 8,
        }}
        selectedRun={trainingRun}
        trainingConfig={DEFAULT_TRAINING_CONFIG}
      />,
    );

    expect(screen.getByText(/live stats/i)).toBeTruthy();
    expect(screen.getByText(/^progress$/i)).toBeTruthy();
    expect(screen.getByText(/1 \/ 100/i)).toBeTruthy();
  });
});
