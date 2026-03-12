import {
  type BackendPreference,
  type BuiltInDatasetKey,
  createGenerationConfig,
  createModelConfigFromDimensions,
  type GenerationConfig,
  type TrainingConfig,
} from "@/lib/trainer-types";

export const PRODUCT_NAME = "DreamPhraseGPT Browser Trainer";
export const STORAGE_DB_NAME = "dreamphrasegpt-browser";
export const STORAGE_DB_VERSION = 3;
export const SOURCE_FILTER_KIND = "bloom";
export const SOURCE_FILTER_VERSION = 1;
export const SOURCE_FILTER_FALSE_POSITIVE_RATE = 1e-4;
export const SOURCE_FILTER_MAX_RETRIES = 40;
export const FALLBACK_HASH_STEP = 0x9e3779b97f4a7c15n;
export const ACTIVE_RUN_STORAGE_KEY = "dreamphrasegpt-browser:active-run";
export const ACTIVE_FILE_STORAGE_KEY = "dreamphrasegpt-browser:active-file";
export const AUTOSAVE_STEP_INTERVAL = 250;
export const DEFAULT_BACKEND_PREFERENCE: BackendPreference = "auto";

export const BUILTIN_DATASETS: {
  description: string;
  fileName: string;
  id: string;
  key: BuiltInDatasetKey;
  publicPath: string;
  title: string;
}[] = [
  {
    description: "About 370,000 newline-delimited English words.",
    fileName: "english_words.txt",
    id: "builtin-english-words",
    key: "english_words",
    publicPath: "datasets/english_words.txt",
    title: "English Words",
  },
  {
    description: "About 105,000 newline-delimited U.S. baby names.",
    fileName: "us_baby_names.txt",
    id: "builtin-us-baby-names",
    key: "us_baby_names",
    publicPath: "datasets/us_baby_names.txt",
    title: "U.S. Baby Names",
  },
];

export const DEFAULT_TRAINING_CONFIG: TrainingConfig = {
  ampRequested: null,
  batchSize: 256,
  beta1: 0.9,
  beta2: 0.95,
  compileRequested: null,
  eps: 1e-8,
  learningRate: 3e-4,
  model: createModelConfigFromDimensions({
    blockSize: 32,
    nEmbd: 128,
    nHead: 4,
    nLayer: 4,
    vocabSize: 1,
  }),
  printEvery: 50,
  requestedBackend: DEFAULT_BACKEND_PREFERENCE,
  requestedDeviceLabel: "browser",
  requestedDtype: "auto",
  seed: 42,
  steps: 3000,
  weightDecay: 0.01,
};

export const DEFAULT_GENERATION_CONFIG: GenerationConfig = createGenerationConfig({
  numSamples: 20,
  requestedBlockSize: DEFAULT_TRAINING_CONFIG.model.blockSize,
  temperature: 0.8,
});
