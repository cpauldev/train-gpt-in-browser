export type WorkspaceRuntimeStatus = {
  badgeVariant: "info" | "success" | "warning";
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
      badgeVariant: "success",
      dotClass: "bg-green-500",
      label: "Runtime ready",
      storageLabel: "Ready",
      workerLabel: "Ready",
    };
  }

  if (workerReady) {
    return {
      badgeVariant: "info",
      dotClass: "bg-blue-500",
      label: "Loading data",
      storageLabel: "Loading",
      workerLabel: "Ready",
    };
  }

  return {
    badgeVariant: "warning",
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
