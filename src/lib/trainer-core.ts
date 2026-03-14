import { sha256 } from "@noble/hashes/sha256";

import {
  FALLBACK_HASH_STEP,
  SOURCE_FILTER_FALSE_POSITIVE_RATE,
  SOURCE_FILTER_KIND,
  SOURCE_FILTER_VERSION,
} from "@/lib/trainer-defaults";
import type {
  DatasetStats,
  DatasetTextSummary,
  LogEntry,
  LogKind,
  SourceFilterSnapshot,
  TokenizerSnapshot,
  WorkspaceFile,
} from "@/lib/trainer-types";

const encoder = new TextEncoder();
const SECTION_TITLE_OVERRIDES: Record<string, string> = {
  dreamphrasegpt: "DreamPhraseGPT",
};

export type PreparedDataset = {
  data: Int32Array;
  documents: string[];
  sourceFilter: SourceFilterSnapshot;
  stats: DatasetStats;
  tokenizer: TokenizerSnapshot;
};

export class DreamPhraseRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  nextUint32() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  }

  nextFloat() {
    return this.nextUint32() / 0x1_0000_0000;
  }

  nextInt(maxExclusive: number) {
    if (maxExclusive <= 0) {
      throw new Error("maxExclusive must be greater than 0.");
    }
    return Math.floor(this.nextFloat() * maxExclusive);
  }

  snapshot() {
    return this.state >>> 0;
  }
}

export function createId(prefix: string) {
  const randomPart = Math.random().toString(36).slice(2, 10);
  const timePart = Date.now().toString(36);
  return `${prefix}-${timePart}-${randomPart}`;
}

export function normalizeSourceText(text: string) {
  return text.trim();
}

export function parseDatasetDocuments(text: string) {
  return text
    .split(/\r?\n/u)
    .map((line) => normalizeSourceText(line))
    .filter(Boolean);
}

export function prepareDataset(content: string, blockSize: number, rng: DreamPhraseRng) {
  const documents = parseDatasetDocuments(content);

  if (documents.length === 0) {
    throw new Error("The dataset needs at least one non-empty line.");
  }

  const summary = summarizeDatasetText(content);
  const shuffled = [...documents];
  shuffleInPlace(shuffled, rng);
  const { data, tokenizer } = tokenizeDocuments(shuffled);

  const stats: DatasetStats = {
    characterCount: summary.characterCount,
    documentCount: shuffled.length,
    lineCount: summary.lineCount,
    tokenCount: data.length,
    vocabSize: tokenizer.vocabSize,
  };

  if (data.length < blockSize + 2) {
    throw new Error(
      `The dataset is too small for block size ${blockSize}. It needs at least ${blockSize + 2} tokens.`,
    );
  }

  return {
    data,
    documents: shuffled,
    sourceFilter: buildBloomSourceFilter(shuffled),
    stats,
    tokenizer: {
      ...tokenizer,
      blockSize,
    } satisfies TokenizerSnapshot,
  } satisfies PreparedDataset;
}

export function summarizeDatasetText(content: string): DatasetTextSummary {
  const seenCharacters = new Set<string>();
  let characterCount = 0;
  let documentCount = 0;

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = normalizeSourceText(rawLine);
    if (!line) {
      continue;
    }

    documentCount += 1;
    characterCount += line.length;
    for (const character of line) {
      seenCharacters.add(character);
    }
  }

  const tokenCount = 1 + characterCount + documentCount;

  return {
    characterCount,
    documentCount,
    lineCount: documentCount,
    tokenCount,
    vocabSize: seenCharacters.size + 1,
  };
}

export function tokenizeDocuments(documents: string[]) {
  const idToChar = [...new Set(documents.join(""))].sort();
  const charToId = new Map<string, number>(idToChar.map((value, index) => [value, index]));
  const bosId = idToChar.length;
  const data = new Int32Array(1 + documents.reduce((total, value) => total + value.length + 1, 0));

  let cursor = 0;
  data[cursor] = bosId;
  cursor += 1;

  for (const document of documents) {
    for (const character of document) {
      const tokenId = charToId.get(character);
      if (tokenId === undefined) {
        throw new Error(`Tokenizer is missing a character: ${character}`);
      }
      data[cursor] = tokenId;
      cursor += 1;
    }
    data[cursor] = bosId;
    cursor += 1;
  }

  return {
    data,
    tokenizer: {
      blockSize: 0,
      bosId,
      idToChar,
      vocabSize: bosId + 1,
    } satisfies TokenizerSnapshot,
  };
}

