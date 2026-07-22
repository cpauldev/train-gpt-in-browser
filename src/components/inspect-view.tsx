import { CircleHelp } from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { formatNumber } from "@/lib/trainer-core";
import { formatBytes, formatTimestamp } from "@/lib/trainer-presentation";
import type { ModelConfig, TrainingRunRecord } from "@/lib/trainer-types";

export function InspectView({ run }: { run: TrainingRunRecord }) {
  const { checkpoint } = run;
  const modelConfig = checkpoint?.modelConfig ?? run.trainingConfig.model;
  const tokenizerVocabSize = checkpoint?.tokenizer.vocabSize ?? run.datasetStats.vocabSize;
  const completedSteps =
    checkpoint?.resumeState.completedSteps ??
    run.telemetry.at(-1)?.step ??
    run.trainingConfig.steps;
  const finalLoss = checkpoint?.resumeState.finalLoss ?? run.telemetry.at(-1)?.loss;
  const totalTokens = checkpoint?.resumeState.totalTokens ?? run.telemetry.at(-1)?.totalTokens;
  const datasetTokenCount = checkpoint?.datasetData.length ?? run.datasetStats.tokenCount;

  const backend =
    checkpoint && checkpoint.requestedBackend !== checkpoint.resolvedBackend
      ? `${checkpoint.resolvedBackend} (${checkpoint.requestedBackend} requested)`
      : run.trainingConfig.requestedBackend;

  const modelStats = [
    { label: "Parameters", value: formatNumber(countModelParameters(modelConfig)) },
    { label: "Vocab size", value: formatNumber(modelConfig.vocabSize) },
    {
      label: "Block size",
      value: formatNumber(modelConfig.blockSize),
      tooltip: "Maximum number of tokens the model attends to at once (context length).",
    },
    { label: "Layers", value: formatNumber(modelConfig.nLayer) },
    {
      label: "Embedding dim",
      value: formatNumber(modelConfig.nEmbd),
      tooltip: "Size of the vector used to represent each token internally.",
    },
    {
      label: "Attention heads",
      value: formatNumber(modelConfig.nHead),
      tooltip: "Number of parallel attention patterns computed per layer.",
    },
  ];

  return (
    <>
      <section className="space-y-3">
        <h2 className="font-semibold text-lg">Run</h2>
        <InspectTable
          rows={[
            { label: "Created", value: formatTimestamp(run.createdAt) },
            { label: "Modified", value: formatTimestamp(run.updatedAt) },
            {
              label: "Storage",
              value: run.checkpointSavedAt
                ? `Browser checkpoint (${formatTimestamp(run.checkpointSavedAt)})`
                : "Run metadata",
            },
            {
              label: "Model export",
              value: run.artifacts?.model
                ? formatArtifactValue(run.artifacts.model.fileName, run.artifacts.model.sizeBytes)
                : "Not exported yet",
            },
          ]}
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-lg">Model</h2>
        <div className="grid gap-2 lg:grid-cols-2">
          {modelStats.map((stat) => (
            <MetricCard
              key={stat.label}
              label={stat.label}
              labelAccessory={stat.tooltip ? <InspectTooltip>{stat.tooltip}</InspectTooltip> : null}
              value={stat.value}
            />
          ))}
        </div>
        <InspectTable
          rows={[
            {
              label: "MLP type",
              value: modelConfig.mlpType,
              tooltip: "Feed-forward network variant used in each transformer block.",
            },
            {
              label: "MLP hidden dim",
              value: formatNumber(modelConfig.mlpHiddenDim),
              tooltip: "Internal width of the feed-forward layer inside each transformer block.",
            },
            {
              label: "Weight tensors",
              value: formatNumber(getWeightTensorCount(modelConfig)),
              tooltip: "Number of individual weight arrays stored in the checkpoint.",
            },
          ]}
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-lg">Tokenizer</h2>
        <InspectTable
          rows={[
            {
              label: "Vocab size",
              value: `${formatNumber(tokenizerVocabSize)} chars`,
            },
            {
              label: "BOS token ID",
              value: checkpoint ? formatNumber(checkpoint.tokenizer.bosId) : "0",
              tooltip: "Token ID prepended to each input sequence as a start marker.",
            },
          ]}
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-lg">Training</h2>
        <InspectTable
          rows={[
            {
              label: "Steps completed",
              value: formatNumber(completedSteps),
            },
            {
              label: "Steps (last run)",
              value: formatNumber(run.trainingConfig.steps),
            },
            {
              label: "Final loss",
              value: Number.isFinite(finalLoss) ? Number(finalLoss).toFixed(4) : "Unknown",
            },
            {
              label: "Tokens processed",
              value: totalTokens === undefined ? "Unknown" : formatNumber(totalTokens),
              tooltip: "Cumulative tokens seen across all training runs on this checkpoint.",
            },
            {
              label: "Dataset tokens",
              value: formatNumber(datasetTokenCount),
              tooltip: "Number of tokens in the tokenized training dataset.",
            },
            ...(checkpoint
              ? [
                  {
                    label: "Dedup filter",
                    value: `${checkpoint.sourceFilter.kind} (${formatBytes(checkpoint.sourceFilter.bits.byteLength)})`,
                    tooltip:
                      "Bloom filter used to skip sequences the model has already seen, reducing repetition.",
                  },
                ]
              : []),
            { label: "Learning rate", value: run.trainingConfig.learningRate.toExponential(2) },
            { label: "Batch size", value: formatNumber(run.trainingConfig.batchSize) },
            { label: "Seed", value: formatNumber(run.trainingConfig.seed) },
            {
              label: "Beta1",
              value: String(run.trainingConfig.beta1),
              tooltip:
                "Adam optimizer first moment decay rate (exponential moving average of gradients).",
            },
            {
              label: "Beta2",
              value: String(run.trainingConfig.beta2),
              tooltip:
                "Adam optimizer second moment decay rate (exponential moving average of squared gradients).",
            },
            {
              label: "Epsilon",
              value: String(run.trainingConfig.eps),
              tooltip: "Small constant added in Adam to prevent division by zero.",
            },
            {
              label: "Weight decay",
              value: String(run.trainingConfig.weightDecay),
              tooltip:
                "L2 regularization strength — penalizes large weights to reduce overfitting.",
            },
          ]}
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-lg">Runtime</h2>
        <InspectTable
          rows={[
            { label: "Backend", value: backend },
            {
              label: "AMP",
              value:
                run.trainingConfig.ampRequested === null
                  ? "auto"
                  : run.trainingConfig.ampRequested
                    ? "requested"
                    : "off",
              tooltip:
                "Automatic mixed precision — uses lower-precision floats to speed up training where supported.",
            },
            {
              label: "Compile",
              value:
                run.trainingConfig.compileRequested === null
                  ? "auto"
                  : run.trainingConfig.compileRequested
                    ? "requested"
                    : "off",
              tooltip:
                "Requests GPU shader compilation for potentially faster training throughput.",
            },
          ]}
        />
      </section>
    </>
  );
}

