import type { TrainingRunStatus } from "@/lib/trainer-types";

type WorkspaceRuntimeStatus = {
  dotClass: string;
  label: string;
  storageLabel: string;
  workerLabel: string;
};

export function getWorkspaceRuntimeStatus(
  hydrating: boolean,
  workerReady: boolean,
): WorkspaceRuntimeStatus {
  if (workerReady && !hydrating) {
    return {
      dotClass: "bg-green-500",
      label: "Runtime ready",
      storageLabel: "Ready",
      workerLabel: "Ready",
    };
  }

  if (workerReady) {
    return {
      dotClass: "bg-blue-500",
      label: "Loading data",
      storageLabel: "Loading",
      workerLabel: "Ready",
    };
  }

  return {
    dotClass: "bg-yellow-500",
    label: "Starting runtime",
    storageLabel: "Loading",
    workerLabel: "Starting",
  };
}

export function formatDurationSeconds(totalSeconds: number): string {
  const roundedSeconds = Math.round(totalSeconds);

  if (roundedSeconds < 60) {
    return `${roundedSeconds}s`;
  }

  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = roundedSeconds % 60;

  if (minutes < 60) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

export function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

export function formatLiveTrainingStatusLabel({
  step,
  totalSteps,
}: {
  step: number | undefined;
  totalSteps: number | undefined;
}) {
  if (typeof step !== "number" || typeof totalSteps !== "number") {
    return "Training...";
  }

  const boundedStep = Math.max(0, Math.min(Math.floor(step), Math.max(totalSteps, 0)));
  const progressSummary = formatTrainingProgressSummary(boundedStep, totalSteps);
  return step >= totalSteps
    ? `Finalizing ${progressSummary}`
    : `Training ${progressSummary}`;
}

export function formatTrainingRunStatusLabel(status: Exclude<TrainingRunStatus, "starting" | "training">) {
  switch (status) {
    case "completed":
      return "Completed";
    case "error":
      return "Error";
    case "idle":
      return "Idle";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function formatTrainingProgressSummary(step: number, totalSteps: number) {
  return `${formatStepCount(step)}/${formatStepCount(totalSteps)} (${formatTrainingProgressPercent(step, totalSteps)}%)`;
}

function formatTrainingProgressPercent(step: number, totalSteps: number) {
  return Math.min(100, Math.max(0, Math.round((step / Math.max(totalSteps, 1)) * 100)));
}

function formatStepCount(value: number) {
  return Math.max(0, Math.floor(value)).toLocaleString("en-US");
}
