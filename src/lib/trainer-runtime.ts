import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-cpu";
import "@tensorflow/tfjs-backend-webgpu";

import {
  clampTemperature,
  createLogEntry,
  createSectionLogEntry,
  DreamPhraseRng,
  formatNumber,
  type PreparedDataset,
  prepareDataset,
  sourceFilterMatches,
} from "@/lib/trainer-core";
import { AUTOSAVE_STEP_INTERVAL, SOURCE_FILTER_MAX_RETRIES } from "@/lib/trainer-defaults";
import type {
  BackendPreference,
  GenerationConfig,
  LogEntry,
  ModelConfig,
  OptimizerStateSnapshot,
  ResolvedBackend,
  SerializedCheckpoint,
  SerializedTensor,
  TrainingConfig,
  TrainingTelemetryPoint,
  WorkspaceFile,
} from "@/lib/trainer-types";

const RMS_NORM_EPSILON = 1e-5;
const INIT_WEIGHT_STDDEV = 0.08;
const LARGE_NEGATIVE = -1e9;
type TrainableState = {
  firstMoment: tf.Variable;
  name: string;
  secondMoment: tf.Variable;
  variable: tf.Variable;
};

type BlockState = {
  attnProj: TrainableState;
  attnQkv: TrainableState;
  ffDown: TrainableState;
  ffGate: TrainableState;
  ffUp: TrainableState;
  norm1: TrainableState;
  norm2: TrainableState;
};

type ModelState = {
  blocks: BlockState[];
  lmHead: TrainableState;
  normF: TrainableState;
  ordered: TrainableState[];
  tokenEmbedding: TrainableState;
  positionEmbedding: TrainableState;
};

export type TrainingStepSummary = {
  checkpoint?: SerializedCheckpoint;
  completedSteps: number;
  generatedResults?: string[];
  logEntry: LogEntry;
  loss: number;
  stepsPerSecond: number;
  tokPerSecond: number;
  totalSteps: number;
  totalTokens: number;
};

export class BrowserTrainer {
  private causalMaskCache = new Map<number, tf.Tensor4D>();
  private dataset: PreparedDataset;
  private model: ModelState;
  private optimizerStep: number;
  private positionIndexCache = new Map<number, tf.Tensor1D>();
  private resolvedBackend: ResolvedBackend;
  private resumeState: SerializedCheckpoint["resumeState"];
  private runtimeRng: DreamPhraseRng;
  private trainingConfig: TrainingConfig;
  private sourceFile: Pick<WorkspaceFile, "content" | "id" | "name">;

  private constructor({
    dataset,
    model,
    optimizerStep,
    resolvedBackend,
    resumeState,
    rngState,
    sourceFile,
    trainingConfig,
  }: {
    dataset: PreparedDataset;
    model: ModelState;
    optimizerStep: number;
    resolvedBackend: ResolvedBackend;
    resumeState: SerializedCheckpoint["resumeState"];
    rngState: number;
    sourceFile: Pick<WorkspaceFile, "content" | "id" | "name">;
    trainingConfig: TrainingConfig;
  }) {
    this.dataset = dataset;
    this.model = model;
    this.optimizerStep = optimizerStep;
    this.resolvedBackend = resolvedBackend;
    this.resumeState = resumeState;
    this.runtimeRng = new DreamPhraseRng(rngState);
    this.sourceFile = sourceFile;
    this.trainingConfig = trainingConfig;
  }

  static async createNew(
    file: Pick<WorkspaceFile, "content" | "id" | "name">,
    trainingConfig: TrainingConfig,
  ) {
    const resolvedBackend = await resolveBackendPreference(trainingConfig.requestedBackend);
    const datasetRng = new DreamPhraseRng(trainingConfig.seed);
    const dataset = prepareDataset(file.content, trainingConfig.model.blockSize, datasetRng);
    const modelConfig = { ...trainingConfig.model, vocabSize: dataset.tokenizer.vocabSize };
    const initRng = new DreamPhraseRng(trainingConfig.seed ^ 0xa5a5a5a5);
    const model = createModelState(modelConfig, initRng);

    return new BrowserTrainer({
      dataset,
      model,
      optimizerStep: 0,
      resolvedBackend,
      resumeState: {
        completedSteps: 0,
        finalLoss: Number.NaN,
        lastSavedAt: Date.now(),
        totalTokens: 0,
      },
      rngState: trainingConfig.seed ^ 0x51f15e,
      sourceFile: file,
      trainingConfig: { ...trainingConfig, model: modelConfig },
    });
  }

