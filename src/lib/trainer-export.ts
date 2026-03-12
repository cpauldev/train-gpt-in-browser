import type { ModelDownloadFile } from "@/lib/trainer-types";

export function downloadModelFile(file: ModelDownloadFile) {
  triggerBrowserDownload(new Blob([file.value], { type: file.mimeType }), file.fileName);
  return file.fileName;
}

function triggerBrowserDownload(blob: Blob, fileName: string) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => {
    window.URL.revokeObjectURL(url);
  }, 1000);
}
