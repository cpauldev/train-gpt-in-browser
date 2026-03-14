import { createLogEntry } from "@/lib/trainer-core";
import type { TrainingRunRecord, WorkspaceFile } from "@/lib/trainer-types";

type RestoredTrainerSelection = {
  activeRunId: string | null;
  selectedFileId: string | null;
};

export function appendLogs(current: TrainingRunRecord["logs"], entries: TrainingRunRecord["logs"]) {
  return [...current, ...entries];
}

export function replaceGeneratedResultsForTemperature(
  current: TrainingRunRecord["generatedResults"],
  temperatureKey: string,
  nextResults: string[],
) {
  return {
    ...current,
    [temperatureKey]: [...nextResults],
  };
}

export function sortRunsByRecent(runs: TrainingRunRecord[]) {
  return [...runs].sort((left, right) => right.updatedAt - left.updatedAt);
}

export function mergeRunIntoCollection(
  currentRuns: TrainingRunRecord[],
  nextRun: TrainingRunRecord,
) {
  const duplicateRuns = currentRuns.filter(
    (run) => run.fileId === nextRun.fileId && run.id !== nextRun.id,
  );
  const nextRuns = sortRunsByRecent([
    nextRun,
    ...currentRuns.filter((run) => run.id !== nextRun.id && run.fileId !== nextRun.fileId),
  ]);

  return {
    duplicateRuns,
    nextRuns,
  };
}

export function dedupeRunsByFileId(runs: TrainingRunRecord[]) {
  const keptRuns = new Map<string, TrainingRunRecord>();
  const duplicateRunIds: string[] = [];

  for (const run of sortRunsByRecent(runs)) {
    if (!keptRuns.has(run.fileId)) {
      keptRuns.set(run.fileId, run);
      continue;
    }

    duplicateRunIds.push(run.id);
  }

  return {
    duplicateRunIds,
    nextRuns: sortRunsByRecent([...keptRuns.values()]),
  };
}

export function reconcileInterruptedRuns(runs: TrainingRunRecord[], updatedAt = Date.now()) {
  let interruptedRunCount = 0;
  const updatedRuns: TrainingRunRecord[] = [];

  const nextRuns = runs.map((run) => {
    if (run.status !== "starting" && run.status !== "training") {
      return run;
    }

    interruptedRunCount += 1;
    const message = run.checkpoint
      ? "Browser session ended before training completed. Resume this run to continue from the latest checkpoint."
      : "Browser session ended before the first checkpoint was saved. Start training again to recreate this run.";
    const nextRun: TrainingRunRecord = {
      ...run,
      lastError: run.checkpoint ? run.lastError : message,
      logs: appendLogs(run.logs, [createLogEntry(message, run.checkpoint ? "line" : "error")]),
      status: run.checkpoint ? "idle" : "error",
      updatedAt,
    };

    updatedRuns.push(nextRun);
    return nextRun;
  });

  return {
    interruptedRunCount,
    nextRuns: sortRunsByRecent(nextRuns),
    updatedRuns,
  };
}

export function resolveRestoredSelection({
  activeFileId,
  activeRunId,
  files,
  runs,
}: {
  activeFileId: string | null;
  activeRunId: string | null;
  files: WorkspaceFile[];
  runs: TrainingRunRecord[];
}): RestoredTrainerSelection {
  const activeRun = runs.find((run) => run.id === activeRunId) ?? null;
  const selectedFileFromRun = activeRun
    ? (files.find((file) => file.id === activeRun.fileId)?.id ?? null)
    : null;

  if (activeRun && selectedFileFromRun) {
    return {
      activeRunId: activeRun.id,
      selectedFileId: selectedFileFromRun,
    };
  }

  const selectedFile = files.find((file) => file.id === activeFileId) ?? null;

  return {
    activeRunId: null,
    selectedFileId: selectedFile?.id ?? null,
  };
}
