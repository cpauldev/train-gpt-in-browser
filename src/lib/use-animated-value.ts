import { useEffect, useRef, useState } from "react";

function lerp(current: number, target: number, speed: number, dt: number): number {
  const factor = 1 - (1 - speed) ** (dt / 16.67);
  return current + (target - current) * factor;
}

/**
 * Smoothly interpolates toward a target value using frame-rate-independent
 * exponential easing.
 *
 * @param target  - The value to animate toward.
 * @param enabled - When false the value snaps instantly (e.g. training is paused).
 * @param speed   - Lerp speed per frame at 60 fps (0–1, higher = faster).
 */
export function useAnimatedValue(
  target: number,
  { enabled = true, speed = 0.1 }: { enabled?: boolean; speed?: number } = {},
): number {
  const [value, setValue] = useState(target);
  const state = useRef({ current: target, target, rafId: 0, lastTime: 0 });

  useEffect(() => {
    state.current.target = target;

    if (!enabled) {
      if (state.current.rafId) {
        cancelAnimationFrame(state.current.rafId);
        state.current.rafId = 0;
      }
      state.current.current = target;
      setValue(target);
      return;
    }

    // If a loop is already running it will pick up the updated target ref.
    if (state.current.rafId) return;

    const tick = (time: number) => {
      const dt = state.current.lastTime ? time - state.current.lastTime : 16.67;
      state.current.lastTime = time;

      const next = lerp(state.current.current, state.current.target, speed, dt);
      const range = Math.abs(state.current.target) || 1;
      const done = Math.abs(next - state.current.target) < range * 1e-3;

      state.current.current = done ? state.current.target : next;
      setValue(state.current.current);

      if (done) {
        state.current.rafId = 0;
        state.current.lastTime = 0;
      } else {
        state.current.rafId = requestAnimationFrame(tick);
      }
    };

    state.current.rafId = requestAnimationFrame(tick);
  }, [target, enabled, speed]);

  // Cleanup on unmount.
  useEffect(
    () => () => {
      if (state.current.rafId) cancelAnimationFrame(state.current.rafId);
    },
    [],
  );

  return value;
}
