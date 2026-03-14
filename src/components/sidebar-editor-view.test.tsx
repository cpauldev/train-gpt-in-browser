import { fireEvent, render, screen, within } from "@testing-library/react";
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
          documentCount: 2,
          lineCount: 2,
          tokenCount: 11,
          vocabSize: 8,
        }}
        selectedRun={createRun()}
        trainingConfig={DEFAULT_TRAINING_CONFIG}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    await user.click(screen.getByRole("tab", { name: /details/i }));
    fireEvent.change(screen.getByDisplayValue("ideas.txt"), {
      target: { value: "renamed.txt" },
    });
    fireEvent.click(screen.getByRole("button", { name: /download model/i }));
    fireEvent.click(screen.getByRole("button", { name: /delete model/i }));
    await user.click(screen.getByRole("tab", { name: /source/i }));
    expect(await screen.findByRole("textbox", { name: /source text/i })).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: /training/i }));
    expect(await screen.findByText(/live stats/i)).toBeTruthy();
    expect(await screen.findByTestId("liveline")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /continue training/i }));
    fireEvent.click(screen.getByRole("tab", { name: /details/i }));
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
          documentCount: 2,
          lineCount: 2,
          tokenCount: 11,
          vocabSize: 8,
        }}
        selectedRun={null}
        trainingConfig={DEFAULT_TRAINING_CONFIG}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /details/i }));
    expect(screen.getByDisplayValue("english_words.txt").hasAttribute("disabled")).toBe(true);
  });

  it("keeps the download button enabled when only checkpointSavedAt is present", () => {
    const persistedRun: TrainingRunRecord = {
      ...createRun(),
      checkpoint: undefined,
      checkpointSavedAt: Date.now(),
    };
    const onEnsureRunDetails = vi.fn().mockResolvedValue(undefined);

    render(
      <SidebarEditorView
        canTrain
        draftContent={selectedFile.content}
        draftName={selectedFile.name}
        generationConfig={DEFAULT_GENERATION_CONFIG}
        isTraining={false}
        onBack={vi.fn()}
        onResetLocalData={vi.fn()}
        onDownloadModel={vi.fn()}
        onEnsureRunDetails={onEnsureRunDetails}
        onDraftContentChange={vi.fn()}
        onDraftNameChange={vi.fn()}
        onGenerationConfigChange={vi.fn()}
        onStartTraining={vi.fn().mockResolvedValue(undefined)}
        onTrainingConfigChange={vi.fn()}
        selectedFile={selectedFile}
        selectedFileSummary={{
          characterCount: 9,
          documentCount: 2,
          lineCount: 2,
          tokenCount: 11,
          vocabSize: 8,
        }}
        selectedRun={persistedRun}
        trainingConfig={DEFAULT_TRAINING_CONFIG}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /details/i }));
    expect(screen.getByRole("button", { name: /download model/i }).hasAttribute("disabled")).toBe(
      false,
    );
    expect(onEnsureRunDetails).toHaveBeenCalledOnce();
  });

  it("ignores invalid numeric input instead of writing NaN into training config", async () => {
    const user = userEvent.setup();
    const onTrainingConfigChange = vi.fn();

    render(
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
        onStartTraining={vi.fn().mockResolvedValue(undefined)}
        onTrainingConfigChange={onTrainingConfigChange}
        selectedFile={selectedFile}
        selectedFileSummary={{
          characterCount: 9,
          documentCount: 2,
          lineCount: 2,
          tokenCount: 11,
          vocabSize: 8,
        }}
        selectedRun={createRun()}
        trainingConfig={DEFAULT_TRAINING_CONFIG}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /training/i }));
    await user.click(screen.getByLabelText(/toggle training controls/i));
    fireEvent.change(screen.getByDisplayValue(String(DEFAULT_TRAINING_CONFIG.seed)), {
      target: { value: "-" },
    });

    expect(onTrainingConfigChange).not.toHaveBeenCalled();
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
          documentCount: 2,
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
          documentCount: 2,
          lineCount: 2,
          tokenCount: 11,
          vocabSize: 8,
        }}
        selectedRun={trainingRun}
        trainingConfig={DEFAULT_TRAINING_CONFIG}
      />,
    );

    expect(await screen.findByText(/live stats/i)).toBeTruthy();
    expect(await screen.findByText(/^progress$/i)).toBeTruthy();
    expect(await screen.findByText(/1 \/ 100/i)).toBeTruthy();
  });

  it("shows a finalizing label once telemetry reaches 100 percent", () => {
    const finalizingRun: TrainingRunRecord = {
      ...createRun(),
      status: "training",
      telemetry: [
        {
          loss: 1.2345,
          step: 100,
          stepsPerSecond: 2.5,
          time: Date.now() / 1000,
          tokPerSecond: 128,
          totalSteps: 100,
          totalTokens: 1600,
        },
      ],
    };

    render(
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
          documentCount: 2,
          lineCount: 2,
          tokenCount: 11,
          vocabSize: 8,
        }}
        selectedRun={finalizingRun}
        trainingConfig={DEFAULT_TRAINING_CONFIG}
      />,
    );

    expect(screen.getByRole("button", { name: /finalizing results/i })).toBeTruthy();
  });

  it("shows a preparing label before the first telemetry sample arrives", () => {
    const startingRun: TrainingRunRecord = {
      ...createRun(),
      status: "starting",
      telemetry: [],
    };

    render(
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
          documentCount: 2,
          lineCount: 2,
          tokenCount: 11,
          vocabSize: 8,
        }}
        selectedRun={startingRun}
        trainingConfig={DEFAULT_TRAINING_CONFIG}
      />,
    );

    const trainingButton = screen.getByRole("button", { name: /training in progress/i });

    expect(trainingButton).toBeTruthy();
    expect(within(trainingButton).getByText("Preparing...")).toBeTruthy();
  });
});