function InspectTable({
  rows,
}: {
  rows: Array<{ label: string; value: string; tooltip?: string }>;
}) {
  return (
    <dl className="divide-y divide-border/70 rounded-xl border border-border/70 bg-background">
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid items-center gap-2 px-4 py-2.5 lg:grid-cols-[10rem_minmax(0,1fr)]"
        >
          <dt className="flex items-center gap-1 font-medium text-muted-foreground text-xs">
            {row.label}
            {row.tooltip && <InspectTooltip>{row.tooltip}</InspectTooltip>}
          </dt>
          <dd className="break-words text-sm">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function InspectTooltip({ children }: { children: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="shrink-0 text-muted-foreground/50 hover:text-muted-foreground"
          />
        }
      >
        <CircleHelp className="size-3" />
      </TooltipTrigger>
      <TooltipPopup className="max-w-52 text-pretty text-xs leading-relaxed">
        {children}
      </TooltipPopup>
    </Tooltip>
  );
}

function countModelParameters(modelConfig: ModelConfig) {
  const embeddingParameters =
    modelConfig.vocabSize * modelConfig.nEmbd + modelConfig.blockSize * modelConfig.nEmbd;
  const attentionParameters = 4 * modelConfig.nEmbd * modelConfig.nEmbd;
  const feedForwardParameters = 3 * modelConfig.nEmbd * modelConfig.mlpHiddenDim;
  const layerNormParameters = 2 * modelConfig.nEmbd;
  const finalParameters = modelConfig.nEmbd + modelConfig.nEmbd * modelConfig.vocabSize;

  return (
    embeddingParameters +
    modelConfig.nLayer * (attentionParameters + feedForwardParameters + layerNormParameters) +
    finalParameters
  );
}

function getWeightTensorCount(modelConfig: ModelConfig) {
  return 2 + modelConfig.nLayer * 7 + 2;
}

function formatArtifactValue(fileName: string, sizeBytes: number) {
  return `${fileName} (${formatBytes(sizeBytes)})`;
}
