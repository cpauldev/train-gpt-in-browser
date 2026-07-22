import { Brain, Heart, Sparkles, X } from "lucide-react";
import { type CSSProperties, useMemo } from "react";
import { PanelHeader } from "@/components/panel-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Frame, FramePanel } from "@/components/ui/frame";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider, SliderValue } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { useIsMobile } from "@/hooks/use-media-query";
import { clampTemperature } from "@/lib/trainer-core";
import {
  type GenerationConfig,
  isTrainingRunInProgress,
  type ResultsTab,
  type TrainingRunRecord,
} from "@/lib/trainer-types";
import { cn } from "@/lib/utils";

const TEMPERATURE_TICKS = buildTemperatureTicks();
const TEMPERATURE_TICK_LABEL_INTERVAL = 2;
const TEMPERATURE_FORMAT = {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
} as const;
const DEFAULT_DISPLAY_COLUMN_COUNT = 2;
const DISPLAY_ROW_COUNT = 10;
const RESULT_ROW_MIN_HEIGHT_PX = 52;

export function ResultsPanel({
  activeRun,
  activeTab,
  displayTitle,
  displayedResults,
  generationProgress,
  generationConfig,
  isGenerating,
  onGenerate,
  onResetLocalData,
  pendingResultIndexes = new Set(),
  onTabChange,
  onTemperatureChange,
  onToggleLike,
}: {
  activeRun: TrainingRunRecord | null;
  activeTab: ResultsTab;
  displayTitle?: string;
  displayedResults: string[];
  generationProgress?: {
    completedSamples: number;
    tokensPerSecond: number;
    totalSamples: number;
  } | null;
  generationConfig: GenerationConfig;
  isGenerating: boolean;
  onGenerate: () => void;
  onResetLocalData?: () => void;
  pendingResultIndexes?: Set<number>;
  onTabChange: (value: ResultsTab) => void;
  onTemperatureChange: (value: number) => void;
  onToggleLike: (value: string) => void;
}) {
  const isMobile = useIsMobile();
  const displayColumnCount = isMobile ? 1 : DEFAULT_DISPLAY_COLUMN_COUNT;
  const likedResults = useMemo(
    () => new Set((activeRun?.likes ?? []).map((value) => normalizeLikeValue(value))),
    [activeRun?.likes],
  );

  const isTraining = activeRun ? isTrainingRunInProgress(activeRun.status) : false;
  const hasReadyCheckpoint = Boolean(activeRun?.checkpoint || activeRun?.checkpointSavedAt);
  const panelTitle = displayTitle || activeRun?.name || "Results";

  // Always show the panel UI, just disable it when there's no active run
  return (
    <ActiveRunPanelFrame
      activeRun={activeRun}
      activeTab={activeTab}
      displayColumnCount={displayColumnCount}
      displayedResults={displayedResults}
      generationProgress={generationProgress}
      generationConfig={generationConfig}
      hasReadyCheckpoint={hasReadyCheckpoint}
      isGenerating={isGenerating}
      isTraining={isTraining}
      onGenerate={onGenerate}
      onResetLocalData={onResetLocalData}
      pendingResultIndexes={pendingResultIndexes}
      onTabChange={onTabChange}
      onTemperatureChange={onTemperatureChange}
      onToggleLike={onToggleLike}
      panelTitle={panelTitle}
      likedResults={likedResults}
    />
  );
}

