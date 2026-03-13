import { CircleHelp } from "lucide-react";

import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { formatNumber } from "@/lib/trainer-core";
import { formatBytes, formatTimestamp } from "@/lib/trainer-presentation";
import type { TrainingRunRecord } from "@/lib/trainer-types";

export function InspectView({ run }: { run: TrainingRunRecord }) {
  const { checkpoint } = run;

  if (!checkpoint) {
    return null;
  }

  const backend =
    checkpoint.requestedBackend === checkpoint.resolvedBackend
      ? checkpoint.resolvedBackend
      : `${checkpoint.resolvedBackend} (${checkpoint.requestedBackend} requested)`;

  const modelStats = [
    { label: "Parameters", value: formatNumber(countParameters(checkpoint)) },
    { label: "Vocab size", value: formatNumber(checkpoint.modelConfig.vocabSize) },
    {
      label: "Block size",
      value: formatNumber(checkpoint.modelConfig.blockSize),
      tooltip: "Maximum number of tokens the model attends to at once (context length).",
    },
    { label: "Layers", value: formatNumber(checkpoint.modelConfig.nLayer) },
    {
      label: "Embedding dim",
      value: formatNumber(checkpoint.modelConfig.nEmbd),
      tooltip: "Size of the vector used to represent each token internally.",
    },
    {
      label: "Attention heads",
      value: formatNumber(checkpoint.modelConfig.nHead),
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
            { label: "Storage", value: "Browser checkpoint (IndexedDB)" },
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
        <div className="grid gap-2 sm:grid-cols-2">
          {modelStats.map((stat) => (
            <StatCard
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
              value: checkpoint.modelConfig.mlpType,
              badge: true,
              tooltip: "Feed-forward network variant used in each transformer block.",
            },
            {
              label: "MLP hidden dim",
              value: formatNumber(checkpoint.modelConfig.mlpHiddenDim),
              tooltip: "Internal width of the feed-forward layer inside each transformer block.",
            },
            {
              label: "Weight tensors",
              value: formatNumber(checkpoint.weights.length),
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
              value: `${formatNumber(checkpoint.tokenizer.vocabSize)} chars`,
            },
            {
              label: "BOS token ID",
              value: formatNumber(checkpoint.tokenizer.bosId),
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
              value: formatNumber(checkpoint.resumeState.completedSteps),
            },
            {
              label: "Steps (last run)",
              value: formatNumber(run.trainingConfig.steps),
            },
            {
              label: "Final loss",
              value: Number.isFinite(checkpoint.resumeState.finalLoss)
                ? checkpoint.resumeState.finalLoss.toFixed(4)
                : "Unknown",
            },
            {
              label: "Tokens processed",
              value: formatNumber(checkpoint.resumeState.totalTokens),
              tooltip: "Cumulative tokens seen across all training runs on this checkpoint.",
            },
            {
              label: "Dataset tokens",
              value: formatNumber(checkpoint.datasetData.length),
              tooltip: "Number of tokens in the tokenized training dataset.",
            },
            {
              label: "Dedup filter",
              value: `${checkpoint.sourceFilter.kind} (${formatBytes(checkpoint.sourceFilter.bits.byteLength)})`,
              tooltip:
                "Bloom filter used to skip sequences the model has already seen, reducing repetition.",
            },
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
            { label: "Backend", value: backend, badge: true },
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
  rows: Array<{ label: string; value: string; badge?: boolean; tooltip?: string }>;
}) {
  return (
    <dl className="divide-y divide-border/70 rounded-xl border border-border/70 bg-background">
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid items-center gap-2 px-4 py-2.5 sm:grid-cols-[10rem_minmax(0,1fr)]"
        >
          <dt className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            {row.label}
            {row.tooltip && <InspectTooltip>{row.tooltip}</InspectTooltip>}
          </dt>
          <dd className="break-words text-sm">
            {row.badge ? <Badge variant="outline">{row.value}</Badge> : row.value}
          </dd>
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

function countParameters(checkpoint: NonNullable<TrainingRunRecord["checkpoint"]>) {
  return checkpoint.weights.reduce((total, tensor) => total + tensor.values.length, 0);
}

function formatArtifactValue(fileName: string, sizeBytes: number) {
  return `${fileName} (${formatBytes(sizeBytes)})`;
}
