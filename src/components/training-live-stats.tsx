import { Liveline, type LivelinePoint } from "liveline";
import { type MutableRefObject, useMemo, useRef, useState } from "react";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Group } from "@/components/ui/group";
import {
  Progress,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
} from "@/components/ui/progress";
import { useAppTheme } from "@/lib/app-theme";
import type { TrainingRunRecord, TrainingTelemetryPoint } from "@/lib/trainer-types";
import {
  getLatestTrainingTelemetry,
  resolveTrainingTelemetryTimeline,
} from "@/lib/training-telemetry";
import { useAnimatedValue } from "@/lib/use-animated-value";

type TrainingMetricKey = "loss" | "stepsPerSecond" | "tokPerSecond";
type ChartTelemetryPoint = Pick<TrainingTelemetryPoint, "elapsedTimeSeconds" | "step" | "time">;
type TimelineAnchorMode = "anchored-now" | "elapsed" | "point-time";
const METRIC_OPTIONS: Array<{
  accent: string;
  label: string;
  valueKey: TrainingMetricKey;
}> = [
  {
    accent: "#eb6f36",
    label: "Loss",
    valueKey: "loss",
  },
  {
    accent: "#2f8f5b",
    label: "Tokens/s",
    valueKey: "tokPerSecond",
  },
  {
    accent: "#3a76f0",
    label: "Steps/s",
    valueKey: "stepsPerSecond",
  },
];

const WINDOW_OPTIONS = [
  { label: "60s", seconds: 60 },
  { label: "5m", seconds: 300 },
] as const;