function ActiveRunPanelFrame({
  activeRun,
  activeTab,
  displayColumnCount,
  displayedResults,
  generationProgress,
  generationConfig,
  hasReadyCheckpoint,
  isGenerating,
  isTraining,
  likedResults,
  onGenerate,
  onResetLocalData,
  pendingResultIndexes,
  onTabChange,
  onTemperatureChange,
  onToggleLike,
  panelTitle,
}: {
  activeRun: TrainingRunRecord | null;
  activeTab: ResultsTab;
  displayColumnCount: number;
  displayedResults: string[];
  generationProgress?: {
    completedSamples: number;
    tokensPerSecond: number;
    totalSamples: number;
  } | null;
  generationConfig: GenerationConfig;
  hasReadyCheckpoint: boolean;
  isGenerating: boolean;
  isTraining: boolean;
  likedResults: Set<string>;
  onGenerate: () => void;
  onResetLocalData?: () => void;
  pendingResultIndexes: Set<number>;
  onTabChange: (value: ResultsTab) => void;
  onTemperatureChange: (value: number) => void;
  onToggleLike: (value: string) => void;
  panelTitle?: string;
}) {
  const likesCount = activeRun?.likes.length || 0;
  const hasNoRun = !activeRun;
  const isSampling = Boolean(generationProgress);
  const generationActionLabel = displayedResults.length > 0 ? "Regenerate" : "Generate";
  const generationCounterLabel = generationProgress
    ? `${generationProgress.completedSamples}/${generationProgress.totalSamples}`
    : null;
  const generationThroughputLabel = generationProgress
    ? `${Math.round(generationProgress.tokensPerSecond).toLocaleString("en-US")} tokens/s`
    : null;

  return (
    <Frame className="h-full overflow-hidden lg:min-h-0">
      <PanelHeader onResetLocalData={onResetLocalData} showSettings title="Results" />

      <FramePanel className="flex min-h-0 flex-1 flex-col p-0">
        <Tabs
          value={activeTab}
          onValueChange={(value) => onTabChange(value as ResultsTab)}
          className="min-h-0 flex-1 gap-0"
        >
          <div className="border-border/70 border-b px-4 pt-3 lg:px-5 lg:pt-4">
            <TabsList variant="underline" className="min-w-max">
              <TabsTab value="generated">
                <Sparkles className="opacity-60" />
                Generated
              </TabsTab>
              <TabsTab value="likes">
                <Heart className="opacity-60" />
                Likes
                {likesCount > 0 ? (
                  <Badge className="not-in-data-active:text-muted-foreground" variant="outline">
                    {likesCount}
                  </Badge>
                ) : null}
              </TabsTab>
            </TabsList>
          </div>

          <TabsPanel value="generated" className="min-h-0 flex-1 p-0">
            <div className="flex h-full min-h-0 flex-col">
              {displayedResults.length === 0 && !isGenerating ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>
                      {hasNoRun ? "Ready to generate" : "Nothing to show yet"}
                    </EmptyTitle>
                    <EmptyDescription>
                      {hasNoRun
                        ? "Complete training first, then generate samples here."
                        : "No generated samples for this temperature yet."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ScrollArea className="flex-1" fill scrollFade>
                  <ResultsTable
                    ariaLabel={`${panelTitle} generated results`}
                    fillHeight
                    items={displayedResults}
                    likedResults={likedResults}
                    minimumRowCount={DISPLAY_ROW_COUNT}
                    onToggleLike={onToggleLike}
                    pendingResultIndexes={pendingResultIndexes}
                    rowAction="like"
                    columnCount={displayColumnCount}
                    isGenerating={isGenerating}
                  />
                </ScrollArea>
              )}
            </div>
          </TabsPanel>

          <TabsPanel value="likes" className="min-h-0 flex-1 p-0">
            <div className="flex h-full min-h-0 flex-col">
              {likesCount === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>No likes yet</EmptyTitle>
                    <EmptyDescription>
                      {hasNoRun
                        ? "Generate results to like them."
                        : "Heart a result to keep it here."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ScrollArea className="flex-1" scrollFade>
                  <ResultsTable
                    ariaLabel={`${panelTitle} liked results`}
                    items={activeRun?.likes || []}
                    likedResults={likedResults}
                    onToggleLike={onToggleLike}
                    rowAction="remove"
                    columnCount={displayColumnCount}
                  />
                </ScrollArea>
              )}
            </div>
          </TabsPanel>
        </Tabs>

        <div className="border-border/70 border-t px-4 py-4 lg:px-5">
          <div className="space-y-4">
            <Field>
              <Slider
                aria-label="Generation temperature"
                min={0.4}
                max={1.4}
                step={0.1}
                format={TEMPERATURE_FORMAT}
                value={generationConfig.temperature}
                onValueChange={(value) => {
                  const nextValue = Array.isArray(value) ? value[0] : value;
                  onTemperatureChange(Number(nextValue ?? generationConfig.temperature));
                }}
                disabled={hasNoRun}
                className="w-full"
              >
                <div className="mb-2 flex items-center justify-between gap-1">
                  <FieldLabel className="font-medium text-sm">Temperature</FieldLabel>
                  <Badge render={<SliderValue />} variant="outline" />
                </div>
              </Slider>

              {/* biome-ignore lint/a11y/useSemanticElements: Match the documented COSS slider scale pattern. */}
              <div
                aria-label="Temperature scale from 0.4 to 1.4"
                className="mt-3 flex w-full items-center justify-between gap-1 px-2.5 font-medium text-muted-foreground text-xs"
                role="group"
              >
                {TEMPERATURE_TICKS.map((tick, index) => (
                  <span
                    className="flex w-0 flex-col items-center justify-center gap-2"
                    key={String(tick)}
                  >
                    <span
                      className={cn(
                        "h-1 w-px bg-muted-foreground/70",
                        index % TEMPERATURE_TICK_LABEL_INTERVAL !== 0 && "h-0.5",
                      )}
                    />
                    <span
                      className={cn(index % TEMPERATURE_TICK_LABEL_INTERVAL !== 0 && "opacity-0")}
                    >
                      {tick}
                    </span>
                  </span>
                ))}
              </div>
            </Field>

            <Button
              onClick={onGenerate}
              disabled={hasNoRun || !hasReadyCheckpoint || isGenerating || isTraining}
              className="w-full min-w-0 gap-2"
            >
              {isGenerating || isSampling ? <Spinner /> : null}
              {!hasNoRun && !isTraining && !isGenerating && !isSampling ? <Brain /> : null}
              {hasNoRun ? (
                "Train to Generate"
              ) : isSampling ? (
                <TextShimmer>
                  Sampling{generationCounterLabel ? ` ${generationCounterLabel}` : ""}
                </TextShimmer>
              ) : isTraining ? (
                <TextShimmer>Training</TextShimmer>
              ) : isGenerating ? (
                <TextShimmer>Generating</TextShimmer>
              ) : (
                generationActionLabel
              )}
              {generationThroughputLabel ? (
                <div className="ml-auto shrink-0 tabular-nums">{generationThroughputLabel}</div>
              ) : null}
            </Button>
          </div>
        </div>
      </FramePanel>
    </Frame>
  );
}

