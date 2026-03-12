import { Liveline, type LivelinePoint } from "liveline";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Group } from "@/components/ui/group";
import {
  Progress,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
} from "@/components/ui/progress";
import type { TrainingRunRecord } from "@/lib/trainer-types";
import { getLatestTrainingTelemetry } from "@/lib/training-telemetry";
import { useAnimatedValue } from "@/lib/use-animated-value";

type TrainingMetricKey = "loss" | "stepsPerSecond" | "tokPerSecond";

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
    label: "Throughput",
    valueKey: "tokPerSecond",
  },
  {
    accent: "#3a76f0",
    label: "Step rate",
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
  const [selectedMetric, setSelectedMetric] = useState<TrainingMetricKey>("loss");
  const [selectedWindowSeconds, setSelectedWindowSeconds] = useState<number>(300);
  const telemetry = run?.telemetry ?? [];
  const fallbackPoint = useMemo(() => getCheckpointFallbackPoint(run), [run]);
  const latestPoint = useMemo(
    () => getLatestTrainingTelemetry(telemetry) ?? fallbackPoint,
    [fallbackPoint, telemetry],
  );
  const metricOption = METRIC_OPTIONS.find((option) => option.valueKey === selectedMetric);
  const chartData = useMemo(
    () =>
      (telemetry.length > 0 ? telemetry : fallbackPoint ? [fallbackPoint] : []).map((point) => ({
        time: point.time,
        value: point[selectedMetric],
      })),
    [fallbackPoint, selectedMetric, telemetry],
  );
  const chartValue = latestPoint?.[selectedMetric] ?? 0;
  const progressValue = latestPoint
    ? Math.min(100, (latestPoint.step / Math.max(latestPoint.totalSteps, 1)) * 100)
    : 0;
  const isComplete = latestPoint ? latestPoint.step >= latestPoint.totalSteps : false;
  const animating = isTraining && !isComplete;
  const helperText =
    isTraining && !isComplete
      ? "Training in progress."
      : latestPoint
        ? "Recent training history for this dataset."
        : "Start training to see live loss and throughput.";
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
  const progressLabel = latestPoint
    ? `${Math.floor(animatedStep).toLocaleString("en-US")} / ${latestPoint.totalSteps.toLocaleString("en-US")}`
    : "Waiting to start";
  const statCards = [
    { label: "Loss", value: formatLossValue(animatedLoss) },
    { label: "Tokens/s", value: formatRateValue(animatedTokPerSecond) },
    { label: "Steps/s", value: formatRateValue(animatedStepsPerSecond) },
    { label: "Tokens processed", value: formatCountValue(Math.floor(animatedTotalTokens)) },
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

        <div className="grid gap-2 sm:grid-cols-2">
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
          {chartData.length === 0 && !isTraining ? (
            <Empty className="min-h-56 bg-muted/30">
              <EmptyHeader>
                <EmptyTitle>No Training History Yet</EmptyTitle>
                <EmptyDescription>
                  Start training to see loss and throughput over time.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="h-56 bg-muted/20">
              <Liveline
                data={chartData as LivelinePoint[]}
                value={chartValue}
                badgeVariant="minimal"
                color={metricOption?.accent ?? "#eb6f36"}
                emptyText="Waiting for telemetry"
                formatValue={(value) => formatMetricValue(selectedMetric, value)}
                loading={isTraining && chartData.length === 0}
                padding={{ bottom: 32, left: 12, right: 88, top: 14 }}
                paused={!isTraining || isComplete}
                pulse={isTraining && !isComplete}
                scrub={!isTraining || chartData.length > 1}
                showValue
                theme="light"
                valueMomentumColor={selectedMetric !== "loss"}
                window={selectedWindowSeconds}
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-semibold text-lg">{value}</div>
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
    loss: checkpoint.resumeState.finalLoss,
    step: checkpoint.resumeState.completedSteps,
    stepsPerSecond: 0,
    time: run.updatedAt / 1000,
    tokPerSecond: 0,
    totalSteps: Math.max(run.trainingConfig.steps, checkpoint.resumeState.completedSteps),
    totalTokens: checkpoint.resumeState.totalTokens,
  };
}

function formatCountValue(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }

  return value.toLocaleString("en-US");
}
