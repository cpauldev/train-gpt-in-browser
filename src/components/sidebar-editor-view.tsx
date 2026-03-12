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
import { useEffect, useState } from "react";

import { CodeEditorSurface } from "@/components/code-editor-surface";
import { InspectView } from "@/components/inspect-view";
import { SidebarFrameHeader } from "@/components/sidebar-frame-header";
import { TrainingLiveStats } from "@/components/training-live-stats";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Frame, FramePanel } from "@/components/ui/frame";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { Toggle } from "@/components/ui/toggle";
import { formatNumber } from "@/lib/trainer-core";
import {
  createGenerationConfig,
  type GenerationConfig,
  type TrainingConfig,
  type TrainingRunRecord,
  type WorkspaceFile,
} from "@/lib/trainer-types";
import { getLatestTrainingTelemetry } from "@/lib/training-telemetry";
import { useAnimatedValue } from "@/lib/use-animated-value";

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
  onSaveContent: (content: string) => void;
  onGenerationConfigChange: (
    config: GenerationConfig | ((current: GenerationConfig) => GenerationConfig),
  ) => void;
  onResumeTraining?: () => void;
  onStartTraining: () => Promise<void>;
  onTrainingConfigChange: (
    config: TrainingConfig | ((current: TrainingConfig) => TrainingConfig),
  ) => void;
  selectedFile: WorkspaceFile | null;
  selectedFileSummary: {
    characterCount: number;
    documents: string[];
    lineCount: number;
    tokenCount: number;
    vocabSize: number;
  } | null;
  selectedRun: TrainingRunRecord | null;
  trainingConfig: TrainingConfig;
}) {
  const [activeTab, setActiveTab] = useState<"overview" | "training" | "source">("overview");
  const [showControls, setShowControls] = useState(false);
  const [savedContent, setSavedContent] = useState(selectedFile?.content ?? "");
  const isDirty = draftContent !== savedContent;

  // Reset saved content baseline when switching files.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally only resets on file id change
  useEffect(() => {
    setSavedContent(selectedFile?.content ?? "");
  }, [selectedFile?.id]);

  const handleSaveContent = () => {
    onSaveContent(draftContent);
    setSavedContent(draftContent);
  };

  const canContinueTraining = Boolean(selectedRun?.checkpoint);
  const rawEtaSeconds = isTraining
    ? computeEtaSeconds(getLatestTrainingTelemetry(selectedRun?.telemetry ?? []))
    : null;
  const animatedEtaSeconds = useAnimatedValue(rawEtaSeconds ?? 0, {
    enabled: rawEtaSeconds !== null,
  });
  const trainingEta = rawEtaSeconds !== null ? formatEtaSeconds(animatedEtaSeconds) : null;
  const trainingActionLabel = isTraining
    ? "Training in progress"
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

  useEffect(() => {
    if (selectedRun?.status !== "training") {
      return;
    }

    setActiveTab("training");
  }, [selectedRun?.status]);

  if (!selectedFile || !selectedFileSummary) {
    return (
      <Frame className="h-full overflow-hidden xl:min-h-0">
        <SidebarFrameHeader onBack={onBack} onResetLocalData={onResetLocalData} title="Workspace" />
        <FramePanel className="flex flex-1 items-center justify-center xl:min-h-0">
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
    <Frame className="h-full overflow-hidden xl:min-h-0">
      <SidebarFrameHeader
        onBack={onBack}
        onResetLocalData={onResetLocalData}
        title={selectedFile.title ?? selectedFile.name}
      />

      <FramePanel className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as "overview" | "training" | "source")}
          className="min-h-0 flex-1 gap-0"
        >
          <div className="border-b border-border/70 px-5 pt-4">
            <TabsList variant="underline">
              <TabsTab value="overview">
                <LayoutPanelTop className="opacity-60" />
                Overview
              </TabsTab>
              <TabsTab value="training">
                <Play className="opacity-60" />
                Training
              </TabsTab>
              <TabsTab value="source">
                <TextCursorInput className="opacity-60" />
                Source
              </TabsTab>
            </TabsList>
          </div>

          <TabsPanel value="overview" className="min-h-0 p-0">
            <div className="flex h-full min-h-0 flex-col">
              <ScrollArea className="flex-1" scrollFade scrollbarGutter>
                <div className="space-y-6 px-5 py-5">
                  <section className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
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

                    <div className="grid gap-3 sm:grid-cols-2">
                      <StatCard
                        label="Documents"
                        value={formatNumber(selectedFileSummary.documents.length)}
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
                <div className="border-t border-border/70 px-5 py-4">
                  <div className="space-y-2">
                    {selectedRun ? (
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          variant="outline"
                          onClick={() => onDownloadModel?.()}
                          disabled={!selectedRun.checkpoint || selectedRun.status === "training"}
                          className="w-full gap-2"
                        >
                          <Download className="size-4" />
                          Download model
                        </Button>
                        <Button
                          variant="destructive-outline"
                          onClick={onDeleteModel}
                          disabled={selectedRun.status === "training"}
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
                  <div className="space-y-4 px-5 py-5">
                    <div className="space-y-1">
                      <h2 className="font-semibold text-lg">Training Controls</h2>
                      <p className="text-sm text-muted-foreground">
                        Adjust the browser training settings for this dataset.
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <LabeledSelect
                        label="Backend"
                        value={trainingConfig.requestedBackend}
                        onChange={(value) =>
                          onTrainingConfigChange((current) => ({
                            ...current,
                            requestedBackend: value as TrainingConfig["requestedBackend"],
                          }))
                        }
                        options={[
                          { label: "Auto", value: "auto" },
                          { label: "WebGPU", value: "webgpu" },
                          { label: "CPU", value: "cpu" },
                        ]}
                      />
                      <LabeledNumberField
                        label="Seed"
                        step={1}
                        value={trainingConfig.seed}
                        onChange={(value) =>
                          onTrainingConfigChange((current) => ({
                            ...current,
                            seed: Math.max(1, value),
                          }))
                        }
                      />
                      <LabeledNumberField
                        label="Steps"
                        step={1}
                        value={trainingConfig.steps}
                        onChange={(value) =>
                          onTrainingConfigChange((current) => ({
                            ...current,
                            steps: Math.max(1, value),
                          }))
                        }
                      />
                      <LabeledNumberField
                        label="Batch size"
                        step={1}
                        value={trainingConfig.batchSize}
                        onChange={(value) =>
                          onTrainingConfigChange((current) => ({
                            ...current,
                            batchSize: Math.max(1, value),
                          }))
                        }
                      />
                      <LabeledNumberField
                        label="Block size"
                        step={1}
                        value={trainingConfig.model.blockSize}
                        onChange={(value) =>
                          onTrainingConfigChange((current) => ({
                            ...current,
                            model: { ...current.model, blockSize: Math.max(1, value) },
                          }))
                        }
                      />
                      <LabeledNumberField
                        label="Layers"
                        step={1}
                        value={trainingConfig.model.nLayer}
                        onChange={(value) =>
                          onTrainingConfigChange((current) => ({
                            ...current,
                            model: { ...current.model, nLayer: Math.max(1, value) },
                          }))
                        }
                      />
                      <LabeledNumberField
                        label="Embedding width"
                        step={1}
                        value={trainingConfig.model.nEmbd}
                        onChange={(value) =>
                          onTrainingConfigChange((current) => ({
                            ...current,
                            model: { ...current.model, nEmbd: Math.max(1, value) },
                          }))
                        }
                      />
                      <LabeledNumberField
                        label="Attention heads"
                        step={1}
                        value={trainingConfig.model.nHead}
                        onChange={(value) =>
                          onTrainingConfigChange((current) => ({
                            ...current,
                            model: { ...current.model, nHead: Math.max(1, value) },
                          }))
                        }
                      />
                      <LabeledNumberField
                        label="Learning rate"
                        step={0.0001}
                        value={trainingConfig.learningRate}
                        onChange={(value) =>
                          onTrainingConfigChange((current) => ({
                            ...current,
                            learningRate: Math.max(0.0000001, value),
                          }))
                        }
                      />
                      <LabeledNumberField
                        label="Weight decay"
                        step={0.001}
                        value={trainingConfig.weightDecay}
                        onChange={(value) =>
                          onTrainingConfigChange((current) => ({
                            ...current,
                            weightDecay: Math.max(0, value),
                          }))
                        }
                      />
                      <LabeledNumberField
                        label="Samples after train"
                        step={1}
                        value={generationConfig.numSamples}
                        onChange={(value) =>
                          onGenerationConfigChange((current) =>
                            createGenerationConfig({
                              ...current,
                              numSamples: Math.max(1, value),
                            }),
                          )
                        }
                      />
                      <LabeledNumberField
                        label="Default temperature"
                        step={0.1}
                        value={generationConfig.temperature}
                        onChange={(value) =>
                          onGenerationConfigChange((current) =>
                            createGenerationConfig({
                              ...current,
                              temperature: Math.min(1.4, Math.max(0.4, Number(value.toFixed(1)))),
                            }),
                          )
                        }
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <TrainingLiveStats isTraining={isTraining} run={selectedRun} />
                  </div>
                )}
              </ScrollArea>

              <div className="border-t border-border/70 px-5 py-4">
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
                    {trainingEta && (
                      <Badge
                        variant="outline"
                        className="ml-auto shrink-0 bg-white/10 border-white/20 text-white tabular-nums"
                      >
                        {trainingEta}
                      </Badge>
                    )}
                  </Button>
                  <Toggle
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
              <div className="border-border/70 border-b px-5 py-5">
                <div className="min-w-0 space-y-1">
                  <h2 className="font-semibold text-lg">Source Text</h2>
                  <p className="text-sm text-muted-foreground">
                    One training sample per line. Blank lines are ignored during tokenization.
                  </p>
                </div>
              </div>

              <CodeEditorSurface
                ariaLabel="Source text"
                className="flex-1"
                showLineNumbers
                readOnly={isTraining}
                value={draftContent}
                onChange={onDraftContentChange}
              />

              <div className="border-t border-border/70 px-5 py-4">
                <div className="flex items-stretch gap-2">
                  <Button
                    variant="outline"
                    disabled={!isDirty || isTraining}
                    className="min-w-0 flex-1 gap-2"
                    onClick={() => onDraftContentChange(savedContent)}
                  >
                    <RotateCcw />
                    Restore
                  </Button>
                  <Button
                    disabled={!isDirty || isTraining}
                    className="min-w-0 flex-1 gap-2"
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

function formatEtaSeconds(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  if (s < 60) return `${s}s`;
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background px-4 py-3">
      <Label render={<div />} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="mt-1 font-semibold text-lg">{value}</div>
    </div>
  );
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
        onChange={(event) => onChange(Number(event.currentTarget.value))}
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