function ResultsTable({
  ariaLabel,
  columnCount = DEFAULT_DISPLAY_COLUMN_COUNT,
  items,
  likedResults,
  minimumRowCount = 0,
  onToggleLike,
  pendingResultIndexes = new Set(),
  rowAction,
  isGenerating = false,
  fillHeight = false,
}: {
  ariaLabel: string;
  columnCount?: number;
  fillHeight?: boolean;
  items: string[];
  likedResults: Set<string>;
  minimumRowCount?: number;
  onToggleLike: (value: string) => void;
  pendingResultIndexes?: Set<number>;
  rowAction: "like" | "remove";
  isGenerating?: boolean;
}) {
  const rows = buildResultRows(items, minimumRowCount, columnCount);
  const shouldFillHeight = fillHeight && rows.length <= minimumRowCount;

  return (
    <div
      className={cn(
        shouldFillHeight &&
          "h-full min-h-(--results-table-min-height) [&>[data-slot=table-container]]:h-full [&_[data-slot=table]]:h-full",
      )}
      style={
        shouldFillHeight
          ? ({
              "--results-table-min-height": `${rows.length * RESULT_ROW_MIN_HEIGHT_PX}px`,
            } as CSSProperties)
          : undefined
      }
    >
      <Table aria-label={ariaLabel} className={cn(columnCount > 1 && "table-fixed")}>
        <TableBody className="*:[tr]:hover:!bg-transparent shadow-none before:hidden *:[tr]:*:[td]:border-0 *:[tr]:*:[td]:bg-transparent *:[tr]:*:[td]:first:border-s-0 *:[tr]:first:*:[td]:border-t-0 *:[tr]:*:[td]:last:border-e-0">
          {rows.map((row) => (
            <TableRow
              key={`${ariaLabel}-${row.key}`}
              className="hover:!bg-transparent"
              style={shouldFillHeight ? { height: `${100 / rows.length}%` } : undefined}
            >
              {row.cells.map((cell) => (
                <TableCell
                  key={`${ariaLabel}-${cell.key}`}
                  className={cn(
                    "min-w-0 max-w-0 overflow-hidden py-1",
                    columnCount > 1 ? "w-1/2" : "w-full",
                  )}
                >
                  <ResultCell
                    value={cell.value}
                    isLiked={likedResults.has(normalizeLikeValue(cell.value))}
                    isPending={pendingResultIndexes.has(cell.index)}
                    onToggleLike={onToggleLike}
                    rowAction={rowAction}
                    isGenerating={isGenerating}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ResultCell({
  isLiked,
  isPending = false,
  onToggleLike,
  rowAction,
  value,
  isGenerating = false,
}: {
  isLiked: boolean;
  isPending?: boolean;
  onToggleLike: (value: string) => void;
  rowAction: "like" | "remove";
  value: string;
  isGenerating?: boolean;
}) {
  if (!value) {
    return (
      <div className="flex h-11 min-w-0 items-center gap-2 px-4 sm:h-10">
        {isGenerating ? (
          <Skeleton className="h-5 min-w-0 flex-1" />
        ) : (
          <span aria-hidden className="invisible block h-5 min-w-0 flex-1" />
        )}
        <span aria-hidden className="size-5 shrink-0" />
      </div>
    );
  }

  return (
    <Button
      aria-label={rowAction === "remove" ? `Remove ${value} from likes` : `Like ${value}`}
      aria-pressed={rowAction === "like" ? isLiked : undefined}
      disabled={isPending}
      size="xl"
      variant="ghost"
      className={cn(
        "w-full min-w-0 max-w-full justify-between overflow-hidden font-medium hover:text-foreground",
        rowAction === "like" && isLiked && "text-red-500 hover:text-red-500",
      )}
      onClick={() => onToggleLike(value)}
    >
      <span className="block min-w-0 flex-1 overflow-hidden truncate text-left">{value}</span>
      {isPending ? (
        <span aria-hidden className="size-4.5 shrink-0 sm:size-4" />
      ) : rowAction === "remove" ? (
        <X aria-hidden className="shrink-0 text-muted-foreground" />
      ) : (
        <Heart
          aria-hidden
          className={cn("shrink-0 text-muted-foreground", isLiked && "fill-current text-red-500")}
        />
      )}
    </Button>
  );
}

function buildResultRows(
  items: string[],
  minimumRowCount = 0,
  columnCount = DEFAULT_DISPLAY_COLUMN_COUNT,
) {
  const rowCount = Math.max(minimumRowCount, Math.ceil(items.length / columnCount));

  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const cells = Array.from({ length: columnCount }, (_, columnIndex) => {
      const value = items[rowIndex * columnCount + columnIndex] ?? "";

      return {
        key: value
          ? `col-${columnIndex}-${rowIndex}-${value}`
          : `col-${columnIndex}-${rowIndex}-empty`,
        value,
        index: rowIndex * columnCount + columnIndex,
      };
    });

    return {
      cells,
      key: cells.map((cell) => cell.key).join("-"),
    };
  });
}

function buildTemperatureTicks() {
  const tickCount = Math.round((1.4 - 0.4) / 0.1);
  return Array.from({ length: tickCount + 1 }, (_, index) =>
    clampTemperature(0.4 + index * 0.1).toFixed(1),
  );
}

function normalizeLikeValue(value: string) {
  return value.trim();
}