  static async fromCheckpoint(
    checkpoint: SerializedCheckpoint,
    nextTrainingConfig = checkpoint.trainingConfig,
  ) {
    const resolvedBackend = await resolveBackendPreference(nextTrainingConfig.requestedBackend);
    const tokenizer = checkpoint.tokenizer;
    const dataset: PreparedDataset = {
      data: new Int32Array(checkpoint.datasetData),
      documents: [],
      sourceFilter: checkpoint.sourceFilter,
      stats: checkpoint.datasetStats,
      tokenizer,
    };
    const model = createModelState(
      checkpoint.modelConfig,
      new DreamPhraseRng(checkpoint.trainingConfig.seed),
      checkpoint.weights,
      checkpoint.optimizerState,
    );

    return new BrowserTrainer({
      dataset,
      model,
      optimizerStep: checkpoint.optimizerState.step,
      resolvedBackend,
      resumeState: checkpoint.resumeState,
      rngState: checkpoint.rngState,
      sourceFile: {
        content: "",
        id: checkpoint.fileId,
        name: checkpoint.fileName,
      },
      trainingConfig: {
        ...nextTrainingConfig,
        model: checkpoint.modelConfig,
      },
    });
  }

  getCheckpoint(
    completedSteps: number,
    totalTokens: number,
    finalLoss: number,
  ): Promise<SerializedCheckpoint> {
    this.resumeState = {
      completedSteps,
      finalLoss,
      lastSavedAt: Date.now(),
      totalTokens,
    };
    return serializeCheckpoint({
      dataset: this.dataset,
      file: this.sourceFile,
      model: this.model,
      optimizerStep: this.optimizerStep,
      requestedBackend: this.trainingConfig.requestedBackend,
      resolvedBackend: this.resolvedBackend,
      resumeState: this.resumeState,
      rngState: this.runtimeRng.snapshot(),
      trainingConfig: this.trainingConfig,
    });
  }

  async generateSamples(generationConfig: GenerationConfig) {
    const results: string[] = [];
    const samplingRng = new DreamPhraseRng(
      (this.runtimeRng.snapshot() ^ Date.now() ^ generationConfig.numSamples) >>> 0,
    );

    for (let sampleIndex = 0; sampleIndex < generationConfig.numSamples; sampleIndex += 1) {
      let accepted: string | null = null;

      for (let attempt = 0; attempt < SOURCE_FILTER_MAX_RETRIES; attempt += 1) {
        const candidate = await this.generateOneSample(generationConfig, samplingRng);
        if (!candidate.trim()) {
          continue;
        }
        if (!sourceFilterMatches(this.dataset.sourceFilter, candidate)) {
          accepted = candidate;
          break;
        }
      }

      if (!accepted) {
        throw new Error(
          `Failed to sample a non-source line within ${SOURCE_FILTER_MAX_RETRIES} attempts.`,
        );
      }

      results.push(accepted);
    }

    return results;
  }

