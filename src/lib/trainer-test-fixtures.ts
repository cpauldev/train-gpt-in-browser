import {
  createModelConfigFromDimensions,
  type SerializedCheckpoint,
  type TrainingConfig,
} from "@/lib/trainer-types";

export function createCheckpointFixture(): SerializedCheckpoint {
  const trainingConfig = createTestTrainingConfig();
  const modelConfig = trainingConfig.model;
  const vocabSize = modelConfig.vocabSize;
  const tensors = [
    createTensor("token_embedding", [vocabSize, modelConfig.nEmbd], 0.01),
    createTensor("position_embedding", [modelConfig.blockSize, modelConfig.nEmbd], 0.02),
    createTensor("blocks.0.attn_proj", [modelConfig.nEmbd, modelConfig.nEmbd], 0.03),
    createTensor("blocks.0.attn_qkv", [modelConfig.nEmbd, modelConfig.nEmbd * 3], 0.04),
    createTensor("blocks.0.ff_down", [modelConfig.mlpHiddenDim, modelConfig.nEmbd], 0.05),
    createTensor("blocks.0.ff_gate", [modelConfig.nEmbd, modelConfig.mlpHiddenDim], 0.06),
    createTensor("blocks.0.ff_up", [modelConfig.nEmbd, modelConfig.mlpHiddenDim], 0.07),
    createTensor("blocks.0.norm1", [modelConfig.nEmbd], 1),
    createTensor("blocks.0.norm2", [modelConfig.nEmbd], 1),
    createTensor("norm_f", [modelConfig.nEmbd], 1),
    createTensor("lm_head", [modelConfig.nEmbd, vocabSize], 0.08),
  ];

  return {
    datasetData: new Int32Array([4, 0, 1, 2, 4, 3, 4]),
    datasetStats: {
      characterCount: 12,
      documentCount: 2,
      lineCount: 2,
      tokenCount: 7,
      vocabSize,
    },
    exportedAt: 1,
    fileId: "file-1",
    fileName: "fixture.txt",
    modelConfig,
    optimizerState: {
      firstMoments: tensors.map((tensor) => createTensor(tensor.name, tensor.shape, 0)),
      secondMoments: tensors.map((tensor) => createTensor(tensor.name, tensor.shape, 0)),
      step: 1,
    },
    requestedBackend: "cpu",
    resolvedBackend: "cpu",
    resumeState: {
      completedSteps: 1,
      finalLoss: 1.23,
      lastSavedAt: 1,
      totalTokens: 28,
    },
    rngState: 123,
    sourceFilter: {
      bitCount: 8,
      bits: new Uint8Array([0b00010101]),
      falsePositiveRate: 1e-4,
      hashCount: 2,
      itemCount: 2,
      kind: "bloom",
      version: 1,
    },
    tokenizer: {
      blockSize: modelConfig.blockSize,
      bosId: 4,
      idToChar: ["a", "b", "c", "d"],
      vocabSize,
    },
    trainingConfig,
    weights: tensors,
  };
}

export function createTestTrainingConfig(): TrainingConfig {
  return {
    ampRequested: null,
    batchSize: 2,
    beta1: 0.9,
    beta2: 0.95,
    compileRequested: null,
    eps: 1e-8,
    learningRate: 3e-4,
    model: createModelConfigFromDimensions({
      blockSize: 6,
      nEmbd: 4,
      nHead: 2,
      nLayer: 1,
      vocabSize: 5,
    }),
    printEvery: 1,
    requestedBackend: "cpu",
    requestedDeviceLabel: "browser",
    requestedDtype: "auto",
    seed: 42,
    steps: 1,
    weightDecay: 0.01,
  };
}

function createTensor(name: string, shape: number[], startValue: number) {
  const size = shape.reduce((product, value) => product * value, 1);
  const values = new Float32Array(size);

  for (let index = 0; index < size; index += 1) {
    values[index] = startValue + index / 100;
  }

  return {
    name,
    shape,
    values,
  };
}
