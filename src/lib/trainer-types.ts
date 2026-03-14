export type BuiltInDatasetKey = "english_words" | "us_baby_names";
export type WorkspaceFileSource = "builtin" | "user";
export type TrainingRunStatus = "idle" | "starting" | "training" | "completed" | "error";
export type BackendPreference = "auto" | "webgpu" | "cpu";
export type ResolvedBackend = "webgpu" | "cpu";
export type LogKind = "section" | "line" | "success" | "error";
export type RunPanelTab = "generated" | "likes";
export type RunArtifactKind = "model";
export type DownloadableArtifactKind = RunArtifactKind;
export type ArtifactStorageKind = "indexeddb" | "opfs";

export type ModelConfig = {
  blockSize: number;
  mlpHiddenDim: number;
  mlpType: "swiglu";
  nEmbd: number;
  nHead: number;
  nLayer: number;
  vocabSize: number;
};

export type TrainingConfig = {
  ampRequested: boolean | null;
  batchSize: number;
  beta1: number;
  beta2: number;
  compileRequested: boolean | null;
  eps: number;
  learningRate: number;
  model: ModelConfig;
  printEvery: number;
  requestedBackend: BackendPreference;
  requestedDeviceLabel: string;
  requestedDtype: "auto" | "fp32" | "fp16" | "bf16";
  seed: number;
  steps: number;
  weightDecay: number;
};

export type GenerationConfig = {
  numSamples: number;
  requestedBlockSize: number;
  temperature: number;
};

export type DatasetStats = {
  characterCount: number;
  documentCount: number;
  lineCount: number;
  tokenCount: number;
  vocabSize: number;
};

export type DatasetTextSummary = {
  characterCount: number;
  documentCount: number;
  lineCount: number;
  tokenCount: number;
  vocabSize: number;
};

export type WorkspaceFile = {
  builtInKey?: BuiltInDatasetKey;
  content: string;
  createdAt: number;
  description?: string;
  id: string;
  name: string;
  source: WorkspaceFileSource;
  title?: string;
  updatedAt: number;
};

export type TokenizerSnapshot = {
  blockSize: number;
  bosId: number;
  idToChar: string[];
  vocabSize: number;
};

export type SourceFilterSnapshot = {
  bitCount: number;
  bits: Uint8Array;
  falsePositiveRate: number;
  hashCount: number;
  itemCount: number;
  kind: string;
  version: number;
};

export type SerializedTensor = {
  name: string;
  shape: number[];
  values: Float32Array | Int32Array;
};

export type OptimizerStateSnapshot = {
  firstMoments: SerializedTensor[];
  secondMoments: SerializedTensor[];
  step: number;
};

export type ResumeStateSnapshot = {
  completedSteps: number;
  elapsedTrainingSeconds?: number;
  finalLoss: number;
  lastSavedAt: number;
  totalTokens: number;
};

export type SerializedCheckpoint = {
  datasetData: Int32Array;
  datasetStats: DatasetStats;
  exportedAt: number;
  fileId: string;
  fileName: string;
  modelConfig: ModelConfig;
  optimizerState: OptimizerStateSnapshot;
  requestedBackend: BackendPreference;
  resolvedBackend: ResolvedBackend;
  resumeState: ResumeStateSnapshot;
  rngState: number;
  sourceFilter: SourceFilterSnapshot;
  tokenizer: TokenizerSnapshot;
  trainingConfig: TrainingConfig;
  weights: SerializedTensor[];
};

export type LogEntry = {
  createdAt: number;
  id: string;
  kind: LogKind;
  message: string;
};

export type GeneratedResultsByTemperature = Record<string, string[]>;

export type TrainingTelemetryPoint = {
  elapsedTimeSeconds?: number;
  loss: number;
  step: number;
  stepsPerSecond: number;
  time: number;
  tokPerSecond: number;
  totalSteps: number;
  totalTokens: number;
};

export type ArtifactFileSummary = {
  fileName: string;
  kind: RunArtifactKind;
  sizeBytes: number;
  storage: ArtifactStorageKind;
  updatedAt: number;
};

export type TrainingRunRecord = {
  artifacts?: Partial<Record<DownloadableArtifactKind, ArtifactFileSummary>>;
  checkpoint?: SerializedCheckpoint;
  checkpointSavedAt?: number;
  createdAt: number;
  datasetStats: DatasetStats;
  fileId: string;
  fileName: string;
  generatedResults: GeneratedResultsByTemperature;
  id: string;
  lastError?: string;
  likes: string[];
  logs: LogEntry[];
  name: string;
  status: TrainingRunStatus;
  telemetry: TrainingTelemetryPoint[];
  trainingConfig: TrainingConfig;
  updatedAt: number;
};

export type ModelDownloadFile = {
  fileName: string;
  mimeType: string;
  value: ArrayBuffer;
};

export type RunArtifactFile = ModelDownloadFile & {
  kind: RunArtifactKind;
  storage?: ArtifactStorageKind;
};

export type RunArtifactSet = {
  model: RunArtifactFile;
};

export type StoredRunArtifact = Omit<RunArtifactFile, "storage" | "value"> & {
  id: string;
  opfsPath?: string;
  runId: string;
  sizeBytes: number;
  storage: ArtifactStorageKind;
  updatedAt: number;
  value?: ArrayBuffer;
};

export type PersistedTrainingRunRecord = Omit<TrainingRunRecord, "checkpoint">;