  async train({
    generationConfig,
    onProgress,
    onStart,
    onTelemetry,
  }: {
    generationConfig: GenerationConfig;
    onProgress: (summary: TrainingStepSummary, isAutosave: boolean) => Promise<void> | void;
    onStart?: (logEntries: LogEntry[]) => Promise<void> | void;
    onTelemetry?: (point: TrainingTelemetryPoint) => Promise<void> | void;
  }) {
    const parameterCount = countParameters(this.model.ordered);
    const completedStepsBefore = this.resumeState.completedSteps;
    const totalTokensBefore = this.resumeState.totalTokens;
    const targetTotalSteps = completedStepsBefore + this.trainingConfig.steps;
    const startingLogEntries = buildTrainingStartLogs({
      dataset: this.dataset,
      fileName: this.sourceFile.name,
      modelConfig: this.trainingConfig.model,
      parameterCount,
      resolvedBackend: this.resolvedBackend,
      resumedFromStep: completedStepsBefore,
      trainingConfig: this.trainingConfig,
      targetTotalSteps,
    });

    if (onStart) {
      await onStart(startingLogEntries);
    }

    let completedSteps = completedStepsBefore;
    let totalTokens = totalTokensBefore;
    let finalLoss = this.resumeState.finalLoss;
    const startedAt = performance.now();
    let lastTelemetryAt = startedAt;
    let lastTelemetrySteps = completedStepsBefore;
    let lastTelemetryTokens = totalTokensBefore;

    for (let step = 0; step < this.trainingConfig.steps; step += 1) {
      const learningRate =
        this.trainingConfig.learningRate *
        (1 - (completedStepsBefore + step) / Math.max(1, targetTotalSteps));

      const batch = createTrainingBatch(
        this.dataset.data,
        this.trainingConfig.batchSize,
        this.trainingConfig.model.blockSize,
        this.runtimeRng,
      );

      const loss = await this.applyTrainingStep(batch.x, batch.y, learningRate);
      batch.x.dispose();
      batch.y.dispose();

      finalLoss = loss;
      completedSteps = completedStepsBefore + step + 1;
      totalTokens += this.trainingConfig.batchSize * this.trainingConfig.model.blockSize;
      const now = performance.now();

      if (onTelemetry && (now - lastTelemetryAt >= 250 || step + 1 === this.trainingConfig.steps)) {
        const elapsedSeconds = Math.max((now - lastTelemetryAt) / 1000, 1e-9);
        const telemetryPoint: TrainingTelemetryPoint = {
          loss: finalLoss,
          step: completedSteps,
          stepsPerSecond: (completedSteps - lastTelemetrySteps) / elapsedSeconds,
          time: Date.now() / 1000,
          tokPerSecond: (totalTokens - lastTelemetryTokens) / elapsedSeconds,
          totalSteps: targetTotalSteps,
          totalTokens,
        };
        await onTelemetry(telemetryPoint);
        lastTelemetryAt = now;
        lastTelemetrySteps = completedSteps;
        lastTelemetryTokens = totalTokens;
      }

      const shouldReport =
        (step + 1) % this.trainingConfig.printEvery === 0 || step + 1 === this.trainingConfig.steps;
      const shouldAutosave =
        completedSteps % Math.max(this.trainingConfig.printEvery, AUTOSAVE_STEP_INTERVAL) === 0 ||
        completedSteps === targetTotalSteps;

      if (shouldReport) {
        const elapsedSeconds = Math.max((now - startedAt) / 1000, 1e-9);
        const tokPerSecond = (totalTokens - totalTokensBefore) / elapsedSeconds;
        const stepsPerSecond = (step + 1) / elapsedSeconds;
        const logEntry = createLogEntry(
          [
            `step ${String(completedSteps).padStart(String(targetTotalSteps).length, " ")}/${targetTotalSteps}`,
            `loss ${finalLoss.toFixed(4)}`,
            `tokens/s ${Math.round(tokPerSecond).toLocaleString("en-US")}`,
            `step/s ${stepsPerSecond.toFixed(2)}`,
          ].join("  "),
        );
        const summary: TrainingStepSummary = {
          checkpoint: shouldAutosave
            ? await this.getCheckpoint(completedSteps, totalTokens, finalLoss)
            : undefined,
          completedSteps,
          logEntry,
          loss: finalLoss,
          stepsPerSecond,
          tokPerSecond,
          totalSteps: targetTotalSteps,
          totalTokens,
        };
        await onProgress(summary, shouldAutosave);
      }
    }

    const checkpoint = await this.getCheckpoint(completedSteps, totalTokens, finalLoss);
    const generatedResults = await this.generateSamples(generationConfig);
    const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 1e-9);
    const completionEntry = createLogEntry(
      `Training finished in ${elapsedSeconds.toFixed(1)} seconds on ${this.resolvedBackend}.`,
      "success",
    );

