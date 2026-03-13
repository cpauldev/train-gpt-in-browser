import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import { createId } from "@/lib/trainer-core";
import {
  ACTIVE_FILE_STORAGE_KEY,
  ACTIVE_RUN_STORAGE_KEY,
  BUILTIN_DATASETS,
  STORAGE_DB_NAME,
  STORAGE_DB_VERSION,
} from "@/lib/trainer-defaults";
import type {
  ArtifactFileSummary,
  PersistedTrainingRunRecord,
  RunArtifactFile,
  RunArtifactKind,
  RunArtifactSet,
  StoredRunArtifact,
  TrainingRunRecord,
  WorkspaceFile,
} from "@/lib/trainer-types";
import { resolveBasePath } from "@/lib/utils";

type AppPreferenceValue = string | null;

type AppPreferenceRecord = {
  key: string;
  value: AppPreferenceValue;
};

type StoredTrainingCheckpoint = {
  checkpoint: NonNullable<TrainingRunRecord["checkpoint"]>;
  id: string;
  storage: "indexeddb";
  updatedAt: number;
};

interface TrainerDbSchema extends DBSchema {
  app: {
    key: string;
    value: AppPreferenceRecord;
  };
  artifacts: {
    key: string;
    value: StoredRunArtifact;
  };
  checkpoints: {
    key: string;
    value: StoredTrainingCheckpoint;
  };
  files: {
    key: string;
    value: WorkspaceFile;
  };
  runs: {
    key: string;
    value: PersistedTrainingRunRecord;
  };
}

let dbPromise: Promise<IDBPDatabase<TrainerDbSchema>> | null = null;

