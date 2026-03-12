import onnxProto from "onnx-proto";

import {
  isoTimestampSeconds,
  sanitizeDreamPhraseArtifactStem,
} from "@/lib/dreamphrase-artifact-shared";
import { PRODUCT_NAME } from "@/lib/trainer-defaults";
import type {
  ModelDownloadFile,
  SerializedCheckpoint,
  SourceFilterSnapshot,
  TokenizerSnapshot,
} from "@/lib/trainer-types";

const { onnx } = onnxProto;

const BUNDLE_MAGIC = "PDBGONNX";
const BUNDLE_FORMAT = "dreamphrasegpt-onnx-bundle";
const BUNDLE_VERSION = 1;
const BUNDLE_OPSET_VERSION = 11;
const HEADER_LENGTH_BYTES = 4;
const RMS_NORM_EPSILON = 1e-5;
const LARGE_NEGATIVE = -1e9;

const encoder = new TextEncoder();
const bundleMagicBytes = encoder.encode(BUNDLE_MAGIC);

const sharedTensorNames = {
  attnScale: "const_f32_attn_scale",
  batchDim: "batch_dim",
  batchDimVec: "batch_dim_vec",
  dimHeadDim: "dim_head_dim",
  dimNEmbd: "dim_n_embd",
  dimNHead: "dim_n_head",
  eps: "const_f32_eps",
  futureMask: "future_mask",
  futureMaskB1: "future_mask_b1",
  futureMaskBool: "future_mask_bool",
  futureMaskFloat: "future_mask_float",
  futureMaskScaled: "future_mask_scaled",
  idxShape: "idx_shape",
  negativeInfinity: "const_f32_neg_inf",
  one: "const_i64_one",
  positionEmbeddings: "position_embeddings",
  positionEmbeddingsBatched: "position_embeddings_batched",
  positionCols: "position_cols",
  positionRows: "position_rows",
  positions: "positions",
  seqLen: "seq_len",
  seqLenVec: "seq_len_vec",
  shapeBse: "shape_bse",
  shapeBshd: "shape_bshd",
  tokenEmbeddings: "token_embeddings",
  zero: "const_i64_zero",
} as const;

const blockWeightKeys = {
  attnProj: "attn_proj",
  attnQkv: "attn_qkv",
  ffDown: "ff_down",
  ffGate: "ff_gate",
  ffUp: "ff_up",
  norm1: "norm1",
  norm2: "norm2",
} as const;

type TensorDataType = (typeof onnx.TensorProto.DataType)[keyof typeof onnx.TensorProto.DataType];
type OnnxNode = ReturnType<typeof onnx.NodeProto.create>;
type OnnxTensor = ReturnType<typeof onnx.TensorProto.create>;
type OnnxValueInfo = ReturnType<typeof onnx.ValueInfoProto.create>;

type GraphBuilder = {
  checkpoint: SerializedCheckpoint;
  headDim: number;
  initializers: OnnxTensor[];
  modelConfig: SerializedCheckpoint["modelConfig"];
  nodes: OnnxNode[];
};

export function buildDreamPhraseModelFile(
  checkpoint: SerializedCheckpoint,
  runName: string,
  sourceArtifact = `${sanitizeDreamPhraseArtifactStem(runName)}.browser-checkpoint`,
): ModelDownloadFile {
  const fileStem = sanitizeDreamPhraseArtifactStem(runName);
  const onnxBytes = buildDreamPhraseOnnxBytes(checkpoint);
  const headerBytes = encoder.encode(
    JSON.stringify(createBundleHeader(checkpoint, sourceArtifact)),
  );
  const bundleBytes = new Uint8Array(
    bundleMagicBytes.length + HEADER_LENGTH_BYTES + headerBytes.length + onnxBytes.length,
  );
  const view = new DataView(bundleBytes.buffer);
  const headerOffset = bundleMagicBytes.length + HEADER_LENGTH_BYTES;

  bundleBytes.set(bundleMagicBytes, 0);
  view.setUint32(bundleMagicBytes.length, headerBytes.length, true);
  bundleBytes.set(headerBytes, headerOffset);
  bundleBytes.set(onnxBytes, headerOffset + headerBytes.length);

  return {
    fileName: `${fileStem}.model`,
    mimeType: "application/octet-stream",
    value: toArrayBuffer(bundleBytes),
  };
}