export function formatSectionTitle(title: string) {
  const normalized = title.trim();
  const override = SECTION_TITLE_OVERRIDES[normalized.toLowerCase()];
  if (override) {
    return override;
  }
  if (normalized && normalized === normalized.toLowerCase()) {
    return normalized.replace(/\b\w/gu, (match) => match.toUpperCase());
  }
  return normalized;
}

export function createLogEntry(message: string, kind: LogKind = "line"): LogEntry {
  return {
    createdAt: Date.now(),
    id: createId("log"),
    kind,
    message,
  };
}

export function createSectionLogEntry(title: string) {
  return createLogEntry(`--- ${formatSectionTitle(title)} ---`, "section");
}

export function shuffleInPlace<T>(items: T[], rng: DreamPhraseRng) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = rng.nextInt(index + 1);
    const next = items[index];
    items[index] = items[swapIndex] as T;
    items[swapIndex] = next as T;
  }
}

export function estimateBloomFilterBitCount(itemCount: number, falsePositiveRate: number) {
  const bits = (-itemCount * Math.log(falsePositiveRate)) / Math.log(2) ** 2;
  return Math.max(8, Math.ceil(bits));
}

export function estimateBloomFilterHashCount(bitCount: number, itemCount: number) {
  const hashes = (bitCount / itemCount) * Math.log(2);
  return Math.max(1, Math.round(hashes));
}

export function buildBloomSourceFilter(
  texts: string[],
  falsePositiveRate = SOURCE_FILTER_FALSE_POSITIVE_RATE,
) {
  const normalized = [
    ...new Set(texts.map((item) => normalizeSourceText(item)).filter(Boolean)),
  ].sort();

  if (normalized.length === 0) {
    throw new Error("Cannot build a source filter from an empty dataset.");
  }

  const bitCount = estimateBloomFilterBitCount(normalized.length, falsePositiveRate);
  const hashCount = estimateBloomFilterHashCount(bitCount, normalized.length);
  const bits = new Uint8Array(Math.ceil(bitCount / 8));

  for (const text of normalized) {
    for (const index of iterHashIndices(text, bitCount, hashCount)) {
      const byteIndex = Math.floor(index / 8);
      const bitOffset = index % 8;
      bits[byteIndex] = bits[byteIndex] | (1 << bitOffset);
    }
  }

  return {
    bitCount,
    bits,
    falsePositiveRate,
    hashCount,
    itemCount: normalized.length,
    kind: SOURCE_FILTER_KIND,
    version: SOURCE_FILTER_VERSION,
  } satisfies SourceFilterSnapshot;
}

export function sourceFilterMatches(sourceFilter: SourceFilterSnapshot | null, text: string) {
  const normalized = normalizeSourceText(text);
  if (!sourceFilter || !normalized) {
    return false;
  }

  for (const index of iterHashIndices(normalized, sourceFilter.bitCount, sourceFilter.hashCount)) {
    const byteIndex = Math.floor(index / 8);
    const bitOffset = index % 8;
    if ((sourceFilter.bits[byteIndex] & (1 << bitOffset)) === 0) {
      return false;
    }
  }

  return true;
}

export function iterHashIndices(text: string, bitCount: number, hashCount: number) {
  const digest = sha256(encoder.encode(text));
  const view = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
  const first = view.getBigUint64(0, true);
  const secondRaw = view.getBigUint64(8, true);
  const second = secondRaw === 0n ? FALLBACK_HASH_STEP : secondRaw;
  const results: number[] = [];
  const maxBits = BigInt(bitCount);

  for (let offset = 0n; offset < BigInt(hashCount); offset += 1n) {
    results.push(Number((first + offset * second) % maxBits));
  }

  return results;
}

export function formatNumber(value: number) {
  return value.toLocaleString("en-US");
}

export function formatTemperatureKey(temperature: number) {
  return clampTemperature(temperature).toFixed(1);
}

export function clampTemperature(value: number) {
  if (!Number.isFinite(value)) {
    return 0.8;
  }
  return Number(Math.min(1.4, Math.max(0.4, value)).toFixed(1));
}

export function getRunName(file: Pick<WorkspaceFile, "name">) {
  const stem = file.name.replace(/\.txt$/iu, "");
  return stem || "dreamphrasegpt";
}
