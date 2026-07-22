import {
  Download,
  LayoutPanelTop,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  SlidersHorizontal,
  TextCursorInput,
  Trash2,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { CodeEditorSurface } from "@/components/code-editor-surface";
import { InspectView } from "@/components/inspect-view";
import { MetricCard } from "@/components/metric-card";
import { PanelHeader } from "@/components/panel-header";
import { TrainingLiveStats } from "@/components/training-live-stats";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Frame, FramePanel } from "@/components/ui/frame";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { Toggle } from "@/components/ui/toggle";
import { clampTemperature, formatNumber } from "@/lib/trainer-core";
import { formatBytes, formatDurationSeconds } from "@/lib/trainer-presentation";
import {
  createGenerationConfig,
  type DatasetTextSummary,
  type GenerationConfig,
  isTrainingRunInProgress,
  type TrainingConfig,
  type TrainingRunRecord,
  type WorkspaceFile,
} from "@/lib/trainer-types";
import { getLatestTrainingTelemetry } from "@/lib/training-telemetry";
import { useAnimatedValue } from "@/lib/use-animated-value";

export function EditorPanel({
  canTrain,
  draftContent,
  draftName,
  generationConfig,
  isTraining,
  onBack,
  onDeleteFile,
  onDeleteModel,
  onDownloadModel,
  onDraftContentChange,
  onDraftNameChange,
  onSaveContent,
  onGenerationConfigChange,
  onResumeTraining,
  onStartTraining,
  onTrainingConfigChange,
  selectedFile,
  selectedFileSummary,
  selectedRun,
  trainingConfig,
}: {
  canTrain: boolean;
  draftContent: string;
  draftName: string;
  generationConfig: GenerationConfig;
  isTraining: boolean;
  onBack: () => void;
  onDeleteFile?: () => void;
  onDeleteModel?: () => void;
  onDownloadModel?: () => void;
  onDraftContentChange: (value: string) => void;
  onDraftNameChange: (value: string) => void;
  onSaveContent?: (content: string) => void;
  onGenerationConfigChange: (
    config: GenerationConfig | ((current: GenerationConfig) => GenerationConfig),
  ) => void;
  onResumeTraining?: () => void;
  onStartTraining: () => Promise<void>;
  onTrainingConfigChange: (
    config: TrainingConfig | ((current: TrainingConfig) => TrainingConfig),
  ) => void;
  selectedFile: WorkspaceFile | null;
  selectedFileSummary: DatasetTextSummary | null;
  selectedRun: TrainingRunRecord | null;
  trainingConfig: TrainingConfig;
}) {
  const [activeTab, setActiveTab] = useState<"details" | "training" | "source">("training");
  const [hasVisitedSourceTab, setHasVisitedSourceTab] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [savedContent, setSavedContent] = useState(selectedFile?.content ?? "");
  const autoOpenedTrainingRunIdRef = useRef<string | null>(null);
  const isDirty = draftContent !== savedContent;

  // Reset the saved baseline only when the selected file changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: including draft content would overwrite the dirty-state baseline
  useEffect(() => {
    setSavedContent(selectedFile?.content ?? "");
  }, [selectedFile?.id]);

  const handleSaveContent = () => {
    onSaveContent?.(draftContent);
    setSavedContent(draftContent);
  };

  const canContinueTraining = Boolean(onResumeTraining);
  const modelArtifactSize = selectedRun?.artifacts?.model?.sizeBytes;
  const downloadModelLabel =
    modelArtifactSize === undefined
      ? "Download model"
      : `Download model (${formatBytes(modelArtifactSize)})`;
  const isStartingTraining = selectedRun?.status === "starting";
  const latestTrainingPoint = getLatestTrainingTelemetry(selectedRun?.telemetry ?? []);
  const isFinalizingTraining =
    selectedRun?.status === "training" &&
    Boolean(latestTrainingPoint && latestTrainingPoint.step >= latestTrainingPoint.totalSteps);
  const rawEtaSeconds =
    latestTrainingPoint &&
    latestTrainingPoint.step < latestTrainingPoint.totalSteps &&
    selectedRun?.status === "training"
      ? computeEtaSeconds(latestTrainingPoint)
      : null;
  const animatedEtaSeconds = useAnimatedValue(rawEtaSeconds ?? 0, {
    enabled: rawEtaSeconds !== null,
  });
  const trainingEta = rawEtaSeconds !== null ? formatDurationSeconds(animatedEtaSeconds) : null;
  const trainingMetaLabel = isStartingTraining ? "Preparing..." : trainingEta;
  const trainingActionLabel = isTraining
    ? isFinalizingTraining
      ? "Finalizing results"
      : "Training in progress"
    : canContinueTraining
      ? "Continue training"
      : "Start training";
  const trainingActionIcon = isTraining ? (
    <Spinner />
  ) : canContinueTraining ? (
    <RefreshCw />
  ) : (
    <Play />
  );
  const trainingControlFields = createTrainingControlFields({
    canContinueTraining,
    generationConfig,
    lockModelControls: Boolean(selectedRun),
    onGenerationConfigChange,
    onTrainingConfigChange,
    trainingConfig,
  });
  const shouldShimmerTrainingAction = isTraining;

  useEffect(() => {
    if (!selectedRun || !isTrainingRunInProgress(selectedRun.status)) {
      autoOpenedTrainingRunIdRef.current = null;
      return;
    }

    if (
      autoOpenedTrainingRunIdRef.current === selectedRun.id ||
      activeTab === "source" ||
      activeTab === "details"
    ) {
      return;
    }

    autoOpenedTrainingRunIdRef.current = selectedRun.id;
    setActiveTab("training");
  }, [activeTab, selectedRun]);

  useEffect(() => {
    if (activeTab === "source") {
      setHasVisitedSourceTab(true);
    }
  }, [activeTab]);

  if (!selectedFile || !selectedFileSummary) {
    return (
      <Frame className="h-full overflow-hidden lg:min-h-0">
        <PanelHeader onBack={onBack} title="Editor" />
        <FramePanel className="flex flex-1 items-center justify-center lg:min-h-0">
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Select a file</EmptyTitle>
              <EmptyDescription>
                Choose a dataset from the left to edit and train it.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </FramePanel>
      </Frame>
    );
  }

  return (
    <Frame className="h-full overflow-hidden lg:min-h-0">
      <PanelHeader onBack={onBack} title={selectedFile.title ?? selectedFile.name} />

      <FramePanel className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as "details" | "training" | "source")}
          className="min-h-0 flex-1 gap-0"
        >
          <div className="border-border/70 border-b px-4 pt-3 lg:px-5 lg:pt-4">
            <TabsList variant="underline" className="min-w-max">
              <TabsTab value="training">
                <Play className="opacity-60" />
                Training
              </TabsTab>
              <TabsTab value="source">
                <TextCursorInput className="opacity-60" />
                Source
              </TabsTab>
              <TabsTab value="details">
                <LayoutPanelTop className="opacity-60" />
                Details
              </TabsTab>
            </TabsList>
          </div>

          <TabsPanel value="details" className="min-h-0 p-0">
            <div className="flex h-full min-h-0 flex-col">
              <ScrollArea className="flex-1" scrollFade>
                <div className="space-y-6 px-4 py-4 lg:px-5 lg:py-5">
                  <section className="space-y-4">
                    <div className="flex flex-col items-start justify-between gap-3 lg:flex-row">
                      <div className="space-y-1">
                        <h2 className="font-semibold text-lg">
                          {selectedFile.title ?? selectedFile.name}
                        </h2>
                        <p className="text-muted-foreground text-sm">
                          {selectedFile.description ?? "Editable local dataset"}
                        </p>
                      </div>
                      {selectedFile.source === "user" ? (
                        <Badge variant="outline">Local</Badge>
                      ) : null}
                    </div>

                    <Field>
                      <FieldLabel>File name</FieldLabel>
                      <Input
                        disabled={selectedFile.source === "builtin"}
                        value={draftName}
                        onChange={(event) => onDraftNameChange(event.currentTarget.value)}
                      />
                    </Field>

                    <div className="grid gap-3 lg:grid-cols-2">
                      <MetricCard
                        label="Documents"
                        value={formatNumber(selectedFileSummary.documentCount)}
                      />
                      <MetricCard
                        label="Characters"
                        value={formatNumber(selectedFileSummary.characterCount)}
                      />
                      <MetricCard
                        label="Dataset tokens"
                        value={formatNumber(selectedFileSummary.tokenCount)}
                      />
                      <MetricCard
                        label="Tokenizer size"
                        value={formatNumber(selectedFileSummary.vocabSize)}
                      />
                    </div>
                  </section>

                  {selectedRun ? <InspectView run={selectedRun} /> : null}
                </div>
              </ScrollArea>

              {selectedRun || onDeleteFile ? (
                <div className="border-border/70 border-t px-4 py-4 lg:px-5">
                  <div className="space-y-2">
                    {selectedRun ? (
                      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                        <Button
                          variant="outline"
                          onClick={() => onDownloadModel?.()}
                          disabled={
                            (!selectedRun.checkpoint && !selectedRun.checkpointSavedAt) ||
                            isTrainingRunInProgress(selectedRun.status)
                          }
                          className="w-full"
                        >
                          <Download />
                          {downloadModelLabel}
                        </Button>
                        <Button
                          variant="destructive-outline"
                          onClick={onDeleteModel}
                          disabled={isTrainingRunInProgress(selectedRun.status)}
                          className="w-full"
                        >
                          <Trash2 />
                          Delete model
                        </Button>
                      </div>
                    ) : null}
                    {onDeleteFile ? (
                      <Button
                        variant="destructive-outline"
                        onClick={onDeleteFile}
                        className="w-full gap-2"
                      >
                        <Trash2 />
                        Delete file
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </TabsPanel>

          <TabsPanel value="training" keepMounted className="min-h-0 p-0">
            <div className="flex h-full min-h-0 flex-col">
              <ScrollArea className="flex-1" scrollFade>
                {showControls ? (
                  <div className="space-y-4 px-4 py-4 lg:px-5 lg:py-5">
                    <div className="space-y-1">
                      <h2 className="font-semibold text-lg">Training Controls</h2>
                      <p className="text-muted-foreground text-sm">
                        Adjust the browser training settings for this dataset.
                      </p>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {trainingControlFields.map((field) =>
                        field.kind === "select" ? (
                          <LabeledSelect
                            key={field.label}
                            disabled={field.disabled}
                            label={field.label}
                            value={field.value}
                            onChange={field.onChange}
                            options={field.options}
                          />
                        ) : (
                          <LabeledNumberField
                            key={field.label}
                            disabled={field.disabled}
                            label={field.label}
                            step={field.step}
                            value={field.value}
                            onChange={field.onChange}
                          />
                        ),
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <TrainingLiveStats isTraining={isTraining} run={selectedRun} />
                  </div>
                )}
              </ScrollArea>

              <div className="border-border/70 border-t px-4 py-4 lg:px-5">
                <div className="flex items-stretch gap-2">
                  <Button
                    onClick={() => {
                      setShowControls(false);
                      if (canContinueTraining) {
                        onResumeTraining?.();
                        return;
                      }
                      void onStartTraining();
                    }}
                    disabled={canContinueTraining ? isTraining : !canTrain || isTraining}
                    className="min-w-0 flex-1 gap-2"
                  >
                    {trainingActionIcon}
                    {shouldShimmerTrainingAction ? (
                      <TextShimmer>{trainingActionLabel}</TextShimmer>
                    ) : (
                      trainingActionLabel
                    )}
                    {trainingMetaLabel && (
                      <div className="ml-auto shrink-0 tabular-nums">{trainingMetaLabel}</div>
                    )}
                  </Button>
                  <Toggle
                    className="shrink-0"
                    variant="outline"
                    pressed={showControls}
                    onPressedChange={setShowControls}
                    aria-label="Toggle training controls"
                    disabled={isTraining}
                  >
                    <SlidersHorizontal />
                  </Toggle>
                </div>
              </div>
            </div>
          </TabsPanel>

          <TabsPanel value="source" keepMounted className="min-h-0 p-0">
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-border/70 border-b px-4 py-4 lg:px-5 lg:py-5">
                <div className="min-w-0 space-y-1">
                  <h2 className="font-semibold text-lg">Source Text</h2>
                  <p className="text-muted-foreground text-sm">
                    One training sample per line. Blank lines are ignored during tokenization.
                  </p>
                </div>
              </div>

              {hasVisitedSourceTab ? (
                <CodeEditorSurface
                  ariaLabel="Source text"
                  className="flex-1"
                  showLineNumbers
                  readOnly={isTraining}
                  value={draftContent}
                  onChange={onDraftContentChange}
                />
              ) : (
                <div className="flex-1" />
              )}

              <div className="border-border/70 border-t px-4 py-4 lg:px-5">
                <div className="flex flex-col items-stretch gap-2 lg:flex-row">
                  <Button
                    variant="outline"
                    disabled={!isDirty || isTraining}
                    className="w-full min-w-0 lg:flex-1"
                    onClick={() => onDraftContentChange(savedContent)}
                  >
                    <RotateCcw />
                    Restore
                  </Button>
                  <Button
                    disabled={!isDirty || isTraining}
                    className="w-full min-w-0 lg:flex-1"
                    onClick={handleSaveContent}
                  >
                    <Save />
                    Save
                  </Button>
                </div>
              </div>
            </div>
          </TabsPanel>
        </Tabs>
      </FramePanel>
    </Frame>
  );
}

function computeEtaSeconds(point: ReturnType<typeof getLatestTrainingTelemetry>): number | null {
  if (!point) return null;
  const remaining = Math.max(point.totalSteps - point.step, 0);
  if (remaining === 0) return null;
  if (point.stepsPerSecond <= 0 || !Number.isFinite(point.stepsPerSecond)) return null;
  return Math.ceil(remaining / point.stepsPerSecond);
}

type TrainingControlField =
  | {
      disabled?: boolean;
      kind: "number";
      label: string;
      onChange: (value: number) => void;
      step: number;
      value: number;
    }
  | {
      disabled?: boolean;
      kind: "select";
      label: string;
      onChange: (value: string) => void;
      options: Array<{ label: string; value: string }>;
      value: string;
    };

function createTrainingControlFields({
  canContinueTraining,
  generationConfig,
  lockModelControls,
  onGenerationConfigChange,
  onTrainingConfigChange,
  trainingConfig,
}: {
  canContinueTraining: boolean;
  generationConfig: GenerationConfig;
  lockModelControls: boolean;
  onGenerationConfigChange: (
    config: GenerationConfig | ((current: GenerationConfig) => GenerationConfig),
  ) => void;
  onTrainingConfigChange: (
    config: TrainingConfig | ((current: TrainingConfig) => TrainingConfig),
  ) => void;
  trainingConfig: TrainingConfig;
}): TrainingControlField[] {
  return [
    {
      kind: "select",
      label: "Feedback mode",
      onChange: (value) => {
        onTrainingConfigChange((current) => ({
          ...current,
          lossReadbackInterval: Number(value),
        }));
      },
      options: [
        { label: "Fast (updates every 16 steps)", value: "16" },
        { label: "Detailed (updates every step)", value: "1" },
      ],
      value: String(trainingConfig.lossReadbackInterval ?? 16),
    },
    {
      kind: "select",
      label: "Backend",
      onChange: (value) =>
        onTrainingConfigChange((current) => ({
          ...current,
          requestedBackend: value as TrainingConfig["requestedBackend"],
        })),
      options: [
        { label: "Auto", value: "auto" },
        { label: "WebGPU", value: "webgpu" },
        { label: "CPU", value: "cpu" },
      ],
      value: trainingConfig.requestedBackend,
    },
    {
      kind: "number",
      label: "Seed",
      onChange: (value) =>
        onTrainingConfigChange((current) => ({
          ...current,
          seed: Math.max(1, value),
        })),
      step: 1,
      value: trainingConfig.seed,
    },
    {
      kind: "number",
      label: canContinueTraining ? "Additional steps" : "Steps",
      onChange: (value) =>
        onTrainingConfigChange((current) => ({
          ...current,
          steps: Math.max(1, value),
        })),
      step: 1,
      value: trainingConfig.steps,
    },
    {
      kind: "number",
      label: "Batch size",
      onChange: (value) =>
        onTrainingConfigChange((current) => ({
          ...current,
          batchSize: Math.max(1, value),
        })),
      step: 1,
      value: trainingConfig.batchSize,
    },
    {
      disabled: lockModelControls,
      kind: "number",
      label: "Block size",
      onChange: (value) =>
        onTrainingConfigChange((current) => ({
          ...current,
          model: { ...current.model, blockSize: Math.max(1, value) },
        })),
      step: 1,
      value: trainingConfig.model.blockSize,
    },
    {
      disabled: lockModelControls,
      kind: "number",
      label: "Layers",
      onChange: (value) =>
        onTrainingConfigChange((current) => ({
          ...current,
          model: { ...current.model, nLayer: Math.max(1, value) },
        })),
      step: 1,
      value: trainingConfig.model.nLayer,
    },
    {
      disabled: lockModelControls,
      kind: "number",
      label: "Embedding width",
      onChange: (value) =>
        onTrainingConfigChange((current) => ({
          ...current,
          model: { ...current.model, nEmbd: Math.max(1, value) },
        })),
      step: 1,
      value: trainingConfig.model.nEmbd,
    },
    {
      disabled: lockModelControls,
      kind: "number",
      label: "Attention heads",
      onChange: (value) =>
        onTrainingConfigChange((current) => ({
          ...current,
          model: { ...current.model, nHead: Math.max(1, value) },
        })),
      step: 1,
      value: trainingConfig.model.nHead,
    },
    {
      kind: "number",
      label: "Learning rate",
      onChange: (value) =>
        onTrainingConfigChange((current) => ({
          ...current,
          learningRate: Math.max(0.0000001, value),
        })),
      step: 0.0001,
      value: trainingConfig.learningRate,
    },
    {
      kind: "number",
      label: "Weight decay",
      onChange: (value) =>
        onTrainingConfigChange((current) => ({
          ...current,
          weightDecay: Math.max(0, value),
        })),
      step: 0.001,
      value: trainingConfig.weightDecay,
    },
    {
      kind: "number",
      label: "Samples after train",
      onChange: (value) =>
        onGenerationConfigChange((current) =>
          createGenerationConfig({
            ...current,
            numSamples: Math.max(1, value),
          }),
        ),
      step: 1,
      value: generationConfig.numSamples,
    },
    {
      kind: "number",
      label: "Default temperature",
      onChange: (value) =>
        onGenerationConfigChange((current) =>
          createGenerationConfig({
            ...current,
            temperature: clampTemperature(value),
          }),
        ),
      step: 0.1,
      value: generationConfig.temperature,
    },
  ];
}

function LabeledNumberField({
  disabled,
  label,
  onChange,
  step,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: number) => void;
  step: number;
  value: number;
}) {
  const inputId = useId();

  return (
    <Field>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <Input
        disabled={disabled}
        id={inputId}
        type="number"
        nativeInput
        step={step}
        value={Number.isFinite(value) ? value : ""}
        onChange={(event) => {
          const nextValue = event.currentTarget.valueAsNumber;
          if (Number.isNaN(nextValue)) {
            return;
          }
          onChange(nextValue);
        }}
      />
    </Field>
  );
}

function LabeledSelect({
  disabled,
  label,
  onChange,
  options,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
  value: string;
}) {
  const selectedOption = options.find((option) => option.value === value);

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select
        disabled={disabled}
        value={value}
        onValueChange={(nextValue) => {
          if (nextValue) {
            onChange(nextValue);
          }
        }}
      >
        <SelectTrigger>
          <SelectValue>{selectedOption?.label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