function createBundleHeader(checkpoint: SerializedCheckpoint, sourceArtifact: string) {
  return {
    exported_at: isoTimestampSeconds(),
    format: BUNDLE_FORMAT,
    source_artifact: sourceArtifact,
    source_filter: serializeSourceFilter(checkpoint.sourceFilter),
    tokenizer: serializeTokenizer(checkpoint.tokenizer),
    version: BUNDLE_VERSION,
  };
}

function buildDreamPhraseOnnxBytes(checkpoint: SerializedCheckpoint) {
  const builder = createGraphBuilder(checkpoint);

  addSharedShapeNodes(builder);

  let hiddenInput = addEmbeddingStem(builder);
  for (let blockIndex = 0; blockIndex < builder.modelConfig.nLayer; blockIndex += 1) {
    hiddenInput = addTransformerBlock(builder, blockIndex, hiddenInput);
  }

  addFinalProjection(builder, hiddenInput);
  return encodeOnnxModel(builder);
}

function createGraphBuilder(checkpoint: SerializedCheckpoint): GraphBuilder {
  const { modelConfig } = checkpoint;
  const headDim = validateHeadDim(modelConfig.nEmbd, modelConfig.nHead);

  return {
    checkpoint,
    headDim,
    initializers: [
      ...createWeightInitializers(checkpoint),
      ...createConstantInitializers(modelConfig, headDim),
    ],
    modelConfig,
    nodes: [],
  };
}

function validateHeadDim(nEmbd: number, nHead: number) {
  const headDim = nEmbd / nHead;

  if (!Number.isInteger(headDim) || headDim <= 0) {
    throw new Error("Model configuration is invalid: n_embd must be divisible by n_head.");
  }

  return headDim;
}

function createWeightInitializers(checkpoint: SerializedCheckpoint) {
  return checkpoint.weights.map((weight) => {
    if (!(weight.values instanceof Float32Array)) {
      throw new Error(`Unsupported tensor type for ${weight.name}.`);
    }

    return floatTensor(weight.name, weight.shape, weight.values);
  });
}

function createConstantInitializers(
  modelConfig: SerializedCheckpoint["modelConfig"],
  headDim: number,
) {
  return [
    int64Tensor(sharedTensorNames.zero, [], [0]),
    int64Tensor(sharedTensorNames.one, [], [1]),
    floatTensor(sharedTensorNames.eps, [], Float32Array.of(RMS_NORM_EPSILON)),
    floatTensor(sharedTensorNames.negativeInfinity, [], Float32Array.of(LARGE_NEGATIVE)),
    floatTensor(sharedTensorNames.attnScale, [], Float32Array.of(1 / Math.sqrt(headDim))),
    int64Tensor(sharedTensorNames.dimNHead, [1], [modelConfig.nHead]),
    int64Tensor(sharedTensorNames.dimHeadDim, [1], [headDim]),
    int64Tensor(sharedTensorNames.dimNEmbd, [1], [modelConfig.nEmbd]),
  ];
}

