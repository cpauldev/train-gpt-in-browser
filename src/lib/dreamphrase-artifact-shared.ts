export function sanitizeDreamPhraseArtifactStem(value: string) {
  return (
    value
      .trim()
      .replace(/[^a-z0-9._-]+/giu, "-")
      .replace(/^-+|-+$/gu, "")
      .toLowerCase() || "dreamphrasegpt"
  );
}

export function isoTimestampSeconds(value = Date.now()) {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/u, "Z");
}
