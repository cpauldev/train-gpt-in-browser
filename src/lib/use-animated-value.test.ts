import { describe, expect, it } from "vitest";
import { getAnimationSnapDistance } from "@/lib/use-animated-value";

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
});
