import { sanitizeDreamPhraseArtifactStem } from "@/lib/dreamphrase-artifact-shared";
import { buildDreamPhraseModelFile } from "@/lib/dreamphrase-bundle";
import type { RunArtifactSet, SerializedCheckpoint } from "@/lib/trainer-types";

export function buildDreamPhraseArtifactSet(
  checkpoint: SerializedCheckpoint,
  runName: string,
): RunArtifactSet {
  const fileStem = sanitizeDreamPhraseArtifactStem(runName);

  return {
    model: {
      ...buildDreamPhraseModelFile(checkpoint, runName, `${fileStem}.browser-checkpoint`),
      kind: "model",
    },
  };
}
