import type { RunArtifactSet, SerializedCheckpoint } from "@/lib/trainer-types";
import { sanitizeArtifactStem } from "@/lib/transformer-artifact-shared";
import { buildModelFile } from "@/lib/transformer-bundle";

export function buildArtifactSet(
  checkpoint: SerializedCheckpoint,
  runName: string,
): RunArtifactSet {
  const fileStem = sanitizeArtifactStem(runName);

  return {
    model: {
      ...buildModelFile(checkpoint, runName, `${fileStem}.browser-checkpoint`),
      kind: "model",
    },
  };
}
