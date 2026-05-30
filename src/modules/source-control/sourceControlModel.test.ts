import { describe, expect, it } from "vitest";
import {
  buildSourceControlEntries,
  discardEntriesForEntries,
  getPrimaryDiffMode,
  groupSourceControlEntries,
  pathsToStage,
  pathsToUnstage,
} from "./sourceControlModel";
import type { GitChangedFile } from "@/lib/native";

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
        key: "staged:src/main.ts",
        group: "staged",
        path: "src/main.ts",
        checkState: "checked",
        statusCode: "M",
        statusKind: "modified",
        staged: true,
      }),
      expect.objectContaining({
        key: "changes:src/app.vue",
        group: "changes",
        path: "src/app.vue",
        checkState: "unchecked",
        statusCode: "M",
        statusKind: "modified",
        unstaged: true,
      }),
      expect.objectContaining({
        key: "changes:src/new.ts",
        group: "changes",
        path: "src/new.ts",
        checkState: "unchecked",
        statusCode: "U",
        statusKind: "untracked",
        untracked: true,
      }),
    ]);
  });

  it("chooses staged diff mode before working-tree diff mode", () => {
    const entries = buildSourceControlEntries(files);

    expect(getPrimaryDiffMode(entries[0])).toBe("+");
    expect(getPrimaryDiffMode(entries[1])).toBe("-");
  });

  it("groups staged and unstaged entries by source-control section", () => {
    const entries = buildSourceControlEntries([
      ...files,
      {
        path: "src/mixed.ts",
        originalPath: null,
        indexStatus: "M",
        worktreeStatus: "M",
        staged: true,
        unstaged: true,
        untracked: false,
        statusLabel: "Modified",
      },
    ]);

    const groups = groupSourceControlEntries(entries);

    expect(groups.map((group) => group.id)).toEqual(["staged", "changes"]);
    expect(groups[0].entries.map((entry) => entry.key)).toEqual([
      "staged:src/main.ts",
      "staged:src/mixed.ts",
    ]);
    expect(groups[1].entries.map((entry) => entry.key)).toEqual([
      "changes:src/app.vue",
      "changes:src/mixed.ts",
      "changes:src/new.ts",
    ]);
  });

  it("selects eligible paths for bulk stage, unstage, and discard", () => {
    const entries = buildSourceControlEntries([
      ...files,
      {
        path: "src/mixed.ts",
        originalPath: null,
        indexStatus: "M",
        worktreeStatus: "M",
        staged: true,
        unstaged: true,
        untracked: false,
        statusLabel: "Modified",
      },
    ]);

    expect(pathsToStage(entries)).toEqual([
      "src/app.vue",
      "src/new.ts",
      "src/mixed.ts",
    ]);
    expect(pathsToUnstage(entries)).toEqual(["src/main.ts", "src/mixed.ts"]);
    expect(discardEntriesForEntries(entries)).toEqual([
      { path: "src/app.vue", untracked: false },
      { path: "src/new.ts", untracked: true },
      { path: "src/mixed.ts", untracked: false },
    ]);
  });
});