export function TrainingLiveStats({
  isTraining,
  run,
}: {
  isTraining: boolean;
  run: TrainingRunRecord | null;
}) {
  const theme = useAppTheme();
  const [selectedMetric, setSelectedMetric] = useState<TrainingMetricKey>("loss");
  const [selectedWindowSeconds, setSelectedWindowSeconds] = useState<number>(60);
  const telemetry = run?.telemetry ?? [];
  const normalizedTelemetry = useMemo(
    () => resolveTrainingTelemetryTimeline(telemetry),
    [telemetry],
  );
  const fallbackPoint = useMemo(() => getCheckpointFallbackPoint(run), [run]);
  const chartPoints = useMemo(
    () =>
      normalizedTelemetry.length > 0 ? normalizedTelemetry : fallbackPoint ? [fallbackPoint] : [],
    [fallbackPoint, normalizedTelemetry],
  );
  const latestPointHasExplicitElapsed = useMemo(() => {
    const latestTelemetryPoint = telemetry.at(-1);
    if (hasExplicitElapsedSeconds(latestTelemetryPoint ?? null)) {
      return true;
    }

    return telemetry.length === 0 && hasExplicitElapsedSeconds(fallbackPoint);
  }, [fallbackPoint, telemetry]);
  const latestPoint = useMemo(
    () => getLatestTrainingTelemetry(normalizedTelemetry) ?? fallbackPoint,
    [fallbackPoint, normalizedTelemetry],
  );
  const isPreparingTraining = run?.status === "starting";
  const isLiveTraining = run?.status === "training";
  const progressValue = latestPoint
    ? Math.min(100, (latestPoint.step / Math.max(latestPoint.totalSteps, 1)) * 100)
    : 0;
  const isComplete = latestPoint ? latestPoint.step >= latestPoint.totalSteps : false;
  const animating = isLiveTraining && !isComplete;
  const helperText =
    isPreparingTraining
      ? "Preparing training runtime."
      : isLiveTraining && !isComplete
      ? "Training in progress."
      : latestPoint
        ? "Recent training history for this dataset."
        : "Start training to see live loss, token throughput, and step rate.";
  const animatedStep = useAnimatedValue(latestPoint?.step ?? 0, { enabled: animating });
  const animatedLoss = useAnimatedValue(latestPoint?.loss ?? 0, { enabled: animating });
  const animatedTokPerSecond = useAnimatedValue(latestPoint?.tokPerSecond ?? 0, {
    enabled: animating,
  });
  const animatedStepsPerSecond = useAnimatedValue(latestPoint?.stepsPerSecond ?? 0, {
    enabled: animating,
  });
  const animatedTotalTokens = useAnimatedValue(latestPoint?.totalTokens ?? 0, {
    enabled: animating,
  });
  const displayedLoss = latestPoint ? animatedLoss : undefined;
  const displayedTokPerSecond = latestPoint ? animatedTokPerSecond : undefined;
  const displayedStepsPerSecond = latestPoint ? animatedStepsPerSecond : undefined;
  const displayedTotalTokens = latestPoint ? animatedTotalTokens : undefined;
  const progressLabel = isPreparingTraining
    ? "Preparing..."
    : latestPoint
      ? formatProgressLabel(Math.floor(animatedStep), latestPoint.totalSteps)
      : "Waiting to start";
  const statCards = [
    { label: "Loss", value: formatLossValue(displayedLoss) },
    { label: "Tokens/s", value: formatRateValue(displayedTokPerSecond) },
    { label: "Steps/s", value: formatRateValue(displayedStepsPerSecond) },
    { label: "Tokens processed", value: formatCountValue(displayedTotalTokens) },
  ];

  return (
    <div className="space-y-6 px-5 py-5">
      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="font-semibold text-lg">Live Stats</h2>
          <p className="text-sm text-muted-foreground">{helperText}</p>
        </div>

        <Progress value={progressValue}>
          <div className="flex items-center justify-between gap-3">
            <ProgressLabel>Progress</ProgressLabel>
            <span className="text-sm tabular-nums">{progressLabel}</span>
          </div>
          <ProgressTrack>
            <ProgressIndicator className={isComplete ? "bg-emerald-500" : "bg-blue-500"} />
          </ProgressTrack>
        </Progress>

        <div className="grid gap-2 lg:grid-cols-2">
          {statCards.map((card) => (
            <StatCard key={card.label} label={card.label} value={card.value} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Group>
            {METRIC_OPTIONS.map((option) => (
              <Button
                key={option.valueKey}
                size="xs"
                variant={selectedMetric === option.valueKey ? "outline" : "secondary"}
                onClick={() => setSelectedMetric(option.valueKey)}
              >
                {option.label}
              </Button>
            ))}
          </Group>

          <Group>
            {WINDOW_OPTIONS.map((option) => (
              <Button
                key={option.seconds}
                size="xs"
                variant={selectedWindowSeconds === option.seconds ? "outline" : "secondary"}
                onClick={() => setSelectedWindowSeconds(option.seconds)}
              >
                {option.label}
              </Button>
            ))}
          </Group>
        </div>

        <div>
          {chartPoints.length === 0 && !isTraining ? (
            <Empty className="min-h-56 bg-muted/30">
              <EmptyHeader>
                <EmptyTitle>No Training History Yet</EmptyTitle>
                <EmptyDescription>
                  Start training to see loss, token throughput, and step rate over time.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <TrainingTelemetryChart
              isComplete={isComplete}
              isLiveTraining={isLiveTraining}
              isPreparingTraining={isPreparingTraining}
              isTraining={isTraining}
              points={chartPoints}
              runId={run?.id ?? null}
              latestPointHasExplicitElapsed={latestPointHasExplicitElapsed}
              selectedMetric={selectedMetric}
              selectedWindowSeconds={selectedWindowSeconds}
              theme={theme.resolvedTheme}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function TrainingTelemetryChart({
  isComplete,
  isLiveTraining,
  latestPointHasExplicitElapsed,
  isPreparingTraining,
  isTraining,
  points,
  runId,
  selectedMetric,
  selectedWindowSeconds,
  theme,
}: {
  isComplete: boolean;
  isLiveTraining: boolean;
  latestPointHasExplicitElapsed: boolean;
  isPreparingTraining: boolean;
  isTraining: boolean;
  points: TrainingTelemetryPoint[];
  runId: string | null;
  selectedMetric: TrainingMetricKey;
  selectedWindowSeconds: number;
  theme: "light" | "dark";
}) {
  const frozenChartAnchorRef = useRef<{
    anchorSeconds: number;
    anchorKey: string;
  } | null>(null);
  const metricOption = METRIC_OPTIONS.find((option) => option.valueKey === selectedMetric);
  const latestPoint = points.at(-1) ?? null;
  const latestElapsedSeconds = latestPoint?.elapsedTimeSeconds ?? 0;
  const shouldFreezeTimeline = !isLiveTraining || isComplete;
  const timelineAnchorMode = resolveTimelineAnchorMode({
    isComplete,
    isLiveTraining,
    latestPointHasExplicitElapsed,
  });
  const frozenAnchorKey = `${runId ?? "no-run"}:${latestPoint?.step ?? 0}:${latestPoint?.elapsedTimeSeconds ?? 0}:${latestPoint?.time ?? 0}`;
  const chartLatestWallClockSeconds = getChartLatestWallClockSeconds({
    anchorRef: frozenChartAnchorRef,
    anchorKey: frozenAnchorKey,
    latestPoint,
    mode: timelineAnchorMode,
  });
  const timelineOriginSeconds = chartLatestWallClockSeconds - latestElapsedSeconds;
  const chartData = useMemo(
    () =>
      points.map((point) => ({
        time: timelineOriginSeconds + (point.elapsedTimeSeconds ?? 0),
        value: point[selectedMetric],
      })),
    [points, selectedMetric, timelineOriginSeconds],
  );
  const chartValue = latestPoint?.[selectedMetric] ?? 0;
  const livelineKey = `${runId ?? "no-run"}:${selectedMetric}`;

  return (
    <div className="h-56 bg-muted/20">
      <Liveline
        key={livelineKey}
        data={chartData as LivelinePoint[]}
        value={chartValue}
        badgeVariant="minimal"
        color={metricOption?.accent ?? "#eb6f36"}
        emptyText={
          isPreparingTraining
            ? "Preparing training runtime"
            : isTraining
              ? "Waiting for the first telemetry sample"
              : "Waiting for telemetry"
        }
        formatTime={(time) => formatElapsedChartTime(time - timelineOriginSeconds)}
        formatValue={(value) => formatMetricValue(selectedMetric, value)}
        loading={false}
        padding={{ bottom: 32, left: 12, right: 88, top: 14 }}
        paused={shouldFreezeTimeline}
        pulse={isLiveTraining && !isComplete}
        scrub={chartData.length > 1}
        showValue
        theme={theme}
        valueMomentumColor={selectedMetric !== "loss"}
        window={selectedWindowSeconds}
      />
    </div>
  );
}

function formatMetricValue(metric: TrainingMetricKey, value: number) {
  if (metric === "loss") {
    return formatLossValue(value);
  }

  return formatRateValue(value);
}

function formatLossValue(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }

  return value.toFixed(value >= 10 ? 2 : 4);
}

function formatRateValue(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }

  return value.toLocaleString("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 2,
    minimumFractionDigits: value >= 100 ? 0 : 2,
  });
}

function getCheckpointFallbackPoint(run: TrainingRunRecord | null) {
  const checkpoint = run?.checkpoint;
  if (!checkpoint) {
    return null;
  }

  return {
    elapsedTimeSeconds: checkpoint.resumeState.elapsedTrainingSeconds ?? 0,
    loss: checkpoint.resumeState.finalLoss,
    step: checkpoint.resumeState.completedSteps,
    stepsPerSecond: 0,
    time: run.updatedAt / 1000,
    tokPerSecond: 0,
    totalSteps: Math.max(run.trainingConfig.steps, checkpoint.resumeState.completedSteps),
    totalTokens: checkpoint.resumeState.totalTokens,
  };
}

function formatElapsedChartTime(seconds: number) {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatCountValue(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }

  return value.toLocaleString("en-US", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}

function formatProgressLabel(step: number, totalSteps: number) {
  const safeStep = Math.max(0, step);
  const safeTotalSteps = Math.max(totalSteps, 1);
  const percent = Math.min(100, Math.max(0, Math.round((safeStep / safeTotalSteps) * 100)));
  return `${safeStep.toLocaleString("en-US")} / ${safeTotalSteps.toLocaleString("en-US")} (${percent}%)`;
}

function getChartLatestWallClockSeconds({
  anchorRef,
  anchorKey,
  latestPoint,
  mode,
}: {
  anchorRef: MutableRefObject<{ anchorSeconds: number; anchorKey: string } | null>;
  anchorKey: string;
  latestPoint: ChartTelemetryPoint | null;
  mode: TimelineAnchorMode;
}) {
  if (!latestPoint) {
    anchorRef.current = null;
    return 0;
  }

  if (mode === "point-time") {
    anchorRef.current = null;
    return latestPoint.time;
  }

  if (mode === "elapsed") {
    anchorRef.current = null;
    return latestPoint.elapsedTimeSeconds ?? 0;
  }

  if (anchorRef.current?.anchorKey === anchorKey) {
    return anchorRef.current.anchorSeconds;
  }

  const nextAnchorSeconds = Date.now() / 1000;
  anchorRef.current = {
    anchorKey,
    anchorSeconds: nextAnchorSeconds,
  };
  return nextAnchorSeconds;
}

function resolveTimelineAnchorMode({
  isComplete,
  isLiveTraining,
  latestPointHasExplicitElapsed,
}: {
  isComplete: boolean;
  isLiveTraining: boolean;
  latestPointHasExplicitElapsed: boolean;
}): TimelineAnchorMode {
  if (isLiveTraining) {
    return "point-time";
  }

  if (isComplete && latestPointHasExplicitElapsed) {
    return "elapsed";
  }

  return latestPointHasExplicitElapsed ? "point-time" : "anchored-now";
}

function hasExplicitElapsedSeconds(point: Pick<TrainingTelemetryPoint, "elapsedTimeSeconds"> | null) {
  return typeof point?.elapsedTimeSeconds === "number" && Number.isFinite(point.elapsedTimeSeconds);
}
