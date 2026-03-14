import { type MutableRefObject, useEffect, useMemo, useRef } from "react";
import { isTrainingRunInProgress, type TrainingRunRecord } from "@/lib/trainer-types";
import { getLatestTrainingTelemetry } from "@/lib/training-telemetry";

export const APP_PAGE_TITLE = "Train GPT in Browser";
export const TRAINING_PAGE_TITLE_RESET_DELAY_MS = 3_500;

export function useTrainingPageTitle({
  fileTitle,
  run,
}: {
  fileTitle?: string;
  run: TrainingRunRecord | null;
}) {
  const baseTitleRef = useRef(APP_PAGE_TITLE);
  const completionHoldRunIdRef = useRef<string | null>(null);
  const completionTimeoutRef = useRef<number | null>(null);
  const previousRunStateRef = useRef<{
    id: string | null;
    status: TrainingRunRecord["status"] | null;
  }>({
    id: null,
    status: null,
  });

  const liveTrainingTitle = useMemo(
    () =>
      buildLiveTrainingPageTitle({
        baseTitle: baseTitleRef.current,
        fileTitle,
        run,
      }),
    [fileTitle, run],
  );
  const idlePageTitle = useMemo(
    () =>
      buildIdlePageTitle({
        baseTitle: baseTitleRef.current,
        fileTitle,
        run,
      }),
    [fileTitle, run],
  );
  const completedTrainingTitle = useMemo(
    () =>
      buildCompletedTrainingPageTitle({
        baseTitle: baseTitleRef.current,
        fileTitle,
        run,
      }),
    [fileTitle, run],
  );

  useEffect(() => {
    const previousRunState = previousRunStateRef.current;
    const justCompleted =
      previousRunState.id === run?.id &&
      previousRunState.status !== null &&
      isTrainingRunInProgress(previousRunState.status) &&
      run?.status === "completed";
    const holdingCompletedTitle =
      completionHoldRunIdRef.current === run?.id &&
      run?.status === "completed" &&
      completionTimeoutRef.current !== null;

    if (run && isTrainingRunInProgress(run.status)) {
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
        document.title = idlePageTitle;
      }, TRAINING_PAGE_TITLE_RESET_DELAY_MS);
    } else if (!holdingCompletedTitle) {
      clearCompletionTitle({
        completionHoldRunIdRef,
        completionTimeoutRef,
      });
      document.title = idlePageTitle;
    }

    previousRunStateRef.current = {
      id: run?.id ?? null,
      status: run?.status ?? null,
    };
  }, [completedTrainingTitle, idlePageTitle, liveTrainingTitle, run?.id, run?.status]);

  useEffect(() => {
    return () => {
      clearCompletionTitle({
        completionHoldRunIdRef,
        completionTimeoutRef,
      });
      document.title = baseTitleRef.current;
    };
  }, []);
}

export function buildCompletedTrainingPageTitle({
  baseTitle,
  fileTitle,
  run,
}: {
  baseTitle: string;
  fileTitle?: string;
  run: TrainingRunRecord | null;
}) {
  return joinTitleSegments("Training complete", resolveRunLabel(run, fileTitle), baseTitle);
}

export function buildLiveTrainingPageTitle({
  baseTitle,
  fileTitle,
  run,
}: {
  baseTitle: string;
  fileTitle?: string;
  run: TrainingRunRecord | null;
}) {
  const statusLabel = getLiveTrainingTitleLabel(run);
  return joinTitleSegments(statusLabel, resolveRunLabel(run, fileTitle), baseTitle);
}

export function buildIdlePageTitle({
  baseTitle,
  fileTitle,
  run,
}: {
  baseTitle: string;
  fileTitle?: string;
  run: TrainingRunRecord | null;
}) {
  return joinTitleSegments(resolveRunLabel(run, fileTitle), baseTitle);
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

function joinTitleSegments(...segments: Array<string | null | undefined>) {
  return segments.filter(Boolean).join(" • ");
}

function getLiveTrainingTitleLabel(run: TrainingRunRecord | null) {
  if (run?.status === "starting") {
    return "Preparing training";
  }

  const latestPoint = getLatestTrainingTelemetry(run?.telemetry ?? []);
  if (!latestPoint) {
    return "Training...";
  }

  const progressPercent = Math.min(
    100,
    Math.max(0, Math.round((latestPoint.step / Math.max(latestPoint.totalSteps, 1)) * 100)),
  );
  return latestPoint.step >= latestPoint.totalSteps
    ? `Finalizing ${progressPercent}%`
    : `Training ${progressPercent}%`;
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
