import { sanitizeDreamPhraseArtifactStem } from "@/lib/dreamphrase-artifact-shared";
import { buildDreamPhraseModelFile } from "@/lib/dreamphrase-bundle";
import {
  parseTorchArtifact,
  type TorchObject,
  type TorchTensorValue,
  type TorchValue,
} from "@/lib/torch-archive";
import { summarizeDatasetText } from "@/lib/trainer-core";
import type {
  BackendPreference,
  ModelConfig,
  OptimizerStateSnapshot,
  RunArtifactKind,
  RunArtifactSet,
  SerializedCheckpoint,
  SerializedTensor,
  SourceFilterSnapshot,
  TokenizerSnapshot,
  TrainingConfig,
} from "@/lib/trainer-types";

type ArtifactObject = TorchObject;

type ParameterSpec = {
  browserName: string;
  pyTorchName: string;
  transpose: boolean;
};

export function buildDreamPhraseArtifactSet(
  checkpoint: SerializedCheckpoint,
  runName: string,
): RunArtifactSet {
  const fileStem = sanitizeDreamPhraseArtifactStem(runName);

  return {
    model: {
      ...buildDreamPhraseModelFile(checkpoint, runName, `${fileStem}.browser-checkpoint`),
      kind: "model",
    },
  };
}

export function parseDreamPhraseArtifactSet({
  modelArtifact,
  resumeArtifact,
}: {
  modelArtifact: ArrayBuffer | Uint8Array;
  resumeArtifact: ArrayBuffer | Uint8Array;
}): SerializedCheckpoint {
  const modelPayload = expectObject(parseTorchArtifact(modelArtifact), "model artifact");
  const resumePayload = expectObject(parseTorchArtifact(resumeArtifact), "resume artifact");
  const modelConfig = parseModelConfig(
    readObjectField(modelPayload, "model_config", "model artifact"),
  );
  const tokenizer = parseTokenizer(
    readObjectField(modelPayload, "tokenizer", "model artifact"),
    modelConfig.blockSize,
  );
  const sourceFilter = parseSourceFilter(
    readOptionalObjectField(modelPayload, "source_filter") ??
      readOptionalObjectField(resumePayload, "source_filter"),
  );
  const datasetData = parseDatasetData(
    readTensorField(resumePayload, "dataset_data", "resume artifact"),
  );
  const trainingConfig = parseTrainingConfig(
    readObjectField(resumePayload, "training_config", "resume artifact"),
    modelConfig,
    modelPayload,
    resumePayload,
  );
  const parameterSpecs = buildParameterSpecs(modelConfig);
  const browserOrderedSpecs = buildBrowserOrderedSpecs(modelConfig).map((browserName) => {
    const spec = parameterSpecs.find((item) => item.browserName === browserName);
    if (!spec) {
      throw new Error(`Missing parameter mapping for "${browserName}".`);
    }
    return spec;
  });
  const stateDict = readObjectField(modelPayload, "state_dict", "model artifact");
  const weights = browserOrderedSpecs.map((spec) =>
    createBrowserTensorFromArtifact(
      spec.browserName,
      readTensorField(stateDict, spec.pyTorchName, "state_dict"),
      spec.transpose,
    ),
  );
  const optimizerState = parseOptimizerState(
    readObjectField(resumePayload, "optimizer_state", "resume artifact"),
    parameterSpecs,
    browserOrderedSpecs,
  );
  const exportedAt = readOptionalNumberField(resumePayload, "browser_exported_at") ?? Date.now();
  const fileName =
    readOptionalStringField(resumePayload, "browser_file_name") ??
    readOptionalStringField(modelPayload, "browser_file_name") ??
    "dreamphrasegpt.txt";
  const fileId =
    readOptionalStringField(resumePayload, "browser_file_id") ??
    readOptionalStringField(modelPayload, "browser_file_id") ??
    `artifact-${sanitizeDreamPhraseArtifactStem(fileName)}`;
  const requestedBackend = parseBackendPreference(
    readOptionalStringField(resumePayload, "browser_requested_backend"),
  );
  const resolvedBackend =
    readOptionalStringField(resumePayload, "browser_resolved_backend") === "webgpu"
      ? "webgpu"
      : "cpu";
  const resumeStatePayload = expectObject(
    readObjectField(resumePayload, "resume_state", "resume artifact"),
    "resume_state",
  );
  const resumeState = {
    completedSteps: readRequiredNumberField(resumeStatePayload, "completed_steps", "resume_state"),
    finalLoss: readRequiredNumberField(resumeStatePayload, "final_loss", "resume_state"),
    lastSavedAt:
      readOptionalNumberField(resumeStatePayload, "last_saved_at") ??
      readOptionalNumberField(resumePayload, "browser_last_saved_at") ??
      exportedAt,
    totalTokens: readRequiredNumberField(resumeStatePayload, "total_tokens", "resume_state"),
  };

  return {
    datasetData,
    datasetStats: buildDatasetStats(datasetData, tokenizer),
    exportedAt,
    fileId,
    fileName,
    modelConfig,
    optimizerState,
    requestedBackend,
    resolvedBackend,
    resumeState,
    rngState:
      readOptionalNumberField(resumePayload, "browser_rng_state") ??
      readOptionalNumberField(
        readOptionalObjectField(resumePayload, "rng_state"),
        "browser_rng_state",
      ) ??
      trainingConfig.seed,
    sourceFilter,
    tokenizer,
    trainingConfig,
    weights,
  };
}