function addSharedShapeNodes(builder: GraphBuilder) {
  addNode(builder, "Shape", ["idx"], [sharedTensorNames.idxShape]);
  addNode(
    builder,
    "Gather",
    [sharedTensorNames.idxShape, sharedTensorNames.zero],
    [sharedTensorNames.batchDim],
    {
      axis: 0,
    },
  );
  addNode(
    builder,
    "Gather",
    [sharedTensorNames.idxShape, sharedTensorNames.one],
    [sharedTensorNames.seqLen],
    {
      axis: 0,
    },
  );
  addNode(builder, "Unsqueeze", [sharedTensorNames.batchDim], [sharedTensorNames.batchDimVec], {
    axes: [0],
  });
  addNode(builder, "Unsqueeze", [sharedTensorNames.seqLen], [sharedTensorNames.seqLenVec], {
    axes: [0],
  });
  addNode(
    builder,
    "Concat",
    [
      sharedTensorNames.batchDimVec,
      sharedTensorNames.seqLenVec,
      sharedTensorNames.dimNHead,
      sharedTensorNames.dimHeadDim,
    ],
    [sharedTensorNames.shapeBshd],
    { axis: 0 },
  );
  addNode(
    builder,
    "Concat",
    [sharedTensorNames.batchDimVec, sharedTensorNames.seqLenVec, sharedTensorNames.dimNEmbd],
    [sharedTensorNames.shapeBse],
    { axis: 0 },
  );
}

function addEmbeddingStem(builder: GraphBuilder) {
  addNode(
    builder,
    "Range",
    [sharedTensorNames.zero, sharedTensorNames.seqLen, sharedTensorNames.one],
    [sharedTensorNames.positions],
  );
  addNode(builder, "Gather", ["token_embedding", "idx"], [sharedTensorNames.tokenEmbeddings], {
    axis: 0,
  });
  addNode(
    builder,
    "Gather",
    ["position_embedding", sharedTensorNames.positions],
    [sharedTensorNames.positionEmbeddings],
    { axis: 0 },
  );
  addNode(
    builder,
    "Unsqueeze",
    [sharedTensorNames.positionEmbeddings],
    [sharedTensorNames.positionEmbeddingsBatched],
    { axes: [0] },
  );
  addNode(
    builder,
    "Add",
    [sharedTensorNames.tokenEmbeddings, sharedTensorNames.positionEmbeddingsBatched],
    ["hidden_0"],
  );
  addCausalMask(builder);
  return "hidden_0";
}

function addCausalMask(builder: GraphBuilder) {
  addNode(builder, "Unsqueeze", [sharedTensorNames.positions], [sharedTensorNames.positionCols], {
    axes: [0],
  });
  addNode(builder, "Unsqueeze", [sharedTensorNames.positions], [sharedTensorNames.positionRows], {
    axes: [1],
  });
  addNode(
    builder,
    "Greater",
    [sharedTensorNames.positionCols, sharedTensorNames.positionRows],
    [sharedTensorNames.futureMaskBool],
  );
  addNode(
    builder,
    "Cast",
    [sharedTensorNames.futureMaskBool],
    [sharedTensorNames.futureMaskFloat],
    {
      to: onnx.TensorProto.DataType.FLOAT,
    },
  );
  addNode(
    builder,
    "Mul",
    [sharedTensorNames.futureMaskFloat, sharedTensorNames.negativeInfinity],
    [sharedTensorNames.futureMaskScaled],
  );
  addNode(
    builder,
    "Unsqueeze",
    [sharedTensorNames.futureMaskScaled],
    [sharedTensorNames.futureMaskB1],
    { axes: [0] },
  );
  addNode(builder, "Unsqueeze", [sharedTensorNames.futureMaskB1], [sharedTensorNames.futureMask], {
    axes: [0],
  });
}

function addTransformerBlock(builder: GraphBuilder, blockIndex: number, hiddenInput: string) {
  const blockPrefix = `blocks_${blockIndex}`;
  const attentionResidual = addAttention(builder, blockIndex, hiddenInput, blockPrefix);
  return addFeedForward(builder, blockIndex, attentionResidual, blockPrefix);
}

