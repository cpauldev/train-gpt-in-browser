import type React from "react";
import { cn } from "@/lib/utils";

export function TextShimmer({
  as: Component = "span",
  children,
  className,
  color = "color-mix(in srgb, currentcolor 62%, transparent)",
  duration = 1.8,
  shineColor = "currentcolor",
  spread = 120,
}: {
  as?: React.ElementType;
  children: React.ReactNode;
  className?: string;
  color?: string;
  duration?: number;
  shineColor?: string;
  spread?: number;
}) {
  return (
    <Component
      className={cn("inline-block bg-clip-text text-transparent", className)}
      style={{
        color: "inherit",
        animation: `text-shimmer ${duration}s linear infinite`,
        backgroundImage: `linear-gradient(${spread}deg, ${color} 0%, ${color} 35%, ${shineColor} 50%, ${color} 65%, ${color} 100%)`,
        backgroundSize: "200% auto",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
      }}
    >
      {children}
    </Component>
  );
}
