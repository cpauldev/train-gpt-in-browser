const TEXT_FILE_EXTENSION = ".txt";
const TEXT_FILE_MIME = "text/plain";
const REJECTED_FILE_PREVIEW_LIMIT = 3;

type WorkspaceImportCandidate = Pick<File, "name" | "type">;

export function isSupportedWorkspaceImportFile(file: WorkspaceImportCandidate) {
  const normalizedName = file.name.trim().toLowerCase();
  const normalizedType = file.type.trim().toLowerCase();

  return (
    normalizedName.endsWith(TEXT_FILE_EXTENSION) ||
    normalizedType === TEXT_FILE_MIME ||
    normalizedType.startsWith(`${TEXT_FILE_MIME};`)
  );
}

export function partitionWorkspaceImportFiles<T extends WorkspaceImportCandidate>(
  files: readonly T[],
) {
  const accepted: T[] = [];
  const rejected: T[] = [];

  for (const file of files) {
    if (isSupportedWorkspaceImportFile(file)) {
      accepted.push(file);
      continue;
    }
    rejected.push(file);
  }

  return { accepted, rejected };
}

export function summarizeRejectedWorkspaceImports(files: readonly WorkspaceImportCandidate[]) {
  if (files.length === 0) {
    return null;
  }

  const preview = files.slice(0, REJECTED_FILE_PREVIEW_LIMIT).map((file) => file.name);
  const remainingCount = files.length - preview.length;
  const previewText = preview.join(", ");
  const remainingText = remainingCount > 0 ? ` and ${remainingCount} more` : "";

  return `Only plain-text files (.txt) can be imported. Skipped ${previewText}${remainingText}.`;
}