function addAttention(
  builder: GraphBuilder,
  blockIndex: number,
  hiddenInput: string,
  blockPrefix: string,
) {
  const normalized = addRmsNorm(
    builder,
    hiddenInput,
    getBlockWeightName(blockIndex, blockWeightKeys.norm1),
    `${blockPrefix}_norm1`,
  );
  const qkv = `${blockPrefix}_qkv`;
  const q = `${blockPrefix}_q`;
  const k = `${blockPrefix}_k`;
  const v = `${blockPrefix}_v`;
  const scores = `${blockPrefix}_scores`;
  const scoresScaled = `${blockPrefix}_scores_scaled`;
  const maskedScores = `${blockPrefix}_masked_scores`;
  const attentionWeights = `${blockPrefix}_attn_weights`;
  const attended = `${blockPrefix}_attended`;
  const attendedBse = `${blockPrefix}_attended_bse`;
  const attentionOutput = `${blockPrefix}_attn_out`;
  const attentionResidual = `${blockPrefix}_attn_residual`;

  addNode(
    builder,
    "MatMul",
    [normalized, getBlockWeightName(blockIndex, blockWeightKeys.attnQkv)],
    [qkv],
  );
  addNode(builder, "Split", [qkv], [q, k, v], {
    axis: 2,
    split: [builder.modelConfig.nEmbd, builder.modelConfig.nEmbd, builder.modelConfig.nEmbd],
  });

  const qHeads = addAttentionHeads(builder, blockPrefix, q, "q");
  const kHeads = addAttentionHeads(builder, blockPrefix, k, "k");
  const vHeads = addAttentionHeads(builder, blockPrefix, v, "v");

  addNode(builder, "Transpose", [kHeads], [`${blockPrefix}_k_t`], {
    perm: [0, 1, 3, 2],
  });
  addNode(builder, "MatMul", [qHeads, `${blockPrefix}_k_t`], [scores]);
  addNode(builder, "Mul", [scores, sharedTensorNames.attnScale], [scoresScaled]);
  addNode(builder, "Add", [scoresScaled, sharedTensorNames.futureMask], [maskedScores]);
  addNode(builder, "Softmax", [maskedScores], [attentionWeights], { axis: 3 });
  addNode(builder, "MatMul", [attentionWeights, vHeads], [attended]);
  addNode(builder, "Transpose", [attended], [`${blockPrefix}_attended_t`], {
    perm: [0, 2, 1, 3],
  });
  addNode(
    builder,
    "Reshape",
    [`${blockPrefix}_attended_t`, sharedTensorNames.shapeBse],
    [attendedBse],
  );
  addNode(
    builder,
    "MatMul",
    [attendedBse, getBlockWeightName(blockIndex, blockWeightKeys.attnProj)],
    [attentionOutput],
  );
  addNode(builder, "Add", [hiddenInput, attentionOutput], [attentionResidual]);

  return attentionResidual;
}

function addAttentionHeads(
  builder: GraphBuilder,
  blockPrefix: string,
  inputName: string,
  label: "k" | "q" | "v",
) {
  const reshaped = `${blockPrefix}_${label}_bshd`;
  const transposed = `${blockPrefix}_${label}_heads`;

  addNode(builder, "Reshape", [inputName, sharedTensorNames.shapeBshd], [reshaped]);
  addNode(builder, "Transpose", [reshaped], [transposed], { perm: [0, 2, 1, 3] });

  return transposed;
}

