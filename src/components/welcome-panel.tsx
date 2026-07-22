import { ArrowUpRight, Brain } from "lucide-react";
import { type SVGProps, useState } from "react";
import glowBg from "@/assets/glow.webp";

import { Button } from "@/components/ui/button";
import { Frame, FramePanel, FrameTitle } from "@/components/ui/frame";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "@/components/ui/preview-card";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { getWorkspaceRuntimeStatus } from "@/lib/trainer-presentation";
import { cn } from "@/lib/utils";

const WELCOME_INTRO_EASING = "cubic-bezier(0.645, 0.045, 0.355, 1)";

export function WelcomePanel({
  isHydrating,
  repoUrl,
  workerReady,
}: {
  isHydrating: boolean;
  repoUrl: string;
  workerReady: boolean;
}) {
  // Increment each time the panel becomes visible to replay enter animations
  const [heroKey] = useState(0);
  const runtimeStatus = getWorkspaceRuntimeStatus(isHydrating, workerReady);
  const runtimeIsLoading = runtimeStatus.label !== "Runtime ready";

  return (
    <Frame className="h-full overflow-hidden lg:min-h-0">
      <FramePanel className="flex flex-1 flex-col overflow-hidden p-0 lg:min-h-0">
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div
              className="absolute inset-0"
              style={{
                animation: `welcome-image-in 1.84s ${WELCOME_INTRO_EASING} both`,
                backgroundImage: `url(${glowBg})`,
                backgroundPosition: "top center",
                backgroundSize: "cover",
              }}
            />
          </div>
          <div className="relative z-10 flex flex-1 flex-col items-start justify-end p-6">
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                animation: `fade-blur-up 1.84s ${WELCOME_INTRO_EASING} both`,
                animationDelay: "280ms",
                background:
                  "linear-gradient(to top, rgba(41, 18, 48, 0.7) 0%, rgba(64, 26, 72, 0.34) 28%, rgba(119, 54, 116, 0.16) 44%, transparent 52%)",
              }}
            />
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
              style={{
                animation: `fade-blur-up 1.84s ${WELCOME_INTRO_EASING} both`,
                animationDelay: "280ms",
                backdropFilter: "blur(18px)",
                WebkitBackdropFilter: "blur(18px)",
                maskImage:
                  "linear-gradient(to top, black 0%, rgba(0, 0, 0, 0.82) 30%, rgba(0, 0, 0, 0.28) 68%, transparent 100%)",
                WebkitMaskImage:
                  "linear-gradient(to top, black 0%, rgba(0, 0, 0, 0.82) 30%, rgba(0, 0, 0, 0.28) 68%, transparent 100%)",
              }}
            />
            <div key={heroKey} className="max-w-xl space-y-5">
              <div
                className="space-y-2"
                style={{
                  animation: `fade-blur-up 1s ${WELCOME_INTRO_EASING} both`,
                  animationDelay: "600ms",
                }}
              >
                <Brain className="size-16 text-white" />
                <FrameTitle className="font-semibold text-2xl text-white">
                  Train GPT in Browser
                </FrameTitle>
              </div>
              <p
                className="text-sm text-white/80 leading-6"
                style={{
                  animation: `fade-blur-up 1s ${WELCOME_INTRO_EASING} both`,
                  animationDelay: "720ms",
                }}
              >
                Train a small character-level GPT directly in your browser. No server required. It
                learns character patterns from newline-delimited text, resumes from browser
                checkpoints, and exports <code className="font-mono">.model</code> files on demand.
              </p>
              <p
                className="text-white/60 text-xs"
                style={{
                  animation: `fade-blur-up 1s ${WELCOME_INTRO_EASING} both`,
                  animationDelay: "840ms",
                }}
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
        </div>
        <div className="relative z-10 border-border border-t bg-background px-5 py-4">
          <div className="flex flex-col items-stretch gap-2 lg:flex-row lg:gap-0">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="outline" className="w-full min-w-0 gap-2 lg:flex-1" disabled>
                    <span
                      className={cn(
                        "size-2 rounded-full",
                        runtimeIsLoading
                          ? "animate-pulse bg-muted-foreground/60"
                          : runtimeStatus.dotClass,
                      )}
                    />
                    {runtimeStatus.label}
                  </Button>
                }
              />
              <TooltipPopup>
                <div className="space-y-1.5">
                  <p>Worker: {runtimeStatus.workerLabel}</p>
                  <p>Local data: {runtimeStatus.storageLabel}</p>
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
                        aria-label="View repository on GitHub"
                      >
                        <GithubIcon />
                        View on GitHub
                        <ArrowUpRight />
                      </a>
                    }
                    variant="outline"
                    className="w-full min-w-0 gap-2 lg:ml-2 lg:flex-1"
                  />
                }
              />
              <PreviewCardPopup
                align="end"
                sideOffset={8}
                className="w-80 max-w-[calc(100vw-2rem)] text-wrap"
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <GithubIcon className="size-4 shrink-0" />
                    <span className="font-semibold text-sm">cpauldev/train-gpt-in-browser</span>
                  </div>
                  <p className="text-muted-foreground text-xs leading-5">
                    Train a character-level GPT entirely in your browser. Learn from datasets,
                    generate new strings, resume checkpoints, and export models.
                  </p>
                </div>
              </PreviewCardPopup>
            </PreviewCard>
          </div>
        </div>
      </FramePanel>
    </Frame>
  );
}

function GithubIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  );
}
