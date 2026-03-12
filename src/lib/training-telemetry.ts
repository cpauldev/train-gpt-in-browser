import type { TrainingTelemetryPoint } from "@/lib/trainer-types";

const MAX_TELEMETRY_POINTS = 1200;

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
