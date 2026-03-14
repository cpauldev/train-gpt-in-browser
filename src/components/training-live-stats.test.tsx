import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrainingLiveStats } from "@/components/training-live-stats";
import { DEFAULT_TRAINING_CONFIG } from "@/lib/trainer-defaults";
import type { TrainingRunRecord } from "@/lib/trainer-types";

let mockResolvedTheme: "light" | "dark" = "light";
let livelineMountCount = 0;

vi.mock("@/lib/app-theme", () => ({
  useAppTheme: () => ({
    preference: "system",
    resolvedTheme: mockResolvedTheme,
    resetPreference: vi.fn(),
    setPreference: vi.fn(),
  }),
}));

vi.mock("liveline", () => ({
  Liveline: ({
    color,
    data,
    formatTime,
    paused,
  }: {
    color: string;
    data: Array<{ time: number; value: number }>;
    formatTime?: (time: number) => string;
    paused?: boolean;
  }) => {
    const mountIdRef = useRef<number | null>(null);
    const pausedDataRef = useRef<Array<{ time: number; value: number }> | null>(null);
    if (mountIdRef.current === null) {
      mountIdRef.current = ++livelineMountCount;
    }
    if (paused && pausedDataRef.current === null && data.length >= 2) {
      pausedDataRef.current = data.slice();
    }
    if (!paused) {
      pausedDataRef.current = null;
    }
    const effectiveData = pausedDataRef.current ?? data;
    const series = effectiveData.map((point) => `${point.time}:${point.value}`).join("|");
    const latestTime = data.at(-1)?.time;
    const formattedTime =
      typeof latestTime === "number" && formatTime ? formatTime(latestTime) : "";
    return (
      <div data-mount-id={String(mountIdRef.current)} data-testid="liveline">
        {`${series}:${color}:${formattedTime}:${paused ? "paused" : "live"}`}
      </div>
    );
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

function parseLivelineTimes() {
  const text = screen.getByTestId("liveline").textContent ?? "";
  const [series] = text.split(":#");
  return series.split("|").map((entry) => Number(entry.split(":")[0]));
}

afterEach(() => {
  mockResolvedTheme = "light";
  livelineMountCount = 0;
});

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

  it("keeps the same completed-run timeline when switching metrics", async () => {
    const user = userEvent.setup();

    render(<TrainingLiveStats isTraining={false} run={createRun()} />);

    expect(screen.getByTestId("liveline").textContent).toContain("1:1.5|2:1.25:#eb6f36:0:02:paused");

    await user.click(screen.getByRole("button", { name: "Tokens/s" }));
    expect(screen.getByTestId("liveline").textContent).toContain(
      "1:128|2:256:#2f8f5b:0:02:paused",
    );

    await user.click(screen.getByRole("button", { name: "Steps/s" }));
    expect(screen.getByTestId("liveline").textContent).toContain(
      "1:2.5|2:3.25:#3a76f0:0:02:paused",
    );
  });

  it("preserves elapsed training time when switching metrics after a delay on a completed run", async () => {
    const user = userEvent.setup();
    render(<TrainingLiveStats isTraining={false} run={createRun()} />);
    expect(screen.getByTestId("liveline").textContent).toContain(":0:02:paused");

    await user.click(screen.getByRole("button", { name: "Tokens/s" }));
    expect(screen.getByTestId("liveline").textContent).toContain(":0:02:paused");
  });

  it("keeps the frozen chart timeline stable when the theme changes", () => {
    const run = createRun();

    mockResolvedTheme = "light";
    const { rerender } = render(<TrainingLiveStats isTraining={false} run={run} />);
    expect(screen.getByTestId("liveline").textContent).toContain(":#eb6f36:0:02:paused");

    mockResolvedTheme = "dark";
    rerender(<TrainingLiveStats isTraining={false} run={run} />);
    expect(screen.getByTestId("liveline").textContent).toContain(":#eb6f36:0:02:paused");
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

    expect(screen.getByTestId("liveline").textContent).toBe("15:1.5|20:1.25:#eb6f36:0:10:paused");
    dateNowSpy.mockRestore();
  });

  it("keeps the live chart anchored to elapsed training time", () => {
    const liveRun = createRun();
    liveRun.status = "training";
    liveRun.telemetry = [
      {
        elapsedTimeSeconds: 1,
        loss: 1.5,
        step: 1,
        stepsPerSecond: 2.5,
        time: 11,
        tokPerSecond: 128,
        totalSteps: 100,
        totalTokens: 32,
      },
      {
        elapsedTimeSeconds: 2,
        loss: 1.25,
        step: 2,
        stepsPerSecond: 3.25,
        time: 12,
        tokPerSecond: 256,
        totalSteps: 100,
        totalTokens: 64,
      },
      {
        elapsedTimeSeconds: 3,
        loss: 1.1,
        step: 3,
        stepsPerSecond: 3.1,
        time: 10_000,
        tokPerSecond: 320,
        totalSteps: 100,
        totalTokens: 96,
      },
    ];

    render(<TrainingLiveStats isTraining={true} run={liveRun} />);

    expect(parseLivelineTimes()).toEqual([9998, 9999, 10000]);
    expect(screen.getByTestId("liveline").textContent).toContain(":0:03:live");
  });

  it("keeps the same chart instance when switching time windows", async () => {
    const user = userEvent.setup();

    render(<TrainingLiveStats isTraining={false} run={createRun()} />);

    const chart = screen.getByTestId("liveline");
    const mountId = chart.getAttribute("data-mount-id");
    expect(mountId).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "5m" }));

    expect(screen.getByTestId("liveline").getAttribute("data-mount-id")).toBe(mountId);
  });

  it("keeps non-live timelines static", () => {
    const dateNowSpy = vi.spyOn(Date, "now");
    dateNowSpy.mockReturnValue(12_000);
    const incompleteRun = createRun();
    incompleteRun.status = "idle";
    incompleteRun.telemetry = [
      {
        elapsedTimeSeconds: 1,
        loss: 1.5,
        step: 1,
        stepsPerSecond: 2.5,
        time: 11,
        tokPerSecond: 128,
        totalSteps: 100,
        totalTokens: 32,
      },
      {
        elapsedTimeSeconds: 2,
        loss: 1.25,
        step: 2,
        stepsPerSecond: 3.25,
        time: 12,
        tokPerSecond: 256,
        totalSteps: 100,
        totalTokens: 64,
      },
    ];

    render(<TrainingLiveStats isTraining={false} run={incompleteRun} />);
    expect(parseLivelineTimes()).toEqual([11, 12]);
    expect(screen.getByTestId("liveline").textContent).toContain(":0:02:paused");
    dateNowSpy.mockRestore();
  });

  it("keeps the same chart instance while training state changes", () => {
    const queuedRun = createRun();
    queuedRun.status = "starting";
    queuedRun.telemetry = [
      {
        elapsedTimeSeconds: 1,
        loss: 1.5,
        step: 1,
        stepsPerSecond: 2.5,
        time: 11,
        tokPerSecond: 128,
        totalSteps: 100,
        totalTokens: 32,
      },
      {
        elapsedTimeSeconds: 2,
        loss: 1.25,
        step: 2,
        stepsPerSecond: 3.25,
        time: 12,
        tokPerSecond: 256,
        totalSteps: 100,
        totalTokens: 64,
      },
    ];

    const { rerender } = render(<TrainingLiveStats isTraining={true} run={queuedRun} />);
    const mountId = screen.getByTestId("liveline").getAttribute("data-mount-id");
    expect(mountId).toBeTruthy();

    rerender(<TrainingLiveStats isTraining={true} run={{ ...queuedRun, status: "training" }} />);
    expect(screen.getByTestId("liveline").getAttribute("data-mount-id")).toBe(mountId);
  });
});