export type TrainerCommand =
  | {
      checkpoint: SerializedCheckpoint;
      generationConfig: GenerationConfig;
      runId: string;
      type: "generateSamples";
    }
  | {
      checkpoint: SerializedCheckpoint;
      runId: string;
      type: "loadRun";
    }
  | {
      checkpoint: SerializedCheckpoint;
      file: Pick<WorkspaceFile, "content" | "id" | "name">;
      generationConfig: GenerationConfig;
      runId: string;
      trainingConfig: TrainingConfig;
      type: "resumeTraining";
    }
  | {
      runId: string;
      type: "deleteRun";
    }
  | {
      type: "resetAll";
    }
  | {
      file: Pick<WorkspaceFile, "content" | "id" | "name">;
      generationConfig: GenerationConfig;
      runId: string;
      trainingConfig: TrainingConfig;
      type: "startTraining";
    };

export type TrainerEvent =
  | { message: string; runId: string | null; type: "error" }
  | {
      generatedResults: string[];
      logEntry: LogEntry;
      runId: string;
      temperatureKey: string;
      type: "generationCompleted";
    }
  | {
      logEntry: LogEntry;
      runId: string;
      type: "log";
    }
  | {
      type: "ready";
    }
  | {
      runId: string;
      type: "resetComplete";
    }
  | {
      checkpointSavedAt: number;
      datasetStats: DatasetStats;
      runId: string;
      type: "trainingCheckpoint";
    }
  | {
      checkpointSavedAt: number;
      datasetStats: DatasetStats;
      elapsedSeconds: number;
      generatedResults: string[];
      runId: string;
      temperatureKey: string;
      type: "trainingCompleted";
    }
  | {
      logEntry: LogEntry;
      runId: string;
      type: "trainingProgress";
    }
  | {
      point: TrainingTelemetryPoint;
      runId: string;
      type: "trainingTelemetry";
    }
  | {
      logEntry: LogEntry;
      resolvedBackend: ResolvedBackend;
      runId: string;
      type: "trainingStarted";
    };

export function swigluHiddenDim(nEmbd: number) {
  return Math.max(1, Math.floor((8 * nEmbd) / 3));
}

export function validateModelConfig(model: Pick<ModelConfig, "nEmbd" | "nHead">) {
  if (!Number.isInteger(model.nEmbd) || model.nEmbd < 1) {
    throw new Error("Embedding width must be a positive integer.");
  }

  if (!Number.isInteger(model.nHead) || model.nHead < 1) {
    throw new Error("Attention head count must be a positive integer.");
  }

  if (model.nEmbd % model.nHead !== 0) {
    throw new Error("Embedding width must be divisible by attention head count.");
  }

  return model;
}

export function createModelConfigFromDimensions({
  blockSize,
  nEmbd,
  nHead,
  nLayer,
  vocabSize,
}: {
  blockSize: number;
  nEmbd: number;
  nHead: number;
  nLayer: number;
  vocabSize: number;
}): ModelConfig {
  validateModelConfig({ nEmbd, nHead });

  return {
    blockSize,
    mlpHiddenDim: swigluHiddenDim(nEmbd),
    mlpType: "swiglu",
    nEmbd,
    nHead,
    nLayer,
    vocabSize,
  };
}

export function createGenerationConfig(config: GenerationConfig): GenerationConfig {
  return {
    numSamples: config.numSamples,
    requestedBlockSize: config.requestedBlockSize,
    temperature: config.temperature,
  };
}

export function getTrainingRunStatusBadgeVariant(status: TrainingRunStatus) {
  switch (status) {
    case "completed":
      return "success";
    case "starting":
    case "training":
      return "warning";
    case "error":
      return "error";
    default:
      return "info";
  }
}

export function isTrainingRunInProgress(status: TrainingRunStatus) {
  return status === "starting" || status === "training";
}

export function hasTrainingRun(runs: Array<Pick<TrainingRunRecord, "status">>) {
  return runs.some((run) => isTrainingRunInProgress(run.status));
}

export function getTrainingRunCompletedSteps(
  run: Pick<TrainingRunRecord, "checkpoint" | "telemetry">,
) {
  const checkpointSteps = run.checkpoint?.resumeState.completedSteps ?? 0;
  const telemetrySteps = run.telemetry.at(-1)?.step ?? 0;
  return Math.max(checkpointSteps, telemetrySteps);
}

export function resolveTrainingRunResumeTargetSteps(
  run: Pick<TrainingRunRecord, "checkpoint" | "status" | "telemetry" | "trainingConfig">,
  requestedSteps = run.trainingConfig.steps,
) {
  const completedSteps = getTrainingRunCompletedSteps(run);
  const storedTargetSteps = run.trainingConfig.steps;

  if (run.status === "completed" || completedSteps >= storedTargetSteps) {
    return completedSteps + requestedSteps;
  }

  return Math.max(storedTargetSteps, requestedSteps, completedSteps);
}

export function canResumeTrainingRun(
  run: Pick<
    TrainingRunRecord,
    "checkpoint" | "checkpointSavedAt" | "status" | "telemetry" | "trainingConfig"
  >,
  requestedSteps = run.trainingConfig.steps,
) {
  if (isTrainingRunInProgress(run.status)) {
    return false;
  }

  if (!run.checkpoint && !run.checkpointSavedAt) {
    return false;
  }

  return (
    resolveTrainingRunResumeTargetSteps(run, requestedSteps) > getTrainingRunCompletedSteps(run)
  );
}