    await onProgress(
      {
        checkpoint,
        completedSteps,
        generatedResults,
        logEntry: completionEntry,
        loss: finalLoss,
        stepsPerSecond: this.trainingConfig.steps / elapsedSeconds,
        tokPerSecond: (totalTokens - totalTokensBefore) / elapsedSeconds,
        totalSteps: targetTotalSteps,
        totalTokens,
      },
      true,
    );

    return {
      checkpoint,
      generatedResults,
    };
  }

  dispose() {
    this.model.ordered.forEach((item) => {
      item.variable.dispose();
      item.firstMoment.dispose();
      item.secondMoment.dispose();
    });
    this.causalMaskCache.forEach((mask) => {
      mask.dispose();
    });
    this.positionIndexCache.forEach((positions) => {
      positions.dispose();
    });
    this.causalMaskCache.clear();
    this.positionIndexCache.clear();
  }

  getResolvedBackend() {
    return this.resolvedBackend;
  }

  getResumeState() {
    return this.resumeState;
  }

  private async applyTrainingStep(x: tf.Tensor2D, y: tf.Tensor2D, learningRate: number) {
    const optimizerStep = this.optimizerStep + 1;
    const beta1Correction = 1 - this.trainingConfig.beta1 ** optimizerStep;
    const beta2Correction = 1 - this.trainingConfig.beta2 ** optimizerStep;
    const variableList = this.model.ordered.map((item) => item.variable);
    const { grads, value } = tf.variableGrads(() => {
      const logits = this.forward(x);
      const flattenedLogits = logits.reshape([-1, this.trainingConfig.model.vocabSize]);
      const labels = y.reshape([-1]);
      const oneHot = tf.oneHot(labels, this.trainingConfig.model.vocabSize);
      return tf.losses.softmaxCrossEntropy(oneHot, flattenedLogits);
    }, variableList);

    const loss = Number((await value.data())[0] ?? Number.NaN);
    value.dispose();

    for (const item of this.model.ordered) {
      const gradient = grads[item.variable.name];
      if (!gradient) {
        continue;
      }

      tf.tidy(() => {
        const nextFirstMoment = item.firstMoment
          .mul(this.trainingConfig.beta1)
          .add(gradient.mul(1 - this.trainingConfig.beta1));
        const nextSecondMoment = item.secondMoment
          .mul(this.trainingConfig.beta2)
          .add(gradient.square().mul(1 - this.trainingConfig.beta2));
        const correctedFirstMoment = nextFirstMoment.div(beta1Correction);
        const correctedSecondMoment = nextSecondMoment.div(beta2Correction);
        const weightDecayTerm = item.variable.mul(this.trainingConfig.weightDecay);
        const normalizedGradient = correctedFirstMoment.div(
          correctedSecondMoment.sqrt().add(this.trainingConfig.eps),
        );
        const update = normalizedGradient.add(weightDecayTerm).mul(learningRate);

        item.firstMoment.assign(nextFirstMoment);
        item.secondMoment.assign(nextSecondMoment);
        item.variable.assign(item.variable.sub(update));
      });

      gradient.dispose();
    }

    this.optimizerStep = optimizerStep;
    return loss;
  }

  private async generateOneSample(generationConfig: GenerationConfig, rng: DreamPhraseRng) {
    const tokenIds = [this.dataset.tokenizer.bosId];
    const characters: string[] = [];

    for (let step = 0; step < generationConfig.requestedBlockSize; step += 1) {
      const window = tokenIds.slice(-generationConfig.requestedBlockSize);
      const logits = tf.tidy(() =>
        this.forward(tf.tensor2d(window, [1, window.length], "int32")).slice(
          [0, window.length - 1, 0],
          [1, 1, this.dataset.tokenizer.vocabSize],
        ),
      );
      const values = Array.from(await logits.data());
      logits.dispose();
      const nextId = sampleLogitIndex(values, clampTemperature(generationConfig.temperature), rng);

      if (nextId === this.dataset.tokenizer.bosId) {
        break;
      }

      const nextCharacter = this.dataset.tokenizer.idToChar[nextId];
      if (typeof nextCharacter !== "string") {
        throw new Error("The model produced a token outside the tokenizer range.");
      }

      characters.push(nextCharacter);
      tokenIds.push(nextId);
    }

    return characters.join("");
  }

  private forward(idx: tf.Tensor2D) {
    return tf.tidy(() => {
      const [, sequenceLength] = idx.shape;
      if (sequenceLength > this.trainingConfig.model.blockSize) {
        throw new Error(
          `Sequence length ${sequenceLength} exceeds block size ${this.trainingConfig.model.blockSize}.`,
        );
      }

      const tokenEmbedding = tf.gather(this.model.tokenEmbedding.variable, idx);
      const positions = this.getPositionIndices(sequenceLength);
      const positionEmbedding = tf
        .gather(this.model.positionEmbedding.variable, positions)
        .reshape([1, sequenceLength, this.trainingConfig.model.nEmbd]);

      let x = tokenEmbedding.add(positionEmbedding) as tf.Tensor3D;

      for (const block of this.model.blocks) {
        const attn = this.causalSelfAttention(
          rmsNorm(x, block.norm1.variable) as tf.Tensor3D,
          block,
          sequenceLength,
        );
        x = x.add(attn) as tf.Tensor3D;
        const feedForward = this.swiGluFeedForward(
          rmsNorm(x, block.norm2.variable) as tf.Tensor3D,
          block,
        );
        x = x.add(feedForward) as tf.Tensor3D;
      }

      const normalized = rmsNorm(x, this.model.normF.variable) as tf.Tensor3D;
      return applyLinear3d(
        normalized,
        this.model.lmHead.variable,
        this.trainingConfig.model.vocabSize,
      );
    });
  }

  private causalSelfAttention(x: tf.Tensor3D, block: BlockState, sequenceLength: number) {
    return tf.tidy(() => {
      const { nEmbd, nHead } = this.trainingConfig.model;
      const headDim = nEmbd / nHead;
      const [batchSize] = x.shape;
      const qkv = applyLinear3d(x, block.attnQkv.variable, nEmbd * 3);
      const [q, k, v] = tf.split(qkv, 3, -1);
      const qHeads = q.reshape([batchSize, sequenceLength, nHead, headDim]).transpose([0, 2, 1, 3]);
      const kHeads = k.reshape([batchSize, sequenceLength, nHead, headDim]).transpose([0, 2, 1, 3]);
      const vHeads = v.reshape([batchSize, sequenceLength, nHead, headDim]).transpose([0, 2, 1, 3]);
      const attentionScores = tf
        .matMul(qHeads, kHeads.transpose([0, 1, 3, 2]))
        .div(Math.sqrt(headDim));
      const maskedScores = attentionScores.add(this.getCausalMask(sequenceLength));
      const attentionWeights = tf.softmax(maskedScores, -1);
      const attended = tf
        .matMul(attentionWeights, vHeads)
        .transpose([0, 2, 1, 3])
        .reshape([batchSize, sequenceLength, nEmbd]) as tf.Tensor3D;
      return applyLinear3d(attended, block.attnProj.variable, nEmbd);
    });
  }

  private swiGluFeedForward(x: tf.Tensor3D, block: BlockState) {
    return tf.tidy(() => {
      const gate = applyLinear3d(x, block.ffGate.variable, this.trainingConfig.model.mlpHiddenDim);
      const up = applyLinear3d(x, block.ffUp.variable, this.trainingConfig.model.mlpHiddenDim);
      const activated = tf.sigmoid(gate).mul(gate).mul(up);
      return applyLinear3d(
        activated as tf.Tensor3D,
        block.ffDown.variable,
        this.trainingConfig.model.nEmbd,
      );
    });
  }

  private getCausalMask(sequenceLength: number) {
    const cachedMask = this.causalMaskCache.get(sequenceLength);
    if (cachedMask) {
      return cachedMask;
    }

    const mask = tf.keep(buildCausalMask(sequenceLength));
    this.causalMaskCache.set(sequenceLength, mask);
    return mask;
  }

  private getPositionIndices(sequenceLength: number) {
    const cachedPositions = this.positionIndexCache.get(sequenceLength);
    if (cachedPositions) {
      return cachedPositions;
    }

    const positions = tf.keep(tf.range(0, sequenceLength, 1, "int32"));
    this.positionIndexCache.set(sequenceLength, positions);
    return positions;
  }
}

