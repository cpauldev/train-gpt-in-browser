import type { TrainingTelemetryPoint } from "@/lib/trainer-types";

const MAX_TELEMETRY_POINTS = 1200;
export const TRAINING_TELEMETRY_PERSIST_INTERVAL_MS = 2_000;

export function appendTrainingTelemetryPoint(
  current: TrainingTelemetryPoint[],
  nextPoint: TrainingTelemetryPoint,
) {
  const lastPoint = current.at(-1);

  if (
    lastPoint &&
    lastPoint.step === nextPoint.step &&
    lastPoint.time === nextPoint.time &&
    lastPoint.totalTokens === nextPoint.totalTokens
  ) {
    return [...current.slice(0, -1), nextPoint];
  }

  const nextPoints = [...current, nextPoint];
  return nextPoints.slice(-MAX_TELEMETRY_POINTS);
}

export function getLatestTrainingTelemetry(points: TrainingTelemetryPoint[]) {
  return points.at(-1) ?? null;
}

export function resolveTrainingTelemetryTimeline(points: TrainingTelemetryPoint[]) {
  let previousPoint: TrainingTelemetryPoint | null = null;
  let previousElapsedSeconds = 0;

  return points.map((point) => {
    const explicitElapsedSeconds = normalizeElapsedSeconds(point.elapsedTimeSeconds);

    if (explicitElapsedSeconds !== null) {
      previousPoint = point;
      previousElapsedSeconds = Math.max(previousElapsedSeconds, explicitElapsedSeconds);
      return previousElapsedSeconds === point.elapsedTimeSeconds
        ? point
        : { ...point, elapsedTimeSeconds: previousElapsedSeconds };
    }

    const stepDelta = Math.max(0, point.step - (previousPoint?.step ?? 0));
    const tokenDelta = Math.max(0, point.totalTokens - (previousPoint?.totalTokens ?? 0));
    const estimatedElapsedSeconds = estimateElapsedSeconds({
      stepDelta,
      stepsPerSecond: point.stepsPerSecond,
      tokPerSecond: point.tokPerSecond,
      tokenDelta,
    });
    const nextElapsedSeconds = previousElapsedSeconds + (estimatedElapsedSeconds ?? 0);

    previousPoint = point;
    previousElapsedSeconds = nextElapsedSeconds;
    return { ...point, elapsedTimeSeconds: nextElapsedSeconds };
  });
}

export function getLatestTrainingTelemetryElapsedSeconds(points: TrainingTelemetryPoint[]) {
  return resolveTrainingTelemetryTimeline(points).at(-1)?.elapsedTimeSeconds ?? 0;
}

export function shouldPersistTrainingTelemetry(
  lastPersistedAt: number | undefined,
  nextPoint: TrainingTelemetryPoint,
) {
  if (nextPoint.step >= nextPoint.totalSteps) {
    return true;
  }

  if (typeof lastPersistedAt !== "number") {
    return true;
  }

  const nextUpdatedAt = Math.max(0, Math.round(nextPoint.time * 1000));
  return nextUpdatedAt - lastPersistedAt >= TRAINING_TELEMETRY_PERSIST_INTERVAL_MS;
}

function normalizeElapsedSeconds(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, value);
}

function estimateElapsedSeconds({
  stepDelta,
  stepsPerSecond,
  tokPerSecond,
  tokenDelta,
}: {
  stepDelta: number;
  stepsPerSecond: number;
  tokPerSecond: number;
  tokenDelta: number;
}) {
  const fromSteps =
    stepDelta > 0 && Number.isFinite(stepsPerSecond) && stepsPerSecond > 0
      ? stepDelta / stepsPerSecond
      : null;
  const fromTokens =
    tokenDelta > 0 && Number.isFinite(tokPerSecond) && tokPerSecond > 0
      ? tokenDelta / tokPerSecond
      : null;

  return fromSteps ?? fromTokens;
}
