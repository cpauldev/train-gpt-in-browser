import { describe, expect, it } from "vitest";
import { getAnimationSnapDistance, resolveAnimatedValueStep } from "@/lib/use-animated-value";

describe("use-animated-value", () => {
  it("keeps small values precise", () => {
    expect(getAnimationSnapDistance(0)).toBe(0.001);
    expect(getAnimationSnapDistance(0.5)).toBe(0.001);
    expect(getAnimationSnapDistance(10)).toBe(0.01);
  });

  it("caps large values so they do not snap early", () => {
    expect(getAnimationSnapDistance(100)).toBe(0.1);
    expect(getAnimationSnapDistance(1_000)).toBe(1);
    expect(getAnimationSnapDistance(20_000_000)).toBe(1);
  });

  it("recovers when a finite target follows a non-finite current value", () => {
    expect(
      resolveAnimatedValueStep({
        current: Number.NaN,
        dt: 16.67,
        speed: 0.1,
        target: 1.98,
      }),
    ).toEqual({
      done: true,
      value: 1.98,
    });
  });

  it("keeps a non-finite target as-is so formatters can show an empty state", () => {
    const nextStep = resolveAnimatedValueStep({
      current: 1.98,
      dt: 16.67,
      speed: 0.1,
      target: Number.NaN,
    });

    expect(nextStep.done).toBe(true);
    expect(Number.isNaN(nextStep.value)).toBe(true);
  });
});