export async function resolveBackendPreference(
  requestedBackend: BackendPreference,
): Promise<ResolvedBackend> {
  const tryWebGpu = requestedBackend === "auto" || requestedBackend === "webgpu";
  if (tryWebGpu) {
    try {
      await tf.setBackend("webgpu");
      await tf.ready();
      return "webgpu";
    } catch {
      // Fall through to CPU.
    }
  }

  await tf.setBackend("cpu");
  await tf.ready();
  return "cpu";
}

function buildTrainingStartLogs({
  dataset,
  fileName,
  modelConfig,
  parameterCount,
  resolvedBackend,
  resumedFromStep,
  trainingConfig,
  targetTotalSteps,
}: {
  dataset: PreparedDataset;
  fileName: string;
  modelConfig: ModelConfig;
  parameterCount: number;
  resolvedBackend: ResolvedBackend;
  resumedFromStep: number;
  trainingConfig: TrainingConfig;
  targetTotalSteps: number;
}) {
  const logs: LogEntry[] = [];

  logs.push(createSectionLogEntry("dataset"));
  logs.push(createLogEntry(`file    ${fileName}`));
  logs.push(createLogEntry(`docs    ${formatNumber(dataset.stats.documentCount)}`));
  logs.push(createLogEntry(`vocab   ${formatNumber(dataset.stats.vocabSize)} chars`));
  logs.push(createLogEntry(`tokens  ${formatNumber(dataset.stats.tokenCount)}`));
  logs.push(createSectionLogEntry("model"));
  logs.push(createLogEntry(`params   ${formatNumber(parameterCount)}`));
  logs.push(createLogEntry(`layers   ${modelConfig.nLayer}`));
  logs.push(createLogEntry(`heads    ${modelConfig.nHead}`));
  logs.push(createLogEntry(`embd     ${modelConfig.nEmbd}`));
  logs.push(createLogEntry(`block    ${modelConfig.blockSize}`));
  logs.push(createSectionLogEntry("training"));
  logs.push(createLogEntry(`device   ${resolvedBackend}`));
  logs.push(createLogEntry("amp      off"));
  logs.push(createLogEntry("compile  off"));
  logs.push(createLogEntry(`steps    ${formatNumber(targetTotalSteps)}`));
  logs.push(createLogEntry(`batch    ${formatNumber(trainingConfig.batchSize)}`));
  logs.push(createLogEntry(`lr       ${trainingConfig.learningRate.toExponential(2)}`));
  if (resumedFromStep > 0) {
    logs.push(createLogEntry(`from     step ${formatNumber(resumedFromStep)}`));
  }
  return logs;
}

