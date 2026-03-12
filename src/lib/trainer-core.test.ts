import { describe, expect, it } from "vitest";

import {
  buildBloomSourceFilter,
  DreamPhraseRng,
  parseDatasetDocuments,
  prepareDataset,
  sourceFilterMatches,
  summarizeDatasetText,
  tokenizeDocuments,
} from "@/lib/trainer-core";

describe("trainer-core", () => {
  it("parses newline-delimited datasets and drops blank rows", () => {
    expect(parseDatasetDocuments(" alpha \n\nbeta\r\ngamma  \n")).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("summarizes total characters separately from tokenizer size", () => {
    expect(summarizeDatasetText("ab\ncc\n")).toEqual({
      characterCount: 4,
      documents: ["ab", "cc"],
      lineCount: 2,
      tokenCount: 7,
      vocabSize: 4,
    });
  });

  it("builds a BOS-delimited token stream", () => {
    const { data, tokenizer } = tokenizeDocuments(["ab", "ba"]);

    expect(tokenizer.idToChar).toEqual(["a", "b"]);
    expect(tokenizer.bosId).toBe(2);
    expect(Array.from(data)).toEqual([2, 0, 1, 2, 1, 0, 2]);
  });

  it("builds a bloom source filter that matches normalized source lines", () => {
    const sourceFilter = buildBloomSourceFilter([" Alpha ", "Beta", "Beta"]);

    expect(sourceFilterMatches(sourceFilter, "Alpha")).toBe(true);
    expect(sourceFilterMatches(sourceFilter, "  Beta  ")).toBe(true);
    expect(sourceFilterMatches(sourceFilter, "Gamma")).toBe(false);
  });

  it("prepares a deterministic dataset with tokenizer metadata", () => {
    const dataset = prepareDataset("alpha\nbeta\ngamma\n", 4, new DreamPhraseRng(42));

    expect(dataset.stats.documentCount).toBe(3);
    expect(dataset.stats.tokenCount).toBe(dataset.data.length);
    expect(dataset.tokenizer.blockSize).toBe(4);
    expect(dataset.tokenizer.vocabSize).toBeGreaterThan(1);
  });
});