export async function getTrainerDb() {
  if (!dbPromise) {
    dbPromise = openDB<TrainerDbSchema>(STORAGE_DB_NAME, STORAGE_DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains("app")) {
          database.createObjectStore("app", { keyPath: "key" });
        }
        if (!database.objectStoreNames.contains("files")) {
          database.createObjectStore("files", { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains("runs")) {
          database.createObjectStore("runs", { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains("artifacts")) {
          database.createObjectStore("artifacts", { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains("checkpoints")) {
          database.createObjectStore("checkpoints", { keyPath: "id" });
        }
      },
    });
  }

  return dbPromise;
}

export async function seedBuiltinWorkspaceFiles() {
  const db = await getTrainerDb();
  const existingFiles = await db.getAll("files");
  const existingBuiltInKeys = new Set(existingFiles.map((file) => file.builtInKey).filter(Boolean));

  for (const dataset of BUILTIN_DATASETS) {
    if (existingBuiltInKeys.has(dataset.key)) {
      continue;
    }

    const response = await fetch(resolveBasePath(dataset.publicPath));
    if (!response.ok) {
      throw new Error(`Failed to load built-in dataset: ${dataset.fileName}`);
    }

    const content = await response.text();
    const now = Date.now();
    await db.put("files", {
      builtInKey: dataset.key,
      content,
      createdAt: now,
      description: dataset.description,
      id: dataset.id,
      name: dataset.fileName,
      source: "builtin",
      title: dataset.title,
      updatedAt: now,
    });
  }
}

export async function listWorkspaceFiles() {
  const db = await getTrainerDb();
  const files = await db.getAll("files");
  return files.sort((left, right) => {
    if (left.source !== right.source) {
      return left.source === "builtin" ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

export async function getWorkspaceFile(fileId: string) {
  const db = await getTrainerDb();
  return db.get("files", fileId);
}

export async function saveWorkspaceFile(file: WorkspaceFile) {
  const db = await getTrainerDb();
  await db.put("files", file);
  return file;
}

export async function createWorkspaceFile(name: string, content = "") {
  const now = Date.now();
  const file: WorkspaceFile = {
    content,
    createdAt: now,
    id: createId("file"),
    name: normalizeTextFileName(name),
    source: "user",
    updatedAt: now,
  };
  await saveWorkspaceFile(file);
  return file;
}

export async function upsertImportedWorkspaceFile(name: string, content: string) {
  const db = await getTrainerDb();
  const normalizedName = normalizeTextFileName(name);
  const existingFiles = await db.getAll("files");
  const existingFile = existingFiles.find(
    (file) => file.source === "user" && file.name === normalizedName,
  );

  if (!existingFile) {
    return createWorkspaceFile(normalizedName, content);
  }

  const updatedFile: WorkspaceFile = {
    ...existingFile,
    content,
    updatedAt: Date.now(),
  };
  await db.put("files", updatedFile);
  return updatedFile;
}

export async function updateWorkspaceFileContent(fileId: string, content: string) {
  return updateStoredWorkspaceFile(fileId, (file) => ({
    ...file,
    content,
    updatedAt: Date.now(),
  }));
}

export async function renameWorkspaceFile(fileId: string, name: string) {
  return updateStoredWorkspaceFile(fileId, (file) => ({
    ...file,
    name: normalizeTextFileName(name),
    updatedAt: Date.now(),
  }));
}

export async function deleteWorkspaceFile(fileId: string) {
  const db = await getTrainerDb();
  await db.delete("files", fileId);
}

export async function listTrainingRuns() {
  const db = await getTrainerDb();
  const persistedRuns = await db.getAll("runs");
  const nextRuns = await Promise.all(
    persistedRuns.map(async (persistedRun) => inflatePersistedRun(db, persistedRun)),
  );
  return nextRuns.sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function getTrainingRun(runId: string) {
  const db = await getTrainerDb();
  const run = await db.get("runs", runId);
  if (!run) {
    return undefined;
  }
  return inflatePersistedRun(db, run);
}

export async function saveTrainingRun(
  run: TrainingRunRecord,
  options?: {
    persistCheckpoint?: boolean;
  },
) {
  const db = await getTrainerDb();
  const shouldPersistCheckpoint = Boolean((options?.persistCheckpoint ?? true) && run.checkpoint);

  if (!shouldPersistCheckpoint) {
    await db.put("runs", stripCheckpoint(run));
    return run;
  }

  const transaction = db.transaction(["checkpoints", "runs"], "readwrite");
  await transaction.objectStore("runs").put(stripCheckpoint(run));

  if (run.checkpoint) {
    await transaction
      .objectStore("checkpoints")
      .put(createStoredTrainingCheckpoint(run.id, run.checkpoint));
  }

  await transaction.done;
  return run;
}

export async function saveTrainingCheckpoint(
  runId: string,
  checkpoint: NonNullable<TrainingRunRecord["checkpoint"]>,
) {
  const db = await getTrainerDb();
  await db.put("checkpoints", createStoredTrainingCheckpoint(runId, checkpoint));
  return checkpoint;
}

export async function saveTrainingRunArtifacts(
  run: TrainingRunRecord,
  artifactSet: RunArtifactSet,
) {
  const db = await getTrainerDb();
  const now = Date.now();
  const storedArtifacts = await Promise.all(
    artifactSetToList(artifactSet).map((artifact) => persistStoredArtifact(run.id, artifact, now)),
  );
  const nextRun = attachArtifactSummaries(run, storedArtifacts);
  const transaction = db.transaction(["runs", "artifacts"], "readwrite");

  await transaction.objectStore("runs").put(stripCheckpoint(nextRun));
  for (const artifact of storedArtifacts) {
    await transaction.objectStore("artifacts").put(artifact);
  }

  await transaction.done;
  return nextRun;
}

export async function getTrainingRunArtifact(runId: string, kind: RunArtifactKind) {
  const db = await getTrainerDb();
  const artifact = await db.get("artifacts", buildArtifactId(runId, kind));
  if (!artifact) {
    return null;
  }

  if (artifact.storage === "opfs" && artifact.opfsPath) {
    const value = await readOpfsFile(artifact.opfsPath);
    if (!value) {
      return null;
    }
    return {
      fileName: artifact.fileName,
      kind: artifact.kind,
      mimeType: artifact.mimeType,
      storage: artifact.storage,
      value,
    };
  }

  if (!artifact.value) {
    return null;
  }

  return cloneArtifactFile(artifact);
}

export async function deleteTrainingRun(runId: string) {
  const db = await getTrainerDb();
  const transaction = db.transaction(["runs", "artifacts", "checkpoints"], "readwrite");
  await transaction.objectStore("runs").delete(runId);
  await transaction.objectStore("checkpoints").delete(runId);

  const runArtifacts = await listStoredRunArtifacts(db, runId);
  await Promise.all(
    runArtifacts.map((artifact) => transaction.objectStore("artifacts").delete(artifact.id)),
  );

  await transaction.done;
  await Promise.all(runArtifacts.map(deleteStoredArtifactFile));
}

export async function getAppPreference(key: string) {
  const db = await getTrainerDb();
  return (await db.get("app", key))?.value ?? null;
}

export async function setAppPreference(key: string, value: AppPreferenceValue) {
  const db = await getTrainerDb();
  await db.put("app", { key, value });
}

export async function getActiveFileId() {
  return getAppPreference(ACTIVE_FILE_STORAGE_KEY);
}

export async function setActiveFileId(fileId: string | null) {
  await setAppPreference(ACTIVE_FILE_STORAGE_KEY, fileId);
}

export async function getActiveRunId() {
  return getAppPreference(ACTIVE_RUN_STORAGE_KEY);
}

export async function setActiveRunId(runId: string | null) {
  await setAppPreference(ACTIVE_RUN_STORAGE_KEY, runId);
}

export async function resetTrainerStorage() {
  const db = await getTrainerDb();
  const transaction = db.transaction(
    ["app", "artifacts", "checkpoints", "files", "runs"],
    "readwrite",
  );
  const artifacts = await transaction.objectStore("artifacts").getAll();
  await Promise.all([
    transaction.objectStore("app").clear(),
    transaction.objectStore("artifacts").clear(),
    transaction.objectStore("checkpoints").clear(),
    transaction.objectStore("files").clear(),
    transaction.objectStore("runs").clear(),
    transaction.done,
  ]);
  await Promise.all(artifacts.map(deleteStoredArtifactFile));
}

async function inflatePersistedRun(
  db: IDBPDatabase<TrainerDbSchema>,
  persistedRun: PersistedTrainingRunRecord,
) {
  const hydratedRun = hydratePersistedRunShape(persistedRun);

  if (hydratedRun.checkpoint) {
    const migratedRun: TrainingRunRecord = {
      ...hydratedRun,
      checkpoint: cloneCheckpoint(hydratedRun.checkpoint),
    };
    await saveTrainingRun(migratedRun);
    return migratedRun;
  }

  const checkpointRecord = await db.get("checkpoints", hydratedRun.id);
  if (checkpointRecord?.checkpoint) {
    return {
      ...hydratedRun,
      checkpoint: cloneCheckpoint(checkpointRecord.checkpoint),
    } satisfies TrainingRunRecord;
  }

  const legacyArtifactSet = await getLegacyArtifactSet(db, hydratedRun.id);
  if (!legacyArtifactSet) {
    return {
      ...hydratedRun,
    } satisfies TrainingRunRecord;
  }

  const { parseDreamPhraseArtifactSet } = await import("@/lib/dreamphrase-artifacts");
  const checkpoint = parseDreamPhraseArtifactSet({
    modelArtifact: legacyArtifactSet.modelState.value,
    resumeArtifact: legacyArtifactSet.resumeState.value,
  });
  const migratedRun: TrainingRunRecord = {
    ...hydratedRun,
    checkpoint,
  };

  await saveTrainingRun(migratedRun);
  if (legacyArtifactSet.bundle) {
    await saveTrainingRunArtifacts(migratedRun, {
      model: {
        fileName: legacyArtifactSet.bundle.fileName,
        kind: "model",
        mimeType: legacyArtifactSet.bundle.mimeType,
        value: cloneArrayBuffer(legacyArtifactSet.bundle.value),
      },
    });
  }
  await deleteLegacyArtifactRecords(db, hydratedRun.id);

  return {
    ...hydratedRun,
    checkpoint,
  } satisfies TrainingRunRecord;
}

async function getLegacyArtifactSet(db: IDBPDatabase<TrainerDbSchema>, runId: string) {
  const runArtifacts = (await listStoredRunArtifacts(db, runId)) as Array<
    StoredRunArtifact & { kind: string }
  >;

  const bundle = runArtifacts.find((artifact) => String(artifact.kind) === "bundle");
  const modelState = runArtifacts.find((artifact) => String(artifact.kind) === "model_pt");
  const resumeState = runArtifacts.find((artifact) => String(artifact.kind) === "resume_pt");

  if (!modelState?.value || !resumeState?.value || (bundle && !bundle.value)) {
    return null;
  }
  const bundleArtifact = bundle?.value
    ? {
        fileName: bundle.fileName,
        kind: bundle.kind,
        mimeType: bundle.mimeType,
        value: cloneArrayBuffer(bundle.value),
      }
    : null;

  return {
    bundle: bundleArtifact,
    modelState: {
      fileName: modelState.fileName,
      kind: modelState.kind,
      mimeType: modelState.mimeType,
      value: cloneArrayBuffer(modelState.value),
    },
    resumeState: {
      fileName: resumeState.fileName,
      kind: resumeState.kind,
      mimeType: resumeState.mimeType,
      value: cloneArrayBuffer(resumeState.value),
    },
  };
}

async function deleteLegacyArtifactRecords(db: IDBPDatabase<TrainerDbSchema>, runId: string) {
  const transaction = db.transaction("artifacts", "readwrite");
  const artifacts = (await listStoredRunArtifacts(db, runId)) as Array<
    StoredRunArtifact & { kind: string }
  >;

  await Promise.all(
    artifacts
      .filter(
        (artifact) =>
          String(artifact.kind) === "bundle" ||
          String(artifact.kind) === "model_pt" ||
          String(artifact.kind) === "resume_pt",
      )
      .map((artifact) => transaction.store.delete(artifact.id)),
  );

  await transaction.done;
}

function artifactSetToList(artifactSet: RunArtifactSet) {
  return [artifactSet.model];
}

async function updateStoredWorkspaceFile(
  fileId: string,
  transform: (file: WorkspaceFile) => WorkspaceFile,
) {
  const db = await getTrainerDb();
  const file = await db.get("files", fileId);
  if (!file) {
    throw new Error(`Workspace file not found: ${fileId}`);
  }

  const updated = transform(file);
  await db.put("files", updated);
  return updated;
}

async function listStoredRunArtifacts(db: IDBPDatabase<TrainerDbSchema>, runId: string) {
  const artifactIds = [
    buildArtifactId(runId, "model"),
    `${runId}:bundle`,
    `${runId}:model_pt`,
    `${runId}:resume_pt`,
  ];
  const artifacts = await Promise.all(
    artifactIds.map((artifactId) => db.get("artifacts", artifactId)),
  );
  return artifacts.filter((artifact): artifact is StoredRunArtifact => Boolean(artifact));
}

async function persistStoredArtifact(runId: string, artifact: RunArtifactFile, updatedAt: number) {
  const opfsPath = await writeOpfsFile(runId, artifact);

  return {
    fileName: artifact.fileName,
    id: buildArtifactId(runId, artifact.kind),
    kind: artifact.kind,
    mimeType: artifact.mimeType,
    opfsPath: opfsPath ?? undefined,
    runId,
    sizeBytes: artifact.value.byteLength,
    storage: opfsPath ? "opfs" : "indexeddb",
    updatedAt,
    value: opfsPath ? undefined : cloneArrayBuffer(artifact.value),
  } satisfies StoredRunArtifact;
}

async function writeOpfsFile(runId: string, artifact: RunArtifactFile) {
  const root = await getOpfsRootDirectory();
  if (!root) {
    return null;
  }

  const exportsDir = await root.getDirectoryHandle("exports", { create: true });
  const runDir = await exportsDir.getDirectoryHandle(runId, { create: true });
  const fileHandle = await runDir.getFileHandle(artifact.fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(artifact.value);
  await writable.close();

  return `exports/${runId}/${artifact.fileName}`;
}

async function readOpfsFile(path: string) {
  const root = await getOpfsRootDirectory();
  if (!root) {
    return null;
  }

  const fileHandle = await getOpfsFileHandle(root, path);
  if (!fileHandle) {
    return null;
  }

  const file = await fileHandle.getFile();
  return await file.arrayBuffer();
}

async function deleteStoredArtifactFile(artifact: StoredRunArtifact) {
  if (artifact.storage !== "opfs" || !artifact.opfsPath) {
    return;
  }

  const root = await getOpfsRootDirectory();
  if (!root) {
    return;
  }

  const segments = artifact.opfsPath.split("/").filter(Boolean);
  if (segments.length === 0) {
    return;
  }

  const directories = segments.slice(0, -1);
  const fileName = segments[segments.length - 1];
  let directory: FileSystemDirectoryHandle = root;

  for (const segment of directories) {
    try {
      directory = await directory.getDirectoryHandle(segment);
    } catch {
      return;
    }
  }

  try {
    await directory.removeEntry(fileName);
  } catch {
    // Ignore already-deleted files.
  }
}

async function getOpfsFileHandle(root: FileSystemDirectoryHandle, path: string) {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  const directories = segments.slice(0, -1);
  const fileName = segments[segments.length - 1];
  let directory: FileSystemDirectoryHandle = root;

  for (const segment of directories) {
    try {
      directory = await directory.getDirectoryHandle(segment);
    } catch {
      return null;
    }
  }

  try {
    return await directory.getFileHandle(fileName);
  } catch {
    return null;
  }
}

async function getOpfsRootDirectory() {
  if (!("storage" in navigator)) {
    return null;
  }

  const storage = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>;
  };

  if (typeof storage.getDirectory !== "function") {
    return null;
  }

  try {
    return await storage.getDirectory();
  } catch {
    return null;
  }
}

function attachArtifactSummaries(
  run: TrainingRunRecord,
  storedArtifacts: StoredRunArtifact[],
): TrainingRunRecord {
  const summaries = Object.fromEntries(
    storedArtifacts.map((artifact) => [
      artifact.kind,
      {
        fileName: artifact.fileName,
        kind: artifact.kind,
        sizeBytes: artifact.sizeBytes,
        storage: artifact.storage,
        updatedAt: artifact.updatedAt,
      } satisfies ArtifactFileSummary,
    ]),
  );

  return {
    ...run,
    artifacts: {
      ...run.artifacts,
      ...summaries,
    },
  };
}

function cloneArtifactFile(artifact: RunArtifactFile | StoredRunArtifact) {
  if (!artifact.value) {
    throw new Error(`Artifact "${artifact.fileName}" is missing binary data.`);
  }

  return {
    fileName: artifact.fileName,
    kind: artifact.kind,
    mimeType: artifact.mimeType,
    storage: artifact.storage,
    value: cloneArrayBuffer(artifact.value),
  };
}

function stripCheckpoint(run: TrainingRunRecord): PersistedTrainingRunRecord {
  const { checkpoint: _checkpoint, ...persistedRun } = run;
  return persistedRun;
}

function createStoredTrainingCheckpoint(
  runId: string,
  checkpoint: NonNullable<TrainingRunRecord["checkpoint"]>,
): StoredTrainingCheckpoint {
  return {
    checkpoint,
    id: runId,
    storage: "indexeddb",
    updatedAt: Date.now(),
  };
}

function hydratePersistedRunShape(run: PersistedTrainingRunRecord) {
  return {
    ...run,
    telemetry: run.telemetry ?? [],
  } satisfies PersistedTrainingRunRecord;
}

function cloneCheckpoint(checkpoint: NonNullable<TrainingRunRecord["checkpoint"]>) {
  return {
    ...checkpoint,
    datasetData: new Int32Array(checkpoint.datasetData),
    modelConfig: { ...checkpoint.modelConfig },
    optimizerState: {
      firstMoments: checkpoint.optimizerState.firstMoments.map(cloneSerializedTensor),
      secondMoments: checkpoint.optimizerState.secondMoments.map(cloneSerializedTensor),
      step: checkpoint.optimizerState.step,
    },
    resumeState: { ...checkpoint.resumeState },
    sourceFilter: {
      ...checkpoint.sourceFilter,
      bits: new Uint8Array(checkpoint.sourceFilter.bits),
    },
    tokenizer: {
      ...checkpoint.tokenizer,
      idToChar: [...checkpoint.tokenizer.idToChar],
    },
    trainingConfig: {
      ...checkpoint.trainingConfig,
      model: { ...checkpoint.trainingConfig.model },
    },
    weights: checkpoint.weights.map(cloneSerializedTensor),
  };
}

function cloneSerializedTensor(
  tensor: NonNullable<TrainingRunRecord["checkpoint"]>["weights"][number],
) {
  return {
    ...tensor,
    shape: [...tensor.shape],
    values:
      tensor.values instanceof Float32Array
        ? new Float32Array(tensor.values)
        : new Int32Array(tensor.values),
  };
}

function cloneArrayBuffer(value: ArrayBuffer) {
  return value.slice(0);
}

function buildArtifactId(runId: string, kind: RunArtifactKind) {
  return `${runId}:${kind}`;
}

function normalizeTextFileName(name: string) {
  const trimmed = name.trim() || "dataset";
  return trimmed.toLowerCase().endsWith(".txt") ? trimmed : `${trimmed}.txt`;
}
