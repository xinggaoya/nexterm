import { describe, expect, it } from "vitest";
import { buildSourceControlEntries, getPrimaryDiffMode } from "./sourceControlModel";
import type { GitChangedFile } from "@/modules/ai/lib/native";

const files: GitChangedFile[] = [
  {
    path: "src/main.ts",
    originalPath: null,
    indexStatus: "M",
    worktreeStatus: " ",
    staged: true,
    unstaged: false,
    untracked: false,
    statusLabel: "Modified",
  },
  {
    path: "src/app.vue",
    originalPath: null,
    indexStatus: " ",
    worktreeStatus: "M",
    staged: false,
    unstaged: true,
    untracked: false,
    statusLabel: "Modified",
  },
  {
    path: "src/new.ts",
    originalPath: null,
    indexStatus: " ",
    worktreeStatus: "?",
    staged: false,
    unstaged: true,
    untracked: true,
    statusLabel: "Untracked",
  },
];

describe("source control model", () => {
  it("builds flat file entries with stage state and normalized status", () => {
    const entries = buildSourceControlEntries(files);

    expect(entries).toEqual([
      expect.objectContaining({
        path: "src/main.ts",
        checkState: "checked",
        statusCode: "M",
        staged: true,
      }),
      expect.objectContaining({
        path: "src/app.vue",
        checkState: "unchecked",
        statusCode: "M",
        unstaged: true,
      }),
      expect.objectContaining({
        path: "src/new.ts",
        checkState: "unchecked",
        statusCode: "U",
        untracked: true,
      }),
    ]);
  });

  it("chooses staged diff mode before working-tree diff mode", () => {
    const entries = buildSourceControlEntries(files);

    expect(getPrimaryDiffMode(entries[0])).toBe("+");
    expect(getPrimaryDiffMode(entries[1])).toBe("-");
  });
});
