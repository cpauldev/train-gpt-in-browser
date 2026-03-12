import { ArrowUpRight, Brain, Github, Heart, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import glowBg from "@/assets/glow.jpg";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Frame, FrameHeader, FramePanel, FrameTitle } from "@/components/ui/frame";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "@/components/ui/preview-card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider, SliderValue } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { clampTemperature } from "@/lib/trainer-core";
import type { GenerationConfig, RunPanelTab, TrainingRunRecord } from "@/lib/trainer-types";
import { cn } from "@/lib/utils";

const TEMPERATURE_TICKS = buildTemperatureTicks();
const TEMPERATURE_TICK_LABEL_INTERVAL = 2;
const TEMPERATURE_FORMAT = {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
} as const;
const DISPLAY_COLUMN_COUNT = 2;
const DISPLAY_ROW_COUNT = 10;

export function RunPanel({
  activeRun,
  activeTab,
  displayTitle,
  displayedResults,
  generationConfig,
  isGenerating,
  isHydrating,
  onGenerate,
  onTabChange,
  onTemperatureChange,
  onToggleLike,
  repoUrl,
  workerReady,
}: {
  activeRun: TrainingRunRecord | null;
  activeTab: RunPanelTab;
  displayTitle?: string;
  displayedResults: string[];
  generationConfig: GenerationConfig;
  isGenerating: boolean;
  isHydrating: boolean;
  onGenerate: () => void;
  onTabChange: (value: RunPanelTab) => void;
  onTemperatureChange: (value: number) => void;
  onToggleLike: (value: string) => void;
  repoUrl: string;
  workerReady: boolean;
}) {
  const likedResults = useMemo(
    () => new Set((activeRun?.likes ?? []).map((value) => normalizeLikeValue(value))),
    [activeRun?.likes],
  );

  // Increment each time the hero becomes visible to replay its enter animations.
  const [heroKey, setHeroKey] = useState(0);
  useEffect(() => {
    if (!activeRun) setHeroKey((k) => k + 1);
  }, [activeRun]);

  const runtimeStatus = getRuntimeStatus(isHydrating, workerReady);

  const isTraining = activeRun?.status === "training";
  const panelTitle = displayTitle || activeRun?.name;

  return (
    <div className="relative h-full">
      {/* Hero — always mounted so the background stays decoded. Only the
          animated text block is re-keyed to replay its enter animation. */}
      <div className={cn("absolute inset-0", activeRun && "invisible pointer-events-none")}>
        <Frame className="h-full overflow-hidden xl:min-h-0">
          <FramePanel
            className="flex flex-1 flex-col overflow-hidden p-0 xl:min-h-0"
            style={{
              backgroundImage: `url(${glowBg})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            <div
              className="flex flex-1 flex-col items-start justify-end p-6"
              style={{
                background:
                  "linear-gradient(to top, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.3) 40%, transparent 65%)",
              }}
            >
              <div key={heroKey} className="space-y-5">
                <div
                  className="space-y-2"
                  style={{ animation: "fade-blur-up 0.6s ease-out both", animationDelay: "600ms" }}
                >
                  <Brain className="size-16 text-white" />
                  <FrameTitle className="text-2xl font-semibold text-white">
                    Train GPT in Browser
                  </FrameTitle>
                </div>
                <p
                  className="text-sm leading-6 text-white/80"
                  style={{ animation: "fade-blur-up 0.6s ease-out both", animationDelay: "720ms" }}
                >
                  Train a small GPT model directly in your browser — no server required. Built-in
                  datasets copy to local storage, edits stay local, and runs resume from browser
                  checkpoints. Export trained models as <code className="font-mono">.model</code>{" "}
                  files on demand.
                </p>
                <p
                  className="text-sm leading-6 text-white/80"
                  style={{ animation: "fade-blur-up 0.6s ease-out both", animationDelay: "840ms" }}
                >
                  Choose a dataset on the left, then start training to see results here.
                </p>
                <p
                  className="text-xs text-white/60"
                  style={{ animation: "fade-blur-up 0.6s ease-out both", animationDelay: "960ms" }}
                >
                  Research and implementation by Christian Paul{" "}
                  <a
                    href="https://github.com/cpauldev"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 hover:text-white/80"
                  >
                    @cpauldev
                  </a>
                </p>
              </div>
            </div>
            <div className="border-t border-border bg-white px-5 py-4">
              <div className="flex items-stretch">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button variant="outline" className="min-w-0 flex-1 gap-2" disabled>
                        <span className={cn("size-2 rounded-full", runtimeStatus.dotClass)} />
                        {runtimeStatus.label}
                      </Button>
                    }
                  />
                  <TooltipPopup>
                    <div className="space-y-1.5">
                      <p>Worker: {workerReady ? "Ready" : "Starting"}</p>
                      <p>Local data: {isHydrating ? "Loading" : "Ready"}</p>
                    </div>
                  </TooltipPopup>
                </Tooltip>
                <PreviewCard>
                  <PreviewCardTrigger
                    delay={300}
                    render={
                      <Button
                        render={
                          <a
                            href={repoUrl}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="Open repository"
                          >
                            <Github />
                            Repo
                            <ArrowUpRight />
                          </a>
                        }
                        variant="outline"
                        className="ml-2 min-w-0 flex-1 gap-2"
                      />
                    }
                  />
                  <PreviewCardPopup align="end" sideOffset={8} className="w-80 text-wrap">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Github className="size-4 shrink-0" />
                        <span className="font-semibold text-sm">cpauldev/train-gpt-in-browser</span>
                      </div>
                      <p className="text-xs leading-5 text-muted-foreground">
                        Train a small GPT model directly in your browser. No server required — runs
                        on browser checkpoints with local storage.
                      </p>
                      <a
                        href={repoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-foreground underline-offset-4 hover:underline"
                      >
                        View on GitHub
                        <ArrowUpRight className="size-3" />
                      </a>
                    </div>
                  </PreviewCardPopup>
                </PreviewCard>
              </div>
            </div>
          </FramePanel>
        </Frame>
      </div>

      {/* Active run panel — conditionally mounted */}
      {activeRun && (
        <div className="absolute inset-0">
          <Frame className="h-full overflow-hidden xl:min-h-0">
            <FrameHeader className="min-h-16 justify-center">
              <FrameTitle className="text-3xl font-semibold tracking-tight">
                {panelTitle}
              </FrameTitle>
            </FrameHeader>

            <FramePanel className="space-y-5">
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
                  className="w-full"
                >
                  <div className="mb-2 flex items-center justify-between gap-1">
                    <FieldLabel className="font-medium text-sm">Temperature</FieldLabel>
                    <Badge
                      render={<SliderValue />}
                      variant="outline"
                      className="text-muted-foreground"
                    />
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
                disabled={!activeRun.checkpoint || isGenerating || isTraining}
                size="xl"
                className="w-full"
              >
                {isGenerating ? (
                  <>
                    <Spinner />
                    Generating
                  </>
                ) : isTraining ? (
                  "Training"
                ) : (
                  "Generate"
                )}
              </Button>
            </FramePanel>

            <FramePanel className="flex min-h-0 flex-1 flex-col p-0">
              <Tabs
                value={activeTab}
                onValueChange={(value) => onTabChange(value as RunPanelTab)}
                className="min-h-0 flex-1 gap-0"
              >
                <div className="px-5 pt-4">
                  <TabsList variant="underline">
                    <TabsTab value="generated">
                      <Sparkles className="opacity-60" />
                      Generated
                    </TabsTab>
                    <TabsTab value="likes">
                      <Heart className="opacity-60" />
                      Likes
                      {activeRun.likes.length > 0 ? (
                        <Badge
                          className="not-in-data-active:text-muted-foreground"
                          variant="outline"
                        >
                          {activeRun.likes.length}
                        </Badge>
                      ) : null}
                    </TabsTab>
                  </TabsList>
                </div>

                <TabsPanel value="generated" className="flex min-h-[28rem] flex-col p-0">
                  {displayedResults.length === 0 ? (
                    <Empty>
                      <EmptyHeader>
                        <EmptyTitle>Nothing to show yet</EmptyTitle>
                        <EmptyDescription>
                          No generated samples for this temperature yet.
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    <ScrollArea className="h-full" scrollFade scrollbarGutter>
                      <ResultsTable
                        ariaLabel={`${panelTitle} generated results`}
                        items={displayedResults}
                        likedResults={likedResults}
                        minimumRowCount={DISPLAY_ROW_COUNT}
                        onToggleLike={onToggleLike}
                        rowAction="like"
                      />
                    </ScrollArea>
                  )}
                </TabsPanel>
                <TabsPanel value="likes" className="flex min-h-[28rem] flex-col p-0">
                  {activeRun.likes.length === 0 ? (
                    <Empty>
                      <EmptyHeader>
                        <EmptyTitle>No likes yet</EmptyTitle>
                        <EmptyDescription>Heart a result to keep it here.</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    <ScrollArea className="h-full" scrollFade scrollbarGutter>
                      <ResultsTable
                        ariaLabel={`${panelTitle} liked results`}
                        items={activeRun.likes}
                        likedResults={likedResults}
                        onToggleLike={onToggleLike}
                        rowAction="remove"
                      />
                    </ScrollArea>
                  )}
                </TabsPanel>
              </Tabs>
            </FramePanel>
          </Frame>
        </div>
      )}
    </div>
  );
}

function ResultsTable({
  ariaLabel,
  items,
  likedResults,
  minimumRowCount = 0,
  onToggleLike,
  rowAction,
}: {
  ariaLabel: string;
  items: string[];
  likedResults: Set<string>;
  minimumRowCount?: number;
  onToggleLike: (value: string) => void;
  rowAction: "like" | "remove";
}) {
  return (
    <Table aria-label={ariaLabel} className="table-fixed">
      <TableBody className="before:hidden shadow-none *:[tr]:*:[td]:border-0 *:[tr]:*:[td]:bg-transparent *:[tr]:*:[td]:first:border-s-0 *:[tr]:*:[td]:last:border-e-0 *:[tr]:first:*:[td]:border-t-0">
        {buildResultRows(items, minimumRowCount).map((row) => (
          <TableRow key={`${ariaLabel}-${row.key}`}>
            {row.cells.map((cell) => (
              <TableCell
                key={`${ariaLabel}-${cell.key}`}
                className="w-1/2 max-w-0 min-w-0 overflow-hidden py-0"
              >
                <ResultCell
                  value={cell.value}
                  isLiked={likedResults.has(normalizeLikeValue(cell.value))}
                  onToggleLike={onToggleLike}
                  rowAction={rowAction}
                />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ResultCell({
  isLiked,
  onToggleLike,
  rowAction,
  value,
}: {
  isLiked: boolean;
  onToggleLike: (value: string) => void;
  rowAction: "like" | "remove";
  value: string;
}) {
  if (!value) {
    return (
      <div className="flex h-11 min-w-0 items-center gap-2 px-4 sm:h-10">
        <span className="invisible block flex-1 truncate">Placeholder</span>
        <span aria-hidden className="size-5 shrink-0" />
      </div>
    );
  }

  return (
    <Button
      aria-label={rowAction === "remove" ? `Remove ${value} from likes` : `Like ${value}`}
      aria-pressed={rowAction === "like" ? isLiked : undefined}
      size="xl"
      variant="ghost"
      className={cn(
        "max-w-full min-w-0 w-full justify-between overflow-hidden font-medium hover:text-foreground",
        rowAction === "like" && isLiked && "text-red-500 hover:text-red-500",
      )}
      onClick={() => onToggleLike(value)}
    >
      <span className="block min-w-0 flex-1 overflow-hidden truncate text-left">{value}</span>
      {rowAction === "remove" ? (
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

function buildResultRows(items: string[], minimumRowCount = 0) {
  const rowCount = Math.max(minimumRowCount, Math.ceil(items.length / DISPLAY_COLUMN_COUNT));

  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const startIndex = rowIndex * DISPLAY_COLUMN_COUNT;
    const leftValue = items[startIndex] ?? "";
    const rightValue = items[startIndex + 1] ?? "";

    return {
      cells: [
        {
          key: leftValue ? `left-${rowIndex}-${leftValue}` : `left-${rowIndex}-empty`,
          value: leftValue,
        },
        {
          key: rightValue ? `right-${rowIndex}-${rightValue}` : `right-${rowIndex}-empty`,
          value: rightValue,
        },
      ],
      key: `${leftValue || `left-empty-${rowIndex}`}-${rightValue || `right-empty-${rowIndex}`}`,
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

function getRuntimeStatus(hydrating: boolean, workerReady: boolean) {
  if (workerReady && !hydrating) {
    return { dotClass: "bg-green-500", label: "Runtime ready" };
  }
  if (workerReady) {
    return { dotClass: "bg-blue-500", label: "Loading data" };
  }
  return { dotClass: "bg-yellow-500", label: "Starting runtime" };
}