function addFeedForward(
  builder: GraphBuilder,
  blockIndex: number,
  hiddenInput: string,
  blockPrefix: string,
) {
  const normalized = addRmsNorm(
    builder,
    hiddenInput,
    getBlockWeightName(blockIndex, blockWeightKeys.norm2),
    `${blockPrefix}_norm2`,
  );
  const gate = `${blockPrefix}_gate`;
  const up = `${blockPrefix}_up`;
  const gateSigmoid = `${blockPrefix}_gate_sigmoid`;
  const gateSilu = `${blockPrefix}_gate_silu`;
  const gated = `${blockPrefix}_gated`;
  const feedForwardOutput = `${blockPrefix}_ff_out`;
  const hiddenOutput = `${blockPrefix}_hidden`;

  addNode(
    builder,
    "MatMul",
    [normalized, getBlockWeightName(blockIndex, blockWeightKeys.ffGate)],
    [gate],
  );
  addNode(
    builder,
    "MatMul",
    [normalized, getBlockWeightName(blockIndex, blockWeightKeys.ffUp)],
    [up],
  );
  addNode(builder, "Sigmoid", [gate], [gateSigmoid]);
  addNode(builder, "Mul", [gateSigmoid, gate], [gateSilu]);
  addNode(builder, "Mul", [gateSilu, up], [gated]);
  addNode(
    builder,
    "MatMul",
    [gated, getBlockWeightName(blockIndex, blockWeightKeys.ffDown)],
    [feedForwardOutput],
  );
  addNode(builder, "Add", [hiddenInput, feedForwardOutput], [hiddenOutput]);

  return hiddenOutput;
}

function addFinalProjection(builder: GraphBuilder, hiddenInput: string) {
  const normalized = addRmsNorm(builder, hiddenInput, "norm_f", "norm_f");
  addNode(builder, "MatMul", [normalized, "lm_head"], ["logits"]);
}

function addRmsNorm(builder: GraphBuilder, inputName: string, weightName: string, prefix: string) {
  const square = `${prefix}_square`;
  const meanSquare = `${prefix}_mean_square`;
  const variance = `${prefix}_variance`;
  const standardDeviation = `${prefix}_stddev`;
  const reciprocalSqrt = `${prefix}_rsqrt`;
  const scaled = `${prefix}_scaled`;
  const output = `${prefix}_out`;

  addNode(builder, "Mul", [inputName, inputName], [square]);
  addNode(builder, "ReduceMean", [square], [meanSquare], { axes: [2], keepdims: 1 });
  addNode(builder, "Add", [meanSquare, sharedTensorNames.eps], [variance]);
  addNode(builder, "Sqrt", [variance], [standardDeviation]);
  addNode(builder, "Reciprocal", [standardDeviation], [reciprocalSqrt]);
  addNode(builder, "Mul", [inputName, reciprocalSqrt], [scaled]);
  addNode(builder, "Mul", [scaled, weightName], [output]);

  return output;
}

function encodeOnnxModel(builder: GraphBuilder) {
  const model = onnx.ModelProto.create({
    graph: onnx.GraphProto.create({
      initializer: builder.initializers,
      input: [
        tensorValueInfo("idx", onnx.TensorProto.DataType.INT64, [1, sharedTensorNames.seqLen]),
      ],
      name: "dreamphrasegpt",
      node: builder.nodes,
      output: [
        tensorValueInfo("logits", onnx.TensorProto.DataType.FLOAT, [
          1,
          sharedTensorNames.seqLen,
          builder.modelConfig.vocabSize,
        ]),
      ],
      valueInfo: [
        tensorValueInfo(sharedTensorNames.tokenEmbeddings, onnx.TensorProto.DataType.FLOAT, [
          1,
          sharedTensorNames.seqLen,
          builder.modelConfig.nEmbd,
        ]),
        tensorValueInfo(
          sharedTensorNames.positionEmbeddingsBatched,
          onnx.TensorProto.DataType.FLOAT,
          [1, sharedTensorNames.seqLen, builder.modelConfig.nEmbd],
        ),
      ],
    }),
    irVersion: onnx.Version.IR_VERSION,
    modelVersion: 1,
    opsetImport: [onnx.OperatorSetIdProto.create({ version: BUNDLE_OPSET_VERSION })],
    producerName: PRODUCT_NAME,
  });
  const verificationError = onnx.ModelProto.verify(model);

  if (verificationError) {
    throw new Error(`Generated ONNX model is invalid: ${verificationError}`);
  }

  return onnx.ModelProto.encode(model).finish();
}

