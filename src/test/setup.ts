import "fake-indexeddb/auto";

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

Object.defineProperty(window, "IntersectionObserver", {
  configurable: true,
  value: class IntersectionObserver {
    disconnect() {}
    observe() {}
    unobserve() {}
  },
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.localStorage.clear();
});
