import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const serviceWorkerSource = readFileSync(path.join(repoRoot, "public", "service-worker.js"), "utf8");

function extractPrecacheUrls() {
  const precacheSectionMatch = serviceWorkerSource.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/u);
  if (!precacheSectionMatch) {
    throw new Error("PRECACHE_URLS was not found in public/service-worker.js");
  }

  return Array.from(precacheSectionMatch[1].matchAll(/"([^"]+)"/gu), (match) => match[1]);
}

function resolvePrecacheUrlToFile(url: string) {
  const normalized = url.replace(/^\.\//u, "");

  if (normalized === "" || normalized === "index.html") {
    return path.join(repoRoot, "index.html");
  }

  return path.join(repoRoot, "public", normalized);
}

describe("service worker precache", () => {
  it("only references files that exist in the repository", () => {
    for (const url of extractPrecacheUrls()) {
      expect(existsSync(resolvePrecacheUrlToFile(url))).toBe(true);
    }
  });
});
