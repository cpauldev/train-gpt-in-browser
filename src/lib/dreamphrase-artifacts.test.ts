import { describe, expect, it } from "vitest";

import { buildDreamPhraseArtifactSet, getRunArtifactFile } from "@/lib/dreamphrase-artifacts";
import { createCheckpointFixture } from "@/lib/trainer-test-fixtures";

describe("dreamphrase-artifacts", () => {
  it("builds a single `.model` compatibility export from a browser checkpoint", () => {
    const checkpoint = createCheckpointFixture();
    const artifactSet = buildDreamPhraseArtifactSet(checkpoint, "Fixture Run");
    const artifact = getRunArtifactFile(artifactSet, "model");

    expect(artifactSet.model.fileName).toBe("fixture-run.model");
    expect(artifact.kind).toBe("model");
    expect(artifact.value.byteLength).toBeGreaterThan(0);
  });
});
