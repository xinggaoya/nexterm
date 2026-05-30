import { describe, expect, it } from "vitest";
import { buildGitDecorationMap } from "./gitDecorations";
import type { GitChangedFile } from "@/lib/native";

function file(path: string, overrides: Partial<GitChangedFile>): GitChangedFile {
  return {
    path,
    originalPath: null,
    indexStatus: " ",
    worktreeStatus: "M",
    staged: false,
    unstaged: true,
    untracked: false,
    statusLabel: "Modified",
    ...overrides,
  };
}

describe("git decorations", () => {
  it("builds file and ancestor decorations from git status files", () => {
    const map = buildGitDecorationMap("/repo", [
      file("src/main.ts", { worktreeStatus: "M" }),
      file("src/deleted.ts", { worktreeStatus: "D" }),
      file("README.md", {
        worktreeStatus: "?",
        untracked: true,
        statusLabel: "Untracked",
      }),
    ]);

    expect(map.get("/repo/src/main.ts")).toMatchObject({
      statusKind: "modified",
      hasDescendantChanges: false,
      count: 1,
    });
    expect(map.get("/repo/src/deleted.ts")).toMatchObject({
      statusKind: "deleted",
      hasDescendantChanges: false,
    });
    expect(map.get("/repo/README.md")).toMatchObject({
      statusKind: "untracked",
      hasDescendantChanges: false,
    });
    expect(map.get("/repo/src")).toMatchObject({
      statusKind: "deleted",
      hasDescendantChanges: true,
      count: 2,
    });
  });
});
