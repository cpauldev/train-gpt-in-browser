import { describe, expect, it } from "vitest";
import { createCheckpointFixture } from "@/lib/trainer-test-fixtures";
import { buildArtifactSet } from "@/lib/transformer-artifacts";

describe("transformer-artifacts", () => {
  it("builds a single `.model` compatibility export from a browser checkpoint", () => {
    const checkpoint = createCheckpointFixture();
    const artifactSet = buildArtifactSet(checkpoint, "Fixture Run");

    expect(artifactSet.model.fileName).toBe("fixture-run.model");
    expect(artifactSet.model.kind).toBe("model");
    expect(artifactSet.model.value.byteLength).toBeGreaterThan(0);
  });
});
