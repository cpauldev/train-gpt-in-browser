import { describe, expect, it } from "vitest";
import {
  isSupportedWorkspaceImportFile,
  partitionWorkspaceImportFiles,
  summarizeRejectedWorkspaceImports,
} from "@/lib/workspace-imports";

describe("workspace imports", () => {
  it("accepts plain-text files by extension or mime type", () => {
    expect(isSupportedWorkspaceImportFile({ name: "notes.txt", type: "" })).toBe(true);
    expect(isSupportedWorkspaceImportFile({ name: "dataset", type: "text/plain" })).toBe(true);
    expect(isSupportedWorkspaceImportFile({ name: "draft.TXT", type: "" })).toBe(true);
  });

  it("rejects non-text files", () => {
    expect(isSupportedWorkspaceImportFile({ name: "notes.md", type: "text/markdown" })).toBe(false);
    expect(isSupportedWorkspaceImportFile({ name: "archive.zip", type: "application/zip" })).toBe(
      false,
    );
  });

  it("partitions mixed selections and summarizes rejected names", () => {
    const { accepted, rejected } = partitionWorkspaceImportFiles([
      { name: "alpha.txt", type: "" },
      { name: "beta.pdf", type: "application/pdf" },
      {
        name: "gamma.docx",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
      { name: "delta.csv", type: "text/csv" },
      { name: "epsilon.png", type: "image/png" },
    ]);

    expect(accepted.map((file) => file.name)).toEqual(["alpha.txt"]);
    expect(rejected.map((file) => file.name)).toEqual([
      "beta.pdf",
      "gamma.docx",
      "delta.csv",
      "epsilon.png",
    ]);
    expect(summarizeRejectedWorkspaceImports(rejected)).toBe(
      "Only plain-text files (.txt) can be imported. Skipped beta.pdf, gamma.docx, delta.csv and 1 more.",
    );
  });
});
