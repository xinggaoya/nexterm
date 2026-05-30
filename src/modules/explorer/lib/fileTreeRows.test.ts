import { describe, expect, it } from "vitest";
import {
  buildFileTreeRows,
  buildGitToneIndex,
  type FileTreeState,
} from "./fileTreeRows";

describe("file tree rows", () => {
  it("builds visible rows for expanded folders and state rows", () => {
    const nodes: FileTreeState = {
      "/repo": {
        status: "loaded",
        entries: [
          { name: "src", kind: "dir", size: 0, mtime: 1 },
          { name: "README.md", kind: "file", size: 10, mtime: 2 },
        ],
      },
      "/repo/src": {
        status: "loaded",
        entries: [
          { name: "main.ts", kind: "file", size: 100, mtime: 3 },
          { name: "broken", kind: "dir", size: 0, mtime: 4 },
        ],
      },
      "/repo/src/broken": {
        status: "error",
        message: "permission denied",
      },
    };

    const { rows, entryIndexByPath } = buildFileTreeRows({
      rootPath: "/repo",
      nodes,
      expanded: new Set(["/repo/src", "/repo/src/broken"]),
      pendingCreate: { parentPath: "/repo/src", kind: "file" },
      renaming: "/repo/README.md",
    });

    expect(rows).toEqual([
      {
        kind: "entry",
        key: "/repo/src",
        path: "/repo/src",
        name: "src",
        isDir: true,
        isExpanded: true,
        depth: 0,
        gitTone: null,
      },
      {
        kind: "pending",
        key: "pending:/repo/src",
        depth: 1,
        pendingKind: "file",
      },
      {
        kind: "entry",
        key: "/repo/src/main.ts",
        path: "/repo/src/main.ts",
        name: "main.ts",
        isDir: false,
        isExpanded: false,
        depth: 1,
        gitTone: null,
      },
      {
        kind: "entry",
        key: "/repo/src/broken",
        path: "/repo/src/broken",
        name: "broken",
        isDir: true,
        isExpanded: true,
        depth: 1,
        gitTone: null,
      },
      {
        kind: "status",
        key: "error:/repo/src/broken",
        depth: 2,
        tone: "error",
        message: "permission denied",
      },
      {
        kind: "rename",
        key: "rename:/repo/README.md",
        path: "/repo/README.md",
        name: "README.md",
        isDir: false,
        depth: 0,
        gitTone: null,
      },
    ]);
    expect(entryIndexByPath.get("/repo/src")).toBe(0);
    expect(entryIndexByPath.has("/repo/README.md")).toBe(false);
  });

  it("renders loading state for expanded folders", () => {
    const { rows } = buildFileTreeRows({
      rootPath: "/repo",
      nodes: {
        "/repo": {
          status: "loaded",
          entries: [{ name: "src", kind: "dir", size: 0, mtime: 1 }],
        },
        "/repo/src": { status: "loading" },
      },
      expanded: new Set(["/repo/src"]),
      pendingCreate: null,
      renaming: null,
    });

    expect(rows[1]).toEqual({
      kind: "status",
      key: "loading:/repo/src",
      depth: 1,
      tone: "muted",
      message: "Loading...",
    });
  });

  it("indexes git tones for files and parent folders", () => {
    const index = buildGitToneIndex("/repo", [
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
    ]);

    expect(index.get("/repo/src/main.ts")).toBe("modified");
    expect(index.get("/repo/src/new.ts")).toBe("added");
    expect(index.get("/repo/src")).toBe("added");
  });

  it("adds git tones to visible rows", () => {
    const { rows } = buildFileTreeRows({
      rootPath: "/repo",
      nodes: {
        "/repo": {
          status: "loaded",
          entries: [{ name: "src", kind: "dir", size: 0, mtime: 1 }],
        },
        "/repo/src": {
          status: "loaded",
          entries: [{ name: "main.ts", kind: "file", size: 100, mtime: 2 }],
        },
      },
      expanded: new Set(["/repo/src"]),
      pendingCreate: null,
      renaming: null,
      gitChangedFiles: [
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
      ],
    });

    expect(rows[0]).toMatchObject({ path: "/repo/src", gitTone: "modified" });
    expect(rows[1]).toMatchObject({
      path: "/repo/src/main.ts",
      gitTone: "modified",
    });
  });
});