function serializeTokenizer(tokenizer: TokenizerSnapshot) {
  return {
    block_size: tokenizer.blockSize,
    bos_id: tokenizer.bosId,
    id_to_char: [...tokenizer.idToChar],
    vocab_size: tokenizer.vocabSize,
  };
}

function serializeSourceFilter(sourceFilter: SourceFilterSnapshot) {
  return {
    bit_count: sourceFilter.bitCount,
    bits_base64: encodeBase64(sourceFilter.bits),
    false_positive_rate: sourceFilter.falsePositiveRate,
    hash_count: sourceFilter.hashCount,
    item_count: sourceFilter.itemCount,
    kind: sourceFilter.kind,
    version: sourceFilter.version,
  };
}

function addNode(
  builder: GraphBuilder,
  opType: string,
  input: string[],
  output: string[],
  attributes?: Record<string, number | number[] | OnnxTensor>,
) {
  builder.nodes.push(createNode(opType, input, output, attributes));
}

function createNode(
  opType: string,
  input: string[],
  output: string[],
  attributes?: Record<string, number | number[] | OnnxTensor>,
) {
  return onnx.NodeProto.create({
    attribute: attributes ? buildAttributes(attributes) : [],
    input,
    opType,
    output,
  });
}

function buildAttributes(attributes: Record<string, number | number[] | OnnxTensor>) {
  return Object.entries(attributes).map(([name, value]) => {
    if (Array.isArray(value)) {
      return onnx.AttributeProto.create({
        ints: value,
        name,
        type: onnx.AttributeProto.AttributeType.INTS,
      });
    }
    if (typeof value === "number") {
      return onnx.AttributeProto.create({
        i: value,
        name,
        type: onnx.AttributeProto.AttributeType.INT,
      });
    }

    return onnx.AttributeProto.create({
      name,
      t: value,
      type: onnx.AttributeProto.AttributeType.TENSOR,
    });
  });
}

function floatTensor(name: string, dims: number[], values: Float32Array) {
  return onnx.TensorProto.create({
    dataType: onnx.TensorProto.DataType.FLOAT,
    dims,
    name,
    rawData: typedArrayBytes(values),
  });
}

function int64Tensor(name: string, dims: number[], values: number[]) {
  return onnx.TensorProto.create({
    dataType: onnx.TensorProto.DataType.INT64,
    dims,
    int64Data: values,
    name,
  });
}

function tensorValueInfo(
  name: string,
  dataType: TensorDataType,
  dims: Array<number | string>,
): OnnxValueInfo {
  return onnx.ValueInfoProto.create({
    name,
    type: onnx.TypeProto.create({
      tensorType: onnx.TypeProto.Tensor.create({
        elemType: dataType,
        shape: onnx.TensorShapeProto.create({
          dim: dims.map((dim) =>
            typeof dim === "string"
              ? onnx.TensorShapeProto.Dimension.create({ dimParam: dim })
              : onnx.TensorShapeProto.Dimension.create({ dimValue: dim }),
          ),
        }),
      }),
    }),
  });
}

function typedArrayBytes(values: Float32Array) {
  return new Uint8Array(
    values.buffer.slice(values.byteOffset, values.byteOffset + values.byteLength),
  );
}

function encodeBase64(bytes: Uint8Array) {
  if (typeof btoa === "function") {
    let binary = "";
    const chunkSize = 0x8000;

    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
  }

  const bufferConstructor = (globalThis as { Buffer?: typeof import("node:buffer").Buffer }).Buffer;
  if (bufferConstructor) {
    return bufferConstructor.from(bytes).toString("base64");
  }

  throw new Error("Base64 encoding is unavailable in this runtime.");
}

function getBlockWeightName(
  blockIndex: number,
  key: (typeof blockWeightKeys)[keyof typeof blockWeightKeys],
) {
  return `blocks.${blockIndex}.${key}`;
}

function toArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
