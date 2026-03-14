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
import { lazy, Suspense, useEffect, useState } from "react";

import { InspectView } from "@/components/inspect-view";
import { SidebarFrameHeader } from "@/components/sidebar-frame-header";
import { StatCard } from "@/components/stat-card";
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
import { Toggle } from "@/components/ui/toggle";
import { clampTemperature, formatNumber } from "@/lib/trainer-core";
import { formatDurationSeconds } from "@/lib/trainer-presentation";
import {
  createGenerationConfig,
  isTrainingRunInProgress,
  type DatasetTextSummary,
  type GenerationConfig,
  type TrainingConfig,
  type TrainingRunRecord,
  type WorkspaceFile,
} from "@/lib/trainer-types";
import { getLatestTrainingTelemetry } from "@/lib/training-telemetry";
import { useAnimatedValue } from "@/lib/use-animated-value";

let codeEditorSurfaceModulePromise: Promise<
  typeof import("@/components/code-editor-surface")
> | null = null;

function loadCodeEditorSurfaceModule() {
  codeEditorSurfaceModulePromise ??= import("@/components/code-editor-surface");
  return codeEditorSurfaceModulePromise;
}

export function preloadCodeEditorSurface() {
  return loadCodeEditorSurfaceModule();
}

const LazyCodeEditorSurface = lazy(async () => {
  const module = await loadCodeEditorSurfaceModule();
  return { default: module.CodeEditorSurface };
});