export function getRunArtifactFile(artifactSet: RunArtifactSet, kind: RunArtifactKind) {
  switch (kind) {
    case "model":
      return artifactSet.model;
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unsupported artifact kind: ${String(exhaustive)}`);
    }
  }
}

function parseOptimizerState(
  optimizerStateValue: TorchValue,
  parameterSpecs: ParameterSpec[],
  browserOrderedSpecs: ParameterSpec[],
): OptimizerStateSnapshot {
  const optimizerState = expectObject(optimizerStateValue, "optimizer_state");
  const stateMap = readMapField(optimizerState, "state", "optimizer_state");
  const step = readOptimizerStep(stateMap);
  const momentsByBrowserName = new Map<
    string,
    {
      first: SerializedTensor;
      second: SerializedTensor;
    }
  >();

  parameterSpecs.forEach((spec, index) => {
    momentsByBrowserName.set(spec.browserName, {
      first: createBrowserTensorFromArtifact(
        spec.browserName,
        readTensorField(
          expectObject(stateMap.get(index), `optimizer_state.state[${index}]`),
          "exp_avg",
          "optimizer state",
        ),
        spec.transpose,
      ),
      second: createBrowserTensorFromArtifact(
        spec.browserName,
        readTensorField(
          expectObject(stateMap.get(index), `optimizer_state.state[${index}]`),
          "exp_avg_sq",
          "optimizer state",
        ),
        spec.transpose,
      ),
    });
  });

  return {
    firstMoments: browserOrderedSpecs.map((spec) => {
      const moments = momentsByBrowserName.get(spec.browserName);
      if (!moments) {
        throw new Error(`Optimizer moments are missing "${spec.browserName}".`);
      }
      return moments.first;
    }),
    secondMoments: browserOrderedSpecs.map((spec) => {
      const moments = momentsByBrowserName.get(spec.browserName);
      if (!moments) {
        throw new Error(`Optimizer moments are missing "${spec.browserName}".`);
      }
      return moments.second;
    }),
    step,
  };
}

function readOptimizerStep(stateMap: Map<number | string, unknown>) {
  const firstState = stateMap.get(0) ?? stateMap.get("0");
  if (!firstState) {
    return 0;
  }

  const stateObject = expectObject(firstState, "optimizer state");
  const stepValue = readRequiredField(stateObject, "step", "optimizer state");
  if (typeof stepValue === "number") {
    return stepValue;
  }
  if (isTorchTensorValue(stepValue)) {
    return Number(stepValue.values[0] ?? 0);
  }
  throw new Error("optimizer state.step must be a number or tensor.");
}

function parseModelConfig(value: TorchValue): ModelConfig {
  const object = expectObject(value, "model_config");

  return {
    blockSize: readRequiredNumberField(object, "block_size", "model_config"),
    mlpHiddenDim: readRequiredNumberField(object, "mlp_hidden_dim", "model_config"),
    mlpType: readRequiredStringField(object, "mlp_type", "model_config") as "swiglu",
    nEmbd: readRequiredNumberField(object, "n_embd", "model_config"),
    nHead: readRequiredNumberField(object, "n_head", "model_config"),
    nLayer: readRequiredNumberField(object, "n_layer", "model_config"),
    vocabSize: readRequiredNumberField(object, "vocab_size", "model_config"),
  };
}

function parseTokenizer(value: TorchValue, blockSize: number): TokenizerSnapshot {
  const object = expectObject(value, "tokenizer");
  const idToChar = readArrayField(object, "id_to_char", "tokenizer").map((item) => {
    if (typeof item !== "string") {
      throw new Error("Tokenizer id_to_char entries must be strings.");
    }
    return item;
  });

  return {
    blockSize,
    bosId: readRequiredNumberField(object, "bos_id", "tokenizer"),
    idToChar,
    vocabSize: readRequiredNumberField(object, "vocab_size", "tokenizer"),
  };
}

function parseSourceFilter(value: TorchValue | null | undefined): SourceFilterSnapshot {
  const object = expectObject(value ?? {}, "source_filter");
  const bitsValue = readRequiredField(object, "bits", "source_filter");

  return {
    bitCount: readRequiredNumberField(object, "bit_count", "source_filter"),
    bits:
      typeof bitsValue === "string"
        ? decodeBase64(bitsValue)
        : bitsValue instanceof Uint8Array
          ? bitsValue
          : (() => {
              throw new Error("Source filter bits must be a base64 string or Uint8Array.");
            })(),
    falsePositiveRate: readRequiredNumberField(object, "false_positive_rate", "source_filter"),
    hashCount: readRequiredNumberField(object, "hash_count", "source_filter"),
    itemCount: readRequiredNumberField(object, "item_count", "source_filter"),
    kind: readRequiredStringField(object, "kind", "source_filter"),
    version: readRequiredNumberField(object, "version", "source_filter"),
  };
}

function parseTrainingConfig(
  value: TorchValue,
  modelConfig: ModelConfig,
  modelPayload: ArtifactObject,
  resumePayload: ArtifactObject,
): TrainingConfig {
  const object = expectObject(value, "training_config");
  const browserAmpRequested = readNullableBooleanField(object, "browser_amp_requested");
  const browserCompileRequested = readNullableBooleanField(object, "browser_compile_requested");

  return {
    ampRequested:
      browserAmpRequested !== undefined
        ? browserAmpRequested
        : (readOptionalBooleanField(object, "amp_requested") ?? null),
    batchSize: readRequiredNumberField(object, "batch_size", "training_config"),
    beta1: readRequiredNumberField(object, "beta1", "training_config"),
    beta2: readRequiredNumberField(object, "beta2", "training_config"),
    compileRequested:
      browserCompileRequested !== undefined
        ? browserCompileRequested
        : (readOptionalBooleanField(object, "compile_requested") ?? null),
    eps: readRequiredNumberField(object, "eps", "training_config"),
    learningRate: readRequiredNumberField(object, "learning_rate", "training_config"),
    model: modelConfig,
    printEvery: Math.max(1, readOptionalNumberField(object, "print_every") ?? 50),
    requestedBackend: parseBackendPreference(
      readOptionalStringField(resumePayload, "browser_requested_backend"),
    ),
    requestedDeviceLabel:
      readOptionalStringField(object, "browser_requested_device_label") ??
      readOptionalStringField(object, "requested_device") ??
      readOptionalStringField(modelPayload, "browser_requested_device") ??
      "browser",
    requestedDtype:
      (readOptionalStringField(object, "requested_dtype") as TrainingConfig["requestedDtype"]) ??
      "auto",
    seed: readOptionalNumberField(object, "seed") ?? 42,
    steps: readRequiredNumberField(object, "steps", "training_config"),
    weightDecay: readRequiredNumberField(object, "weight_decay", "training_config"),
  };
}

function buildParameterSpecs(modelConfig: ModelConfig): ParameterSpec[] {
  const specs: ParameterSpec[] = [
    { browserName: "token_embedding", pyTorchName: "wte.weight", transpose: false },
    { browserName: "position_embedding", pyTorchName: "wpe.weight", transpose: false },
  ];

  for (let blockIndex = 0; blockIndex < modelConfig.nLayer; blockIndex += 1) {
    specs.push(
      {
        browserName: `blocks.${blockIndex}.norm1`,
        pyTorchName: `blocks.${blockIndex}.norm1.weight`,
        transpose: false,
      },
      {
        browserName: `blocks.${blockIndex}.attn_qkv`,
        pyTorchName: `blocks.${blockIndex}.attn.c_attn.weight`,
        transpose: true,
      },
      {
        browserName: `blocks.${blockIndex}.attn_proj`,
        pyTorchName: `blocks.${blockIndex}.attn.c_proj.weight`,
        transpose: true,
      },
      {
        browserName: `blocks.${blockIndex}.norm2`,
        pyTorchName: `blocks.${blockIndex}.norm2.weight`,
        transpose: false,
      },
      {
        browserName: `blocks.${blockIndex}.ff_gate`,
        pyTorchName: `blocks.${blockIndex}.feed_forward.gate_proj.weight`,
        transpose: true,
      },
      {
        browserName: `blocks.${blockIndex}.ff_up`,
        pyTorchName: `blocks.${blockIndex}.feed_forward.up_proj.weight`,
        transpose: true,
      },
      {
        browserName: `blocks.${blockIndex}.ff_down`,
        pyTorchName: `blocks.${blockIndex}.feed_forward.down_proj.weight`,
        transpose: true,
      },
    );
  }

  specs.push(
    { browserName: "norm_f", pyTorchName: "norm_f.weight", transpose: false },
    { browserName: "lm_head", pyTorchName: "lm_head.weight", transpose: true },
  );

  return specs;
}

function buildBrowserOrderedSpecs(modelConfig: ModelConfig) {
  const specs = ["token_embedding", "position_embedding"];

  for (let blockIndex = 0; blockIndex < modelConfig.nLayer; blockIndex += 1) {
    specs.push(
      `blocks.${blockIndex}.attn_proj`,
      `blocks.${blockIndex}.attn_qkv`,
      `blocks.${blockIndex}.ff_down`,
      `blocks.${blockIndex}.ff_gate`,
      `blocks.${blockIndex}.ff_up`,
      `blocks.${blockIndex}.norm1`,
      `blocks.${blockIndex}.norm2`,
    );
  }

  specs.push("norm_f", "lm_head");
  return specs;
}

function createBrowserTensorFromArtifact(
  browserName: string,
  tensorValue: TorchTensorValue,
  transpose: boolean,
): SerializedTensor {
  if (!(tensorValue.values instanceof Float32Array)) {
    throw new Error(`Tensor "${browserName}" must be float32.`);
  }

  return {
    name: browserName,
    shape: transpose ? transposeShape(tensorValue.shape) : [...tensorValue.shape],
    values: transpose
      ? transpose2d(tensorValue.values, tensorValue.shape[0] ?? 0, tensorValue.shape[1] ?? 0)
      : new Float32Array(tensorValue.values),
  };
}

function parseDatasetData(tensor: TorchTensorValue) {
  if (tensor.values instanceof Int32Array) {
    return new Int32Array(tensor.values);
  }
  if (tensor.values instanceof Uint8Array) {
    return Int32Array.from(tensor.values);
  }
  return Int32Array.from(tensor.values);
}

function buildDatasetStats(datasetData: Int32Array, tokenizer: TokenizerSnapshot) {
  const documents = decodeDatasetDocuments(datasetData, tokenizer);
  const summary = summarizeDatasetText(documents.join("\n"));

  return {
    characterCount: summary.characterCount,
    documentCount: documents.length,
    lineCount: summary.lineCount,
    tokenCount: datasetData.length,
    vocabSize: tokenizer.vocabSize,
  };
}

function decodeDatasetDocuments(datasetData: Int32Array, tokenizer: TokenizerSnapshot) {
  const documents: string[] = [];
  const characters: string[] = [];

  datasetData.forEach((token) => {
    if (token === tokenizer.bosId) {
      if (characters.length > 0) {
        documents.push(characters.join(""));
        characters.length = 0;
      }
      return;
    }

    const nextCharacter = tokenizer.idToChar[token];
    if (typeof nextCharacter === "string") {
      characters.push(nextCharacter);
    }
  });

  if (characters.length > 0) {
    documents.push(characters.join(""));
  }

  return documents;
}

function transpose2d(values: Float32Array, rows: number, cols: number) {
  const result = new Float32Array(values.length);

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < cols; column += 1) {
      result[column * rows + row] = values[row * cols + column] ?? 0;
    }
  }

  return result;
}

function transposeShape(shape: number[]) {
  if (shape.length !== 2) {
    return [...shape];
  }
  return [shape[1] ?? 0, shape[0] ?? 0];
}

function parseBackendPreference(value: string | null) {
  if (value === "cpu" || value === "webgpu" || value === "auto") {
    return value satisfies BackendPreference;
  }
  return "auto";
}

function expectObject(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value) || isTorchTensorValue(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as ArtifactObject;
}

function isTorchTensorValue(value: unknown): value is TorchTensorValue {
  return typeof value === "object" && value != null && "type" in value && value.type === "tensor";
}

function readOptionalObjectField(object: ArtifactObject | null | undefined, key: string) {
  if (!object) {
    return null;
  }
  const value = readField(object, key);
  if (value == null) {
    return null;
  }
  return expectObject(value, key);
}

function readObjectField(object: ArtifactObject, key: string, label: string) {
  return expectObject(readRequiredField(object, key, label), `${label}.${key}`);
}

function readMapField(object: ArtifactObject, key: string, label: string) {
  const value = readRequiredField(object, key, label);
  if (!(value instanceof Map)) {
    throw new Error(`${label}.${key} must be a map.`);
  }
  return value as Map<number | string, unknown>;
}

function readTensorField(object: ArtifactObject, key: string, label: string) {
  const value = readRequiredField(object, key, label);
  if (!isTorchTensorValue(value)) {
    throw new Error(`${label}.${key} must be a tensor.`);
  }
  return value;
}

function readArrayField(object: ArtifactObject, key: string, label: string) {
  const value = readRequiredField(object, key, label);
  if (!Array.isArray(value)) {
    throw new Error(`${label}.${key} must be an array.`);
  }
  return value;
}

function readRequiredField(object: ArtifactObject, key: string, label: string) {
  const value = readField(object, key);
  if (value === undefined) {
    throw new Error(`${label} is missing "${key}".`);
  }
  return value;
}

function readField(object: ArtifactObject, key: string) {
  if (object instanceof Map) {
    return object.get(key);
  }
  return object[key];
}

function readRequiredNumberField(object: ArtifactObject, key: string, label: string) {
  const value = readRequiredField(object, key, label);
  if (typeof value !== "number") {
    throw new Error(`${label}.${key} must be a number.`);
  }
  return value;
}

function readOptionalNumberField(object: ArtifactObject | null | undefined, key: string) {
  if (!object) {
    return null;
  }
  const value = readField(object, key);
  if (value == null) {
    return null;
  }
  if (typeof value !== "number") {
    throw new Error(`${key} must be a number when present.`);
  }
  return value;
}

function readRequiredStringField(object: ArtifactObject, key: string, label: string) {
  const value = readRequiredField(object, key, label);
  if (typeof value !== "string") {
    throw new Error(`${label}.${key} must be a string.`);
  }
  return value;
}

function readOptionalStringField(object: ArtifactObject | null | undefined, key: string) {
  if (!object) {
    return null;
  }
  const value = readField(object, key);
  if (value == null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string when present.`);
  }
  return value;
}

function readOptionalBooleanField(object: ArtifactObject | null | undefined, key: string) {
  if (!object) {
    return null;
  }
  const value = readField(object, key);
  if (value == null) {
    return null;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean when present.`);
  }
  return value;
}

function readNullableBooleanField(object: ArtifactObject | null | undefined, key: string) {
  if (!object || !hasField(object, key)) {
    return undefined;
  }
  const value = readField(object, key);
  if (value == null) {
    return null;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean or null when present.`);
  }
  return value;
}

function hasField(object: ArtifactObject, key: string) {
  return object instanceof Map ? object.has(key) : Object.hasOwn(object, key);
}

function decodeBase64(value: string) {
  if (typeof atob === "function") {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  const bufferConstructor = (globalThis as { Buffer?: typeof import("node:buffer").Buffer }).Buffer;
  if (bufferConstructor) {
    return new Uint8Array(bufferConstructor.from(value, "base64"));
  }

  throw new Error("Base64 decoding is unavailable in this runtime.");
}
