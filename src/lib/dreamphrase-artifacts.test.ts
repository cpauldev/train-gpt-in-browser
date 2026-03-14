import { describe, expect, it } from "vitest";

import { buildDreamPhraseArtifactSet } from "@/lib/dreamphrase-artifacts";
import { createCheckpointFixture } from "@/lib/trainer-test-fixtures";

describe("dreamphrase-artifacts", () => {
  it("builds a single `.model` compatibility export from a browser checkpoint", () => {
    const checkpoint = createCheckpointFixture();
    const artifactSet = buildDreamPhraseArtifactSet(checkpoint, "Fixture Run");

    expect(artifactSet.model.fileName).toBe("fixture-run.model");
    expect(artifactSet.model.kind).toBe("model");
    expect(artifactSet.model.value.byteLength).toBeGreaterThan(0);
  });
});
