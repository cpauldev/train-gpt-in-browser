import onnxProto from "onnx-proto";
import { describe, expect, it } from "vitest";

import { buildDreamPhraseModelFile } from "@/lib/dreamphrase-bundle";
import { createCheckpointFixture } from "@/lib/trainer-test-fixtures";

const { onnx } = onnxProto;

describe("dreamphrase-bundle", () => {
  it("exports a DreamPhrase-compatible .model bundle with ONNX bytes", () => {
    const checkpoint = createCheckpointFixture();
    const exported = buildDreamPhraseModelFile(checkpoint, "Fixture Run");
    const bundleBytes = new Uint8Array(exported.value);
    const magic = new TextDecoder().decode(bundleBytes.subarray(0, 8));
    const headerLength = new DataView(exported.value).getUint32(8, true);
    const headerStart = 12;
    const headerEnd = headerStart + headerLength;
    const header = JSON.parse(
      new TextDecoder().decode(bundleBytes.subarray(headerStart, headerEnd)),
    );
    const model = onnx.ModelProto.decode(bundleBytes.subarray(headerEnd));
    const graph = model.graph;

    expect(exported.fileName).toBe("fixture-run.model");
    expect(magic).toBe("PDBGONNX");
    expect(header).toMatchObject({
      format: "dreamphrasegpt-onnx-bundle",
      source_artifact: "fixture-run.browser-checkpoint",
      tokenizer: {
        block_size: checkpoint.tokenizer.blockSize,
        bos_id: checkpoint.tokenizer.bosId,
        id_to_char: checkpoint.tokenizer.idToChar,
        vocab_size: checkpoint.tokenizer.vocabSize,
      },
      version: 1,
    });
    expect(header.source_filter).toMatchObject({
      bit_count: checkpoint.sourceFilter.bitCount,
      false_positive_rate: checkpoint.sourceFilter.falsePositiveRate,
      hash_count: checkpoint.sourceFilter.hashCount,
      item_count: checkpoint.sourceFilter.itemCount,
      kind: checkpoint.sourceFilter.kind,
      version: checkpoint.sourceFilter.version,
    });
    expect(typeof header.source_filter.bits_base64).toBe("string");
    expect(onnx.ModelProto.verify(model)).toBeNull();
    expect(graph).toBeDefined();
    expect(graph?.input?.[0]?.name).toBe("idx");
    expect(graph?.output?.[0]?.name).toBe("logits");
    expect(graph?.initializer?.some((item) => item.name === "token_embedding")).toBe(true);
    expect(graph?.initializer?.some((item) => item.name === "lm_head")).toBe(true);
  });
});
