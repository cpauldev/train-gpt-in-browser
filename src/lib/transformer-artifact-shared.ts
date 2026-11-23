export function sanitizeArtifactStem(value: string) {
  return (
    value
      .trim()
      .replace(/[^a-z0-9._-]+/giu, "-")
      .replace(/^-+|-+$/gu, "")
      .toLowerCase() || "character_level_transformer"
  );
}

export function isoTimestampSeconds(value = Date.now()) {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/u, "Z");
}
