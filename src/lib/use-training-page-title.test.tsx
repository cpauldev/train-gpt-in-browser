import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TRAINING_CONFIG } from "@/lib/trainer-defaults";
import type { TrainingRunRecord, TrainingTelemetryPoint } from "@/lib/trainer-types";
import {
  APP_PAGE_TITLE,
  TRAINING_PAGE_TITLE_RESET_DELAY_MS,
  useTrainingPageTitle,
} from "@/lib/use-training-page-title";

const DEFAULT_TITLE = APP_PAGE_TITLE;

function Harness({ fileTitle, run }: { fileTitle?: string; run: TrainingRunRecord | null }) {
  useTrainingPageTitle({ fileTitle, run });
  return null;
}

function createTelemetryPoint({
  step,
  totalSteps = 100,
}: {
  step: number;
  totalSteps?: number;
}): TrainingTelemetryPoint {
  return {
    loss: 1.2345,
    step,
    stepsPerSecond: 2.5,
    time: step,
    tokPerSecond: 256,
    totalSteps,
    totalTokens: step * 128,
  };
}

function createRun({
  id = "run-1",
  status = "completed",
  telemetry = [],
}: Partial<TrainingRunRecord> = {}): TrainingRunRecord {
  return {
    createdAt: 1,
    datasetStats: {
      characterCount: 32,
      documentCount: 4,
      lineCount: 4,
      tokenCount: 36,
      vocabSize: 12,
    },
    fileId: "file-1",
    fileName: "english_words.txt",
    generatedResults: {},
    id,
    likes: [],
    logs: [],
    name: "english_words",
    status,
    telemetry,
    trainingConfig: DEFAULT_TRAINING_CONFIG,
    updatedAt: 1,
  };
}

describe("use-training-page-title", () => {
  beforeEach(() => {
    document.title = DEFAULT_TITLE;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows live progress while training is running", () => {
    render(
      <Harness
        fileTitle="English Words"
        run={createRun({
          status: "training",
          telemetry: [createTelemetryPoint({ step: 42 })],
        })}
      />,
    );

    expect(document.title).toBe(`Training 42% • English Words • ${DEFAULT_TITLE}`);
  });

  it("shows a preparing title before live telemetry begins", () => {
    render(
      <Harness
        fileTitle="English Words"
        run={createRun({
          status: "starting",
          telemetry: [],
        })}
      />,
    );

    expect(document.title).toBe(`Preparing training • English Words • ${DEFAULT_TITLE}`);
  });

  it("shows a completion title briefly, then restores the default title", () => {
    vi.useFakeTimers();

    const { rerender } = render(
      <Harness
        fileTitle="English Words"
        run={createRun({
          status: "training",
          telemetry: [createTelemetryPoint({ step: 100 })],
        })}
      />,
    );

    expect(document.title).toBe(`Finalizing 100% • English Words • ${DEFAULT_TITLE}`);

    rerender(
      <Harness
        fileTitle="English Words"
        run={createRun({
          status: "completed",
          telemetry: [createTelemetryPoint({ step: 100 })],
        })}
      />,
    );

    expect(document.title).toBe(`Training complete • English Words • ${DEFAULT_TITLE}`);

    rerender(
      <Harness
        fileTitle="English Words"
        run={createRun({
          status: "completed",
          telemetry: [createTelemetryPoint({ step: 100 })],
          updatedAt: 2,
        })}
      />,
    );

    expect(document.title).toBe(`Training complete • English Words • ${DEFAULT_TITLE}`);

    act(() => {
      vi.advanceTimersByTime(TRAINING_PAGE_TITLE_RESET_DELAY_MS - 1);
    });

    expect(document.title).toBe(`Training complete • English Words • ${DEFAULT_TITLE}`);

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(document.title).toBe(`English Words • ${DEFAULT_TITLE}`);
  });

  it("shows the selected dataset title when idle", () => {
    render(
      <Harness
        fileTitle="English Words"
        run={createRun({
          status: "completed",
        })}
      />,
    );

    expect(document.title).toBe(`English Words • ${DEFAULT_TITLE}`);
  });

  it("falls back to the app title when no dataset is selected", () => {
    render(<Harness run={null} />);

    expect(document.title).toBe(DEFAULT_TITLE);
  });
});
