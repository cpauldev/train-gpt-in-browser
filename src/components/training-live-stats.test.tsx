import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { TrainingLiveStats } from "@/components/training-live-stats";
import { DEFAULT_TRAINING_CONFIG } from "@/lib/trainer-defaults";
import type { TrainingRunRecord } from "@/lib/trainer-types";

vi.mock("@/lib/app-theme", () => ({
  useAppTheme: () => ({
    preference: "system",
    resolvedTheme: "light",
    resetPreference: vi.fn(),
    setPreference: vi.fn(),
  }),
}));

vi.mock("liveline", () => ({
  Liveline: ({
    color,
    data,
    formatTime,
  }: {
    color: string;
    data: Array<{ time: number; value: number }>;
    formatTime?: (time: number) => string;
  }) => {
    const [initialSeries] = useState(() =>
      data.map((point) => `${point.time}:${point.value}`).join("|"),
    );
    const latestTime = data.at(-1)?.time;
    const formattedTime =
      typeof latestTime === "number" && formatTime ? formatTime(latestTime) : "";
    return <div data-testid="liveline">{`${initialSeries}:${color}:${formattedTime}`}</div>;
  },
}));

function createRun(): TrainingRunRecord {
  return {
    createdAt: 1,
    datasetStats: {
      characterCount: 18,
      documentCount: 2,
      lineCount: 2,
      tokenCount: 12,
      vocabSize: 6,
    },
    fileId: "file-1",
    fileName: "ideas.txt",
    generatedResults: {},
    id: "run-1",
    likes: [],
    logs: [],
    name: "ideas",
    status: "completed",
    telemetry: [
      {
        loss: 1.5,
        step: 1,
        stepsPerSecond: 2.5,
        elapsedTimeSeconds: 1,
        time: 1,
        tokPerSecond: 128,
        totalSteps: 100,
        totalTokens: 32,
      },
      {
        loss: 1.25,
        step: 2,
        stepsPerSecond: 3.25,
        elapsedTimeSeconds: 2,
        time: 2,
        tokPerSecond: 256,
        totalSteps: 100,
        totalTokens: 64,
      },
    ],
    trainingConfig: DEFAULT_TRAINING_CONFIG,
    updatedAt: 2,
  };
}

describe("TrainingLiveStats", () => {
  it("shows dashes before any training history exists", () => {
    render(<TrainingLiveStats isTraining={false} run={null} />);

    expect(screen.getAllByText("—")).toHaveLength(4);
    expect(screen.getByText(/waiting to start/i)).toBeTruthy();
  });

  it("shows Tokens/s and Steps/s metric labels", () => {
    render(<TrainingLiveStats isTraining={false} run={createRun()} />);

    expect(screen.getByRole("button", { name: "Loss" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tokens/s" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Steps/s" })).toBeTruthy();
    expect(screen.getByText("2 / 100 (2%)")).toBeTruthy();
  });

  it("remounts the chart when switching metrics so completed runs show the correct series", async () => {
    const user = userEvent.setup();
    const dateNowSpy = vi.spyOn(Date, "now");
    dateNowSpy.mockReturnValue(12_000);

    render(<TrainingLiveStats isTraining={false} run={createRun()} />);

    expect(screen.getByTestId("liveline").textContent).toBe("11:1.5|12:1.25:#eb6f36:0:02");

    // Switching metrics re-anchors data to Date.now() so Liveline's fresh internal clock
    // (also initialized to Date.now()) matches the latest data point time.
    dateNowSpy.mockReturnValue(30_000);
    await user.click(screen.getByRole("button", { name: "Tokens/s" }));
    expect(screen.getByTestId("liveline").textContent).toBe("29:128|30:256:#2f8f5b:0:02");

    dateNowSpy.mockReturnValue(45_000);
    await user.click(screen.getByRole("button", { name: "Steps/s" }));
    expect(screen.getByTestId("liveline").textContent).toBe("44:2.5|45:3.25:#3a76f0:0:02");

    dateNowSpy.mockRestore();
  });

  it("preserves elapsed training time when switching metrics after a delay on a completed run", async () => {
    const user = userEvent.setup();
    const dateNowSpy = vi.spyOn(Date, "now");

    // Page loads 1 minute after training finished (the run still shows 2s of elapsed time).
    dateNowSpy.mockReturnValue(12_000);
    render(<TrainingLiveStats isTraining={false} run={createRun()} />);
    expect(screen.getByTestId("liveline").textContent).toBe("11:1.5|12:1.25:#eb6f36:0:02");

    // Wait another minute, then switch metrics. Without the fix, Liveline would remount
    // with its internal clock at Date.now() = 72s while data was still anchored to 12s,
    // making the right edge of the chart show "1:02" (62 extra seconds) instead of "0:02".
    dateNowSpy.mockReturnValue(72_000);
    await user.click(screen.getByRole("button", { name: "Tokens/s" }));

    // Data point times must be re-anchored to the new Date.now() (72s) so Liveline's
    // fresh clock matches the latest point and the elapsed timer stays correct.
    expect(screen.getByTestId("liveline").textContent).toBe("71:128|72:256:#2f8f5b:0:02");

    dateNowSpy.mockRestore();
  });

  it("uses cumulative elapsed training time instead of wall-clock gaps", () => {
    const run = createRun();
    const dateNowSpy = vi.spyOn(Date, "now");
    dateNowSpy.mockReturnValue(20_000);
    run.telemetry = [
      {
        loss: 1.5,
        step: 100,
        stepsPerSecond: 20,
        time: 1_000,
        tokPerSecond: 2_560,
        totalSteps: 200,
        totalTokens: 12_800,
      },
      {
        loss: 1.25,
        step: 200,
        stepsPerSecond: 20,
        time: 4_600,
        tokPerSecond: 2_560,
        totalSteps: 200,
        totalTokens: 25_600,
      },
    ];

    render(<TrainingLiveStats isTraining={false} run={run} />);

    expect(screen.getByTestId("liveline").textContent).toBe("15:1.5|20:1.25:#eb6f36:0:10");
    dateNowSpy.mockRestore();
  });
});