export function SidebarEditorView({
  canTrain,
  draftContent,
  draftName,
  generationConfig,
  isTraining,
  onBack,
  onResetLocalData,
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
  onResetLocalData: () => void;
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
  const isDirty = draftContent !== savedContent;

  // Reset saved content baseline when switching files.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally only resets on file id change
  useEffect(() => {
    setSavedContent(selectedFile?.content ?? "");
  }, [selectedFile?.id]);

  const handleSaveContent = () => {
    onSaveContent?.(draftContent);
    setSavedContent(draftContent);
  };

  const canContinueTraining = Boolean(onResumeTraining);
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
    <RefreshCw className="size-4 animate-spin" />
  ) : canContinueTraining ? (
    <RefreshCw className="size-4" />
  ) : (
    <Play className="size-4.5" />
  );
  const trainingControlFields = createTrainingControlFields({
    generationConfig,
    onGenerationConfigChange,
    onTrainingConfigChange,
    trainingConfig,
  });

  useEffect(() => {
    if (!selectedRun || !isTrainingRunInProgress(selectedRun.status)) {
      return;
    }

    setActiveTab("training");
  }, [selectedRun?.id, selectedRun?.status]);

  useEffect(() => {
    if (activeTab === "source") {
      setHasVisitedSourceTab(true);
    }
  }, [activeTab]);

  if (!selectedFile || !selectedFileSummary) {
    return (
      <Frame className="h-full overflow-hidden lg:min-h-0">
        <SidebarFrameHeader onBack={onBack} onResetLocalData={onResetLocalData} title="Workspace" />
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
      <SidebarFrameHeader
        onBack={onBack}
        onResetLocalData={onResetLocalData}
        title={selectedFile.title ?? selectedFile.name}
      />

      <FramePanel className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as "details" | "training" | "source")}
          className="min-h-0 flex-1 gap-0"
        >
          <div className="border-b border-border/70 px-4 pt-3 lg:px-5 lg:pt-4">
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
              <ScrollArea className="flex-1" scrollFade scrollbarGutter>
                <div className="space-y-6 px-4 py-4 lg:px-5 lg:py-5">
                  <section className="space-y-4">
                    <div className="flex flex-col items-start justify-between gap-3 lg:flex-row">
                      <div className="space-y-1">
                        <h2 className="font-semibold text-lg">
                          {selectedFile.title ?? selectedFile.name}
                        </h2>
                        <p className="text-sm text-muted-foreground">
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
                      <StatCard
                        label="Documents"
                        value={formatNumber(selectedFileSummary.documentCount)}
                      />
                      <StatCard
                        label="Characters"
                        value={formatNumber(selectedFileSummary.characterCount)}
                      />
                      <StatCard
                        label="Dataset tokens"
                        value={formatNumber(selectedFileSummary.tokenCount)}
                      />
                      <StatCard
                        label="Tokenizer size"
                        value={formatNumber(selectedFileSummary.vocabSize)}
                      />
                    </div>
                  </section>

                  {selectedRun && <InspectView run={selectedRun} />}
                </div>
              </ScrollArea>

              {selectedRun || onDeleteFile ? (
                <div className="border-t border-border/70 px-4 py-4 lg:px-5">
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
                          className="w-full gap-2"
                        >
                          <Download className="size-4" />
                          Download model
                        </Button>
                        <Button
                          variant="destructive-outline"
                          onClick={onDeleteModel}
                          disabled={isTrainingRunInProgress(selectedRun.status)}
                          className="w-full gap-2"
                        >
                          <Trash2 className="size-4" />
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
                        <Trash2 className="size-4" />
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
              <ScrollArea className="flex-1" scrollFade scrollbarGutter>
                {showControls ? (
                  <div className="space-y-4 px-4 py-4 lg:px-5 lg:py-5">
                    <div className="space-y-1">
                      <h2 className="font-semibold text-lg">Training Controls</h2>
                      <p className="text-sm text-muted-foreground">
                        Adjust the browser training settings for this dataset.
                      </p>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {trainingControlFields.map((field) =>
                        field.kind === "select" ? (
                          <LabeledSelect
                            key={field.label}
                            label={field.label}
                            value={field.value}
                            onChange={field.onChange}
                            options={field.options}
                          />
                        ) : (
                          <LabeledNumberField
                            key={field.label}
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

              <div className="border-t border-border/70 px-4 py-4 lg:px-5">
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
                    {trainingActionLabel}
                    {trainingMetaLabel && (
                      <Badge
                        variant="outline"
                        className="ml-auto shrink-0 border-current/15 bg-current/10 text-inherit tabular-nums"
                      >
                        {trainingMetaLabel}
                      </Badge>
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
                  <p className="text-sm text-muted-foreground">
                    One training sample per line. Blank lines are ignored during tokenization.
                  </p>
                </div>
              </div>

              {hasVisitedSourceTab ? (
                <Suspense
                  fallback={
                    <div
                      aria-hidden
                      className="flex flex-1 items-center justify-center bg-background"
                    >
                      <Spinner className="size-5 text-muted-foreground" />
                    </div>
                  }
                >
                  <LazyCodeEditorSurface
                    ariaLabel="Source text"
                    className="flex-1"
                    showLineNumbers
                    readOnly={isTraining}
                    value={draftContent}
                    onChange={onDraftContentChange}
                  />
                </Suspense>
              ) : (
                <div className="flex-1" />
              )}

              <div className="border-t border-border/70 px-4 py-4 lg:px-5">
                <div className="flex flex-col items-stretch gap-2 lg:flex-row">
                  <Button
                    variant="outline"
                    disabled={!isDirty || isTraining}
                    className="min-w-0 w-full gap-2 lg:flex-1"
                    onClick={() => onDraftContentChange(savedContent)}
                  >
                    <RotateCcw />
                    Restore
                  </Button>
                  <Button
                    disabled={!isDirty || isTraining}
                    className="min-w-0 w-full gap-2 lg:flex-1"
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
      kind: "number";
      label: string;
      onChange: (value: number) => void;
      step: number;
      value: number;
    }
  | {
      kind: "select";
      label: string;
      onChange: (value: string) => void;
      options: Array<{ label: string; value: string }>;
      value: string;
    };

function createTrainingControlFields({
  generationConfig,
  onGenerationConfigChange,
  onTrainingConfigChange,
  trainingConfig,
}: {
  generationConfig: GenerationConfig;
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
      label: "Steps",
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
  label,
  onChange,
  step,
  value,
}: {
  label: string;
  onChange: (value: number) => void;
  step: number;
  value: number;
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
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
  label,
  onChange,
  options,
  value,
}: {
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
        value={value}
        onValueChange={(nextValue) => {
          if (nextValue) {
            onChange(nextValue);
          }
        }}
      >
        <SelectTrigger>
          <SelectValue>{selectedOption?.label ?? value}</SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
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