function createTrainingBatch(
  datasetData: Int32Array,
  batchSize: number,
  blockSize: number,
  rng: DreamPhraseRng,
) {
  const maxStart = datasetData.length - blockSize - 1;
  const xValues = new Int32Array(batchSize * blockSize);
  const yValues = new Int32Array(batchSize * blockSize);

  for (let batchIndex = 0; batchIndex < batchSize; batchIndex += 1) {
    const start = rng.nextInt(maxStart + 1);
    const offset = batchIndex * blockSize;
    xValues.set(datasetData.subarray(start, start + blockSize), offset);
    yValues.set(datasetData.subarray(start + 1, start + blockSize + 1), offset);
  }

  return {
    x: tf.tensor2d(xValues, [batchSize, blockSize], "int32"),
    y: tf.tensor2d(yValues, [batchSize, blockSize], "int32"),
  };
}

function createModelState(
  modelConfig: ModelConfig,
  rng: DreamPhraseRng,
  serializedWeights?: SerializedTensor[],
  optimizerState?: OptimizerStateSnapshot,
) {
  const ordered: TrainableState[] = [];
  const serializedWeightMap = new Map(serializedWeights?.map((item) => [item.name, item]) ?? []);
  const firstMomentMap = new Map(
    optimizerState?.firstMoments.map((item) => [item.name, item]) ?? [],
  );
  const secondMomentMap = new Map(
    optimizerState?.secondMoments.map((item) => [item.name, item]) ?? [],
  );

  function createTrainable(name: string, shape: number[], init: "normal" | "ones"): TrainableState {
    const initialTensor = deserializeOrCreateTensor(
      serializedWeightMap.get(name),
      shape,
      init,
      rng,
    );
    const firstMoment = deserializeOrCreateTensor(firstMomentMap.get(name), shape, "zeros", rng);
    const secondMoment = deserializeOrCreateTensor(secondMomentMap.get(name), shape, "zeros", rng);
    const trainable = {
      firstMoment,
      name,
      secondMoment,
      variable: initialTensor,
    };
    ordered.push(trainable);
    return trainable;
  }

  const tokenEmbedding = createTrainable(
    "token_embedding",
    [modelConfig.vocabSize, modelConfig.nEmbd],
    "normal",
  );
  const positionEmbedding = createTrainable(
    "position_embedding",
    [modelConfig.blockSize, modelConfig.nEmbd],
    "normal",
  );
  const blocks = Array.from({ length: modelConfig.nLayer }, (_, index) => ({
    attnProj: createTrainable(
      `blocks.${index}.attn_proj`,
      [modelConfig.nEmbd, modelConfig.nEmbd],
      "normal",
    ),
    attnQkv: createTrainable(
      `blocks.${index}.attn_qkv`,
      [modelConfig.nEmbd, modelConfig.nEmbd * 3],
      "normal",
    ),
    ffDown: createTrainable(
      `blocks.${index}.ff_down`,
      [modelConfig.mlpHiddenDim, modelConfig.nEmbd],
      "normal",
    ),
    ffGate: createTrainable(
      `blocks.${index}.ff_gate`,
      [modelConfig.nEmbd, modelConfig.mlpHiddenDim],
      "normal",
    ),
    ffUp: createTrainable(
      `blocks.${index}.ff_up`,
      [modelConfig.nEmbd, modelConfig.mlpHiddenDim],
      "normal",
    ),
    norm1: createTrainable(`blocks.${index}.norm1`, [modelConfig.nEmbd], "ones"),
    norm2: createTrainable(`blocks.${index}.norm2`, [modelConfig.nEmbd], "ones"),
  }));
  const normF = createTrainable("norm_f", [modelConfig.nEmbd], "ones");
  const lmHead = createTrainable("lm_head", [modelConfig.nEmbd, modelConfig.vocabSize], "normal");

  return {
    blocks,
    lmHead,
    normF,
    ordered,
    positionEmbedding,
    tokenEmbedding,
  } satisfies ModelState;
}

