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
        path: "src/main.ts",
        checkState: "checked",
        statusCode: "M",
        group: "modified",
        staged: true,
      }),
      expect.objectContaining({
        path: "src/app.vue",
        checkState: "unchecked",
        statusCode: "M",
        group: "modified",
        unstaged: true,
      }),
      expect.objectContaining({
        path: "src/new.ts",
        checkState: "unchecked",
        statusCode: "U",
        group: "added",
        untracked: true,
      }),
    ]);
  });

  it("groups entries by git change category in display order", () => {
    const entries = buildSourceControlEntries([
      {
        path: "src/delete.ts",
        originalPath: null,
        indexStatus: " ",
        worktreeStatus: "D",
        staged: false,
        unstaged: true,
        untracked: false,
        statusLabel: "Deleted",
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
      {
        path: "src/rename.ts",
        originalPath: "src/old.ts",
        indexStatus: "R",
        worktreeStatus: " ",
        staged: true,
        unstaged: false,
        untracked: false,
        statusLabel: "Renamed",
      },
      {
        path: "src/main.ts",
        originalPath: null,
        indexStatus: " ",
        worktreeStatus: "M",
        staged: false,
        unstaged: true,
        untracked: false,
        statusLabel: "Modified",
      },
    ]);

    expect(
      groupSourceControlEntries(entries).map((group) => ({
        key: group.key,
        paths: group.entries.map((entry) => entry.path),
      })),
    ).toEqual([
      { key: "modified", paths: ["src/main.ts"] },
      { key: "added", paths: ["src/new.ts"] },
      { key: "deleted", paths: ["src/delete.ts"] },
      { key: "renamed", paths: ["src/rename.ts"] },
    ]);
  });

  it("chooses staged diff mode before working-tree diff mode", () => {
    const entries = buildSourceControlEntries(files);

    expect(getPrimaryDiffMode(entries[0])).toBe("+");
    expect(getPrimaryDiffMode(entries[1])).toBe("-");
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
