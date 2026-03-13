import { type MutableRefObject, useEffect, useMemo, useRef } from "react";
import type { TrainingRunRecord } from "@/lib/trainer-types";
import { getLatestTrainingTelemetry } from "@/lib/training-telemetry";

export const TRAINING_PAGE_TITLE_RESET_DELAY_MS = 3_500;

export function useTrainingPageTitle({
  fileTitle,
  run,
}: {
  fileTitle?: string;
  run: TrainingRunRecord | null;
}) {
  const defaultTitleRef = useRef(typeof document === "undefined" ? "" : document.title);
  const completionHoldRunIdRef = useRef<string | null>(null);
  const completionTimeoutRef = useRef<number | null>(null);
  const previousRunStateRef = useRef<{
    id: string | null;
    status: TrainingRunRecord["status"] | null;
  }>({
    id: null,
    status: null,
  });

  const latestPoint = useMemo(() => getLatestTrainingTelemetry(run?.telemetry ?? []), [run]);
  const liveTrainingTitle = useMemo(
    () =>
      buildLiveTrainingPageTitle({
        defaultTitle: defaultTitleRef.current,
        fileTitle,
        latestPoint,
        run,
      }),
    [fileTitle, latestPoint, run],
  );
  const completedTrainingTitle = useMemo(
    () =>
      buildCompletedTrainingPageTitle({
        defaultTitle: defaultTitleRef.current,
        fileTitle,
        run,
      }),
    [fileTitle, run],
  );

  useEffect(() => {
    const previousRunState = previousRunStateRef.current;
    const justCompleted =
      previousRunState.id === run?.id &&
      previousRunState.status === "training" &&
      run?.status === "completed";
    const holdingCompletedTitle =
      completionHoldRunIdRef.current === run?.id &&
      run?.status === "completed" &&
      completionTimeoutRef.current !== null;

    if (run?.status === "training") {
      clearCompletionTitle({
        completionHoldRunIdRef,
        completionTimeoutRef,
      });
      document.title = liveTrainingTitle;
    } else if (justCompleted) {
      clearCompletionTitle({
        completionHoldRunIdRef,
        completionTimeoutRef,
      });
      completionHoldRunIdRef.current = run.id;
      document.title = completedTrainingTitle;
      completionTimeoutRef.current = window.setTimeout(() => {
        clearCompletionTitle({
          completionHoldRunIdRef,
          completionTimeoutRef,
        });
        document.title = defaultTitleRef.current;
      }, TRAINING_PAGE_TITLE_RESET_DELAY_MS);
    } else if (!holdingCompletedTitle) {
      clearCompletionTitle({
        completionHoldRunIdRef,
        completionTimeoutRef,
      });
      document.title = defaultTitleRef.current;
    }

    previousRunStateRef.current = {
      id: run?.id ?? null,
      status: run?.status ?? null,
    };
  }, [completedTrainingTitle, liveTrainingTitle, run?.id, run?.status]);

  useEffect(() => {
    return () => {
      clearCompletionTitle({
        completionHoldRunIdRef,
        completionTimeoutRef,
      });
      document.title = defaultTitleRef.current;
    };
  }, []);
}

export function buildCompletedTrainingPageTitle({
  defaultTitle,
  fileTitle,
  run,
}: {
  defaultTitle: string;
  fileTitle?: string;
  run: TrainingRunRecord | null;
}) {
  return joinTitleSegments("Training complete", resolveRunLabel(run, fileTitle), defaultTitle);
}

export function buildLiveTrainingPageTitle({
  defaultTitle,
  fileTitle,
  latestPoint,
  run,
}: {
  defaultTitle: string;
  fileTitle?: string;
  latestPoint: ReturnType<typeof getLatestTrainingTelemetry>;
  run: TrainingRunRecord | null;
}) {
  const progressSummary = latestPoint
    ? formatProgressSummary(latestPoint.step, latestPoint.totalSteps)
    : null;
  const statusLabel = !latestPoint
    ? "Training..."
    : latestPoint.step >= latestPoint.totalSteps
      ? `Finalizing ${progressSummary}`
      : `Training ${progressSummary}`;

  return joinTitleSegments(statusLabel, resolveRunLabel(run, fileTitle), defaultTitle);
}

function resolveRunLabel(run: TrainingRunRecord | null, fileTitle?: string) {
  const trimmedFileTitle = fileTitle?.trim();
  if (trimmedFileTitle) {
    return trimmedFileTitle;
  }

  const trimmedRunName = run?.name.trim();
  if (trimmedRunName) {
    return trimmedRunName;
  }

  return run?.fileName.replace(/\.txt$/iu, "").trim() ?? "";
}

function formatProgressPercent(step: number, totalSteps: number) {
  return Math.min(100, Math.max(0, Math.round((step / Math.max(totalSteps, 1)) * 100)));
}

function formatProgressSummary(step: number, totalSteps: number) {
  return `${formatStepCount(step)}/${formatStepCount(totalSteps)} (${formatProgressPercent(step, totalSteps)}%)`;
}

function formatStepCount(value: number) {
  return Math.max(0, Math.floor(value)).toLocaleString("en-US");
}

function joinTitleSegments(...segments: Array<string | null | undefined>) {
  return segments.filter(Boolean).join(" • ");
}

function clearCompletionTitle({
  completionHoldRunIdRef,
  completionTimeoutRef,
}: {
  completionHoldRunIdRef: MutableRefObject<string | null>;
  completionTimeoutRef: MutableRefObject<number | null>;
}) {
  completionHoldRunIdRef.current = null;
  if (completionTimeoutRef.current !== null) {
    window.clearTimeout(completionTimeoutRef.current);
    completionTimeoutRef.current = null;
  }
}
