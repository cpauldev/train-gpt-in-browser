import { describe, expect, it } from "vitest";
import type { TrainingTelemetryPoint } from "@/lib/trainer-types";
import {
  getLatestTrainingTelemetryElapsedSeconds,
  resolveTrainingTelemetryTimeline,
  shouldPersistTrainingTelemetry,
  TRAINING_TELEMETRY_PERSIST_INTERVAL_MS,
} from "@/lib/training-telemetry";

function createPoint(overrides?: Partial<TrainingTelemetryPoint>): TrainingTelemetryPoint {
  return {
    loss: 1.25,
    step: 10,
    stepsPerSecond: 3.5,
    time: 10,
    tokPerSecond: 256,
    totalSteps: 100,
    totalTokens: 512,
    ...overrides,
  };
}

describe("training-telemetry", () => {
  it("normalizes legacy wall-clock telemetry into cumulative elapsed training time", () => {
    const timeline = resolveTrainingTelemetryTimeline([
      createPoint({
        loss: 1.5,
        step: 100,
        stepsPerSecond: 20,
        time: 1_000,
        tokPerSecond: 2_560,
        totalTokens: 12_800,
      }),
      createPoint({
        loss: 1.25,
        step: 200,
        stepsPerSecond: 20,
        time: 4_600,
        tokPerSecond: 2_560,
        totalTokens: 25_600,
      }),
    ]);

    expect(timeline.map((point) => point.elapsedTimeSeconds)).toEqual([5, 10]);
  });

  it("preserves explicit elapsed training time for newer telemetry points", () => {
    const points = [
      createPoint({
        elapsedTimeSeconds: 12,
        step: 40,
        time: 1_000,
      }),
      createPoint({
        elapsedTimeSeconds: 18,
        step: 60,
        time: 5_000,
      }),
    ];

    expect(getLatestTrainingTelemetryElapsedSeconds(points)).toBe(18);
  });

  it("persists the first telemetry point for a run", () => {
    expect(shouldPersistTrainingTelemetry(undefined, createPoint())).toBe(true);
  });

  it("skips persistence until the telemetry interval elapses", () => {
    const lastPersistedAt = 10_000;
    const nextPoint = createPoint({
      time: (lastPersistedAt + TRAINING_TELEMETRY_PERSIST_INTERVAL_MS - 1) / 1000,
    });

    expect(shouldPersistTrainingTelemetry(lastPersistedAt, nextPoint)).toBe(false);
  });

  it("persists once the telemetry interval elapses", () => {
    const lastPersistedAt = 10_000;
    const nextPoint = createPoint({
      time: (lastPersistedAt + TRAINING_TELEMETRY_PERSIST_INTERVAL_MS) / 1000,
    });

    expect(shouldPersistTrainingTelemetry(lastPersistedAt, nextPoint)).toBe(true);
  });

  it("always persists the final telemetry point", () => {
    expect(
      shouldPersistTrainingTelemetry(
        10_000,
        createPoint({
          step: 100,
          time: 10.5,
          totalSteps: 100,
        }),
      ),
    ).toBe(true);
  });
});
