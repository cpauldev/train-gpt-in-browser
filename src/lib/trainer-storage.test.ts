import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDreamPhraseArtifactSet } from "@/lib/dreamphrase-artifacts";
import { DEFAULT_TRAINING_CONFIG } from "@/lib/trainer-defaults";
import {
  createWorkspaceFile,
  deleteTrainingRun,
  getActiveFileId,
  getActiveRunId,
  getTrainingRunArtifact,
  listTrainingRuns,
  listWorkspaceFiles,
  renameWorkspaceFile,
  resetTrainerStorage,
  saveTrainingCheckpoint,
  saveTrainingRun,
  saveTrainingRunArtifacts,
  seedBuiltinWorkspaceFiles,
  setActiveFileId,
  setActiveRunId,
  updateWorkspaceFileContent,
  upsertImportedWorkspaceFile,
} from "@/lib/trainer-storage";
import { createCheckpointFixture } from "@/lib/trainer-test-fixtures";
import type { TrainingRunRecord } from "@/lib/trainer-types";

describe("trainer-storage", () => {
  beforeEach(async () => {
    await resetTrainerStorage();

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const value = String(input);
        const body = value.includes("english_words") ? "alpha\nbeta\n" : "olivia\nliam\n";

        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: {
              "Content-Type": "text/plain;charset=utf-8",
            },
          }),
        );
      }),
    );
  });

  it("seeds the built-in datasets exactly once", async () => {
    await seedBuiltinWorkspaceFiles();
    await seedBuiltinWorkspaceFiles();

    const files = await listWorkspaceFiles();

    expect(files).toHaveLength(2);
    expect(files.map((file) => file.builtInKey)).toEqual(["english_words", "us_baby_names"]);
  });

  it("creates and updates local files", async () => {
    const file = await createWorkspaceFile("ideas", "alpha");
    const updated = await updateWorkspaceFileContent(file.id, "alpha\nbeta");

    expect(updated.name).toBe("ideas.txt");
    expect(updated.content).toBe("alpha\nbeta");
  });

  it("keeps user file names unique across create and rename operations", async () => {
    const first = await createWorkspaceFile("ideas", "alpha");
    const second = await createWorkspaceFile("ideas.txt", "beta");
    const renamed = await renameWorkspaceFile(second.id, first.name);

    expect(first.name).toBe("ideas.txt");
    expect(second.name).toBe("ideas-2.txt");
    expect(renamed.name).toBe("ideas-2.txt");
  });

  it("reuses an imported local file when the normalized name already exists", async () => {
    const created = await upsertImportedWorkspaceFile("notes", "alpha");
    const updated = await upsertImportedWorkspaceFile("notes.txt", "beta");
    const files = await listWorkspaceFiles();

    expect(updated.id).toBe(created.id);
    expect(updated.content).toBe("beta");
    expect(files.filter((file) => file.source === "user")).toHaveLength(1);
  });

  it("persists active file and run selections", async () => {
    await setActiveFileId("file-1");
    await setActiveRunId("run-1");

    expect(await getActiveFileId()).toBe("file-1");
    expect(await getActiveRunId()).toBe("run-1");
  });

  it("saves and deletes training runs", async () => {
    const run: TrainingRunRecord = {
      createdAt: 1,
      datasetStats: {
        characterCount: 11,
        documentCount: 2,
        lineCount: 2,
        tokenCount: 13,
        vocabSize: 7,
      },
      fileId: "file-1",
      fileName: "ideas.txt",
      generatedResults: {},
      id: "run-1",
      likes: [],
      logs: [],
      name: "ideas",
      status: "completed",
      telemetry: [],
      trainingConfig: DEFAULT_TRAINING_CONFIG,
      updatedAt: 2,
    };

    await saveTrainingRun(run);
    expect(await listTrainingRuns()).toHaveLength(1);

    await deleteTrainingRun(run.id);
    expect(await listTrainingRuns()).toEqual([]);
  });

  it("restores browser checkpoints and caches `.model` exports separately", async () => {
    const checkpoint = createCheckpointFixture();
    const run: TrainingRunRecord = {
      artifacts: undefined,
      checkpoint,
      createdAt: 1,
      datasetStats: checkpoint.datasetStats,
      fileId: checkpoint.fileId,
      fileName: checkpoint.fileName,
      generatedResults: {},
      id: "run-artifacts",
      likes: [],
      logs: [],
      name: "fixture-run",
      status: "completed",
      telemetry: [],
      trainingConfig: checkpoint.trainingConfig,
      updatedAt: 2,
    };

    await saveTrainingRun(run);
    await saveTrainingRunArtifacts(run, buildDreamPhraseArtifactSet(checkpoint, run.name));

    const [restoredRun] = await listTrainingRuns();
    const modelArtifact = await getTrainingRunArtifact(run.id, "model");

    expect(restoredRun?.checkpoint?.fileName).toBe(checkpoint.fileName);
    expect(restoredRun?.checkpoint?.resumeState.completedSteps).toBe(
      checkpoint.resumeState.completedSteps,
    );
    expect(modelArtifact?.fileName).toBe("fixture-run.model");
  });

  it("hydrates a separately persisted checkpoint onto an existing run", async () => {
    const checkpoint = createCheckpointFixture();
    const run: TrainingRunRecord = {
      createdAt: 1,
      datasetStats: checkpoint.datasetStats,
      fileId: checkpoint.fileId,
      fileName: checkpoint.fileName,
      generatedResults: {},
      id: "run-separate-checkpoint",
      likes: [],
      logs: [],
      name: "fixture-run",
      status: "training",
      telemetry: [],
      trainingConfig: checkpoint.trainingConfig,
      updatedAt: 2,
    };

    await saveTrainingRun(run, { persistCheckpoint: false });
    await saveTrainingCheckpoint(run.id, checkpoint);

    const [restoredRun] = await listTrainingRuns();

    expect(restoredRun?.checkpoint?.fileName).toBe(checkpoint.fileName);
    expect(restoredRun?.checkpoint?.resumeState.completedSteps).toBe(
      checkpoint.resumeState.completedSteps,
    );
  });
});