function deserializeOrCreateTensor(
  serialized: SerializedTensor | undefined,
  shape: number[],
  init: "normal" | "ones" | "zeros",
  rng: DreamPhraseRng,
) {
  if (serialized) {
    return tf.variable(
      tf.tensor(
        serialized.values,
        serialized.shape,
        serialized.values instanceof Int32Array ? "int32" : "float32",
      ),
    );
  }

  const size = shape.reduce((product, value) => product * value, 1);
  let values: Float32Array;

  if (init === "ones") {
    values = new Float32Array(size);
    values.fill(1);
  } else if (init === "zeros") {
    values = new Float32Array(size);
  } else {
    values = createNormalArray(size, rng, INIT_WEIGHT_STDDEV);
  }

  return tf.variable(tf.tensor(values, shape, "float32"));
}

function createNormalArray(size: number, rng: DreamPhraseRng, stdDev: number) {
  const values = new Float32Array(size);
  let hasSpare = false;
  let spare = 0;

  for (let index = 0; index < size; index += 1) {
    if (hasSpare) {
      values[index] = spare * stdDev;
      hasSpare = false;
      continue;
    }

    let u = 0;
    let v = 0;
    while (u === 0) {
      u = rng.nextFloat();
    }
    while (v === 0) {
      v = rng.nextFloat();
    }
    const magnitude = Math.sqrt(-2 * Math.log(u));
    const theta = 2 * Math.PI * v;
    values[index] = magnitude * Math.cos(theta) * stdDev;
    spare = magnitude * Math.sin(theta);
    hasSpare = true;
  }

  return values;
}

