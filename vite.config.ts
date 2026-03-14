/// <reference types="vitest/config" />

import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const basePath = process.env.VITE_BASE_PATH || "./";

function resolveManualChunk(id: string) {
  const normalizedId = id.replaceAll("\\", "/");

  if (!normalizedId.includes("/node_modules/")) {
    return undefined;
  }

  if (
    normalizedId.includes("/node_modules/react/") ||
    normalizedId.includes("/node_modules/react-dom/") ||
    normalizedId.includes("/node_modules/scheduler/")
  ) {
    return "react-vendor";
  }

  if (normalizedId.includes("/node_modules/@tensorflow/tfjs-backend-webgpu/")) {
    return "tfjs-webgpu-vendor";
  }

  if (normalizedId.includes("/node_modules/@tensorflow/tfjs-backend-cpu/")) {
    return "tfjs-cpu-vendor";
  }

  if (normalizedId.includes("/node_modules/@tensorflow/")) {
    return "tfjs-core-vendor";
  }

  if (
    normalizedId.includes("/node_modules/@codemirror/") ||
    normalizedId.includes("/node_modules/codemirror/")
  ) {
    return "editor-vendor";
  }

  if (
    normalizedId.includes("/node_modules/onnx-proto/") ||
    normalizedId.includes("/node_modules/fflate/") ||
    normalizedId.includes("/node_modules/long/") ||
    normalizedId.includes("/node_modules/@protobufjs/")
  ) {
    return "artifact-vendor";
  }

  if (
    normalizedId.includes("/node_modules/@base-ui/") ||
    normalizedId.includes("/node_modules/lucide-react/") ||
    normalizedId.includes("/node_modules/react-day-picker/")
  ) {
    return "ui-vendor";
  }

  if (
    normalizedId.includes("/node_modules/idb/") ||
    normalizedId.includes("/node_modules/clsx/") ||
    normalizedId.includes("/node_modules/class-variance-authority/") ||
    normalizedId.includes("/node_modules/tailwind-merge/")
  ) {
    return "app-utils-vendor";
  }

  return undefined;
}

export default defineConfig({
  base: basePath,
  build: {
    rollupOptions: {
      output: {
        manualChunks: resolveManualChunk,
      },
    },
  },
  optimizeDeps: {
    include: [
      "@codemirror/commands",
      "@codemirror/state",
      "@codemirror/view",
      "@noble/hashes/sha256",
      "@tensorflow/tfjs",
      "@tensorflow/tfjs-backend-cpu",
      "@tensorflow/tfjs-backend-webgpu",
    ],
  },
  worker: {
    format: "es",
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@protobufjs/inquire": path.resolve(__dirname, "./src/vendor/protobufjs-inquire-shim.cjs"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