function rmsNorm(x: tf.Tensor, weight: tf.Variable) {
  return tf.tidy(() => {
    const meanSquare = tf.mean(tf.square(x), -1, true);
    const scale = tf.rsqrt(meanSquare.add(RMS_NORM_EPSILON));
    return x.mul(scale).mul(weight.reshape([1, 1, weight.shape[0] ?? 1]));
  });
}

function applyLinear3d(x: tf.Tensor3D, weight: tf.Variable, outputDim: number) {
  const [batchSize, sequenceLength, inputDim] = x.shape;
  const flattened = x.reshape([batchSize * sequenceLength, inputDim]);
  return tf.matMul(flattened, weight).reshape([batchSize, sequenceLength, outputDim]);
}

function buildCausalMask(sequenceLength: number) {
  const values = new Float32Array(sequenceLength * sequenceLength);

  for (let row = 0; row < sequenceLength; row += 1) {
    for (let column = row + 1; column < sequenceLength; column += 1) {
      values[row * sequenceLength + column] = LARGE_NEGATIVE;
    }
  }

  return tf.tensor4d(values, [1, 1, sequenceLength, sequenceLength], "float32");
}

function countParameters(trainables: TrainableState[]) {
  return trainables.reduce(
    (total, item) => total + item.variable.shape.reduce((product, value) => product * value, 1),
    0,
  );
}

async function serializeCheckpoint({
  dataset,
  file,
  model,
  optimizerStep,
  requestedBackend,
  resolvedBackend,
  resumeState,
  rngState,
  trainingConfig,
}: {
  dataset: PreparedDataset;
  file: Pick<WorkspaceFile, "id" | "name">;
  model: ModelState;
  optimizerStep: number;
  requestedBackend: BackendPreference;
  resolvedBackend: ResolvedBackend;
  resumeState: SerializedCheckpoint["resumeState"];
  rngState: number;
  trainingConfig: TrainingConfig;
}): Promise<SerializedCheckpoint> {
  const weights = await Promise.all(
    model.ordered.map(async (item) => ({
      name: item.name,
      shape: [...item.variable.shape],
      values: new Float32Array(await item.variable.data()),
    })),
  );
  const firstMoments = await Promise.all(
    model.ordered.map(async (item) => ({
      name: item.name,
      shape: [...item.firstMoment.shape],
      values: new Float32Array(await item.firstMoment.data()),
    })),
  );
  const secondMoments = await Promise.all(
    model.ordered.map(async (item) => ({
      name: item.name,
      shape: [...item.secondMoment.shape],
      values: new Float32Array(await item.secondMoment.data()),
    })),
  );

  return {
    datasetData: new Int32Array(dataset.data),
    datasetStats: dataset.stats,
    exportedAt: Date.now(),
    fileId: file.id,
    fileName: file.name,
    modelConfig: trainingConfig.model,
    optimizerState: {
      firstMoments,
      secondMoments,
      step: optimizerStep,
    },
    requestedBackend,
    resolvedBackend,
    resumeState,
    rngState,
    sourceFilter: {
      ...dataset.sourceFilter,
      bits: new Uint8Array(dataset.sourceFilter.bits),
    },
    tokenizer: dataset.tokenizer,
    trainingConfig,
    weights,
  };
}

function sampleLogitIndex(logits: number[], temperature: number, rng: DreamPhraseRng) {
  const scaledTemperature = 1 / temperature;
  let maxScaledLogit = Number.NEGATIVE_INFINITY;

  for (const logit of logits) {
    const scaledLogit = logit * scaledTemperature;
    if (scaledLogit > maxScaledLogit) {
      maxScaledLogit = scaledLogit;
    }
  }

  const weights = logits.map((logit) => Math.exp(logit * scaledTemperature - maxScaledLogit));
  const totalWeight = weights.reduce((total, value) => total + value, 0);
  let remaining = rng.nextFloat() * totalWeight;

  for (let index = 0; index < weights.length; index += 1) {
    remaining -= weights[index] ?? 0;
    if (remaining <= 0) {
      return index;
    }
  }

  return weights.length - 1;
}
