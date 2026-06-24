import { describe, expect, it } from "vitest";
import {
  buildFileTreeRows,
  updateFileTreeRows,
  type FileTreeState,
} from "./fileTreeRows";
function makeTreeNodes(): FileTreeState {
  return {
    "/repo": {
      status: "loaded",
      entries: [
        { name: "src", kind: "dir", size: 0, mtime: 1 },
        { name: "README.md", kind: "file", size: 10, mtime: 2 },
        { name: "package.json", kind: "file", size: 20, mtime: 3 },
      ],
    },
    "/repo/src": {
      status: "loaded",
      entries: [
        { name: "main.ts", kind: "file", size: 100, mtime: 4 },
        { name: "utils.ts", kind: "file", size: 50, mtime: 5 },
      ],
    },
  };
}

function makeExpanded(): Set<string> {
  return new Set(["/repo/src"]);
}

function makeParams(nodes: FileTreeState, expanded: Set<string>) {
  return {
    nodes,
    expanded,
    pendingCreate: null as never,
    renaming: null as never,
    gitDecorations: undefined as never,
  };
}

describe("updateFileTreeRows", () => {
  it("returns the same snapshot when changedPaths is empty", () => {
    const nodes = makeTreeNodes();
    const expanded = makeExpanded();
    const prev = buildFileTreeRows({
      rootPath: "/repo",
      nodes,
      expanded,
      ...{ pendingCreate: null, renaming: null },
    });

    const result = updateFileTreeRows(prev, [], makeParams(nodes, expanded));
    expect(result).toBe(prev);
  });

  it("returns the same snapshot when changed path is not visible", () => {
    const nodes = makeTreeNodes();
    const expanded = makeExpanded();
    const prev = buildFileTreeRows({
      rootPath: "/repo",
      nodes,
      expanded,
      ...{ pendingCreate: null, renaming: null },
    });

    // /repo/src is expanded and visible, but /repo/dist is not in the tree
    const result = updateFileTreeRows(prev, ["/repo/dist"], makeParams(nodes, expanded));
    expect(result).toBe(prev);
  });

  it("returns the same snapshot when changed directory is collapsed", () => {
    const nodes = makeTreeNodes();
    const expanded = new Set<string>(); // nothing expanded
    const prev = buildFileTreeRows({
      rootPath: "/repo",
      nodes,
      expanded,
      ...{ pendingCreate: null, renaming: null },
    });

    const result = updateFileTreeRows(prev, ["/repo/src"], makeParams(nodes, expanded));
    expect(result).toBe(prev);
  });

  it("incrementally updates a single changed directory", () => {
    const nodes = makeTreeNodes();
    const expanded = makeExpanded();
    const prev = buildFileTreeRows({
      rootPath: "/repo",
      nodes,
      expanded,
      ...{ pendingCreate: null, renaming: null },
    });

    // Simulate /repo/src gaining a new file
    const updatedNodes: FileTreeState = {
      ...nodes,
      "/repo/src": {
        status: "loaded",
        entries: [
          { name: "main.ts", kind: "file", size: 100, mtime: 4 },
          { name: "utils.ts", kind: "file", size: 50, mtime: 5 },
          { name: "new-file.ts", kind: "file", size: 30, mtime: 6 },
        ],
      },
    };

    const result = updateFileTreeRows(
      prev,
      ["/repo/src"],
      makeParams(updatedNodes, expanded),
    );

    // Should not be the same reference
    expect(result).not.toBe(prev);
    expect(result.rows).toHaveLength(prev.rows.length + 1);

    // The new file should appear in the rows
    const paths = result.rows
      .filter((r) => r.kind === "entry")
      .map((r) => r.path);
    expect(paths).toContain("/repo/src/new-file.ts");

    // Other entries should remain
    expect(paths).toContain("/repo/src");
    expect(paths).toContain("/repo/README.md");
    expect(paths).toContain("/repo/package.json");

    // entryIndexByPath should be correct
    expect(result.entryIndexByPath.get("/repo/src/new-file.ts")).toBeDefined();
    // README.md shifted by +1 because a file was added before it
    expect(result.entryIndexByPath.get("/repo/README.md")).toBe(
      (prev.entryIndexByPath.get("/repo/README.md") ?? 0) + 1,
    );
  });

  it("incrementally updates when a file is removed", () => {
    const nodes = makeTreeNodes();
    const expanded = makeExpanded();
    const prev = buildFileTreeRows({
      rootPath: "/repo",
      nodes,
      expanded,
      ...{ pendingCreate: null, renaming: null },
    });

    // Remove utils.ts
    const updatedNodes: FileTreeState = {
      ...nodes,
      "/repo/src": {
        status: "loaded",
        entries: [{ name: "main.ts", kind: "file", size: 100, mtime: 4 }],
      },
    };

    const result = updateFileTreeRows(
      prev,
      ["/repo/src"],
      makeParams(updatedNodes, expanded),
    );

    expect(result).not.toBe(prev);
    expect(result.rows).toHaveLength(prev.rows.length - 1);

    const paths = result.rows
      .filter((r) => r.kind === "entry")
      .map((r) => r.path);
    expect(paths).not.toContain("/repo/src/utils.ts");
    expect(paths).toContain("/repo/src/main.ts");
  });

  it("matches full rebuild result for equivalent state", () => {
    const nodes = makeTreeNodes();
    const expanded = makeExpanded();
    const prev = buildFileTreeRows({
      rootPath: "/repo",
      nodes,
      expanded,
      ...{ pendingCreate: null, renaming: null },
    });

    // Add a file and rename one
    const updatedNodes: FileTreeState = {
      ...nodes,
      "/repo/src": {
        status: "loaded",
        entries: [
          { name: "main.ts", kind: "file", size: 100, mtime: 4 },
          { name: "helpers.ts", kind: "file", size: 50, mtime: 5 },
          { name: "new-file.ts", kind: "file", size: 30, mtime: 6 },
        ],
      },
    };

    const incremental = updateFileTreeRows(
      prev,
      ["/repo/src"],
      makeParams(updatedNodes, expanded),
    );

    const fullRebuild = buildFileTreeRows({
      rootPath: "/repo",
      nodes: updatedNodes,
      expanded,
      pendingCreate: null,
      renaming: null,
    });

    // They should produce the same rows (except for object identity)
    expect(incremental.rows).toEqual(fullRebuild.rows);
    // entryIndexByPath should match
    expect(Object.fromEntries(incremental.entryIndexByPath)).toEqual(
      Object.fromEntries(fullRebuild.entryIndexByPath),
    );
  });

  it("handles deeply nested expanded directories", () => {
    const nodes: FileTreeState = {
      "/repo": {
        status: "loaded",
        entries: [{ name: "a", kind: "dir", size: 0, mtime: 1 }],
      },
      "/repo/a": {
        status: "loaded",
        entries: [{ name: "b", kind: "dir", size: 0, mtime: 2 }],
      },
      "/repo/a/b": {
        status: "loaded",
        entries: [{ name: "c.txt", kind: "file", size: 10, mtime: 3 }],
      },
    };
    const expanded = new Set(["/repo/a", "/repo/a/b"]);

    const prev = buildFileTreeRows({
      rootPath: "/repo",
      nodes,
      expanded,
      ...{ pendingCreate: null, renaming: null },
    });

    // Update /repo/a (parent of nested expansion)
    const updatedNodes: FileTreeState = {
      ...nodes,
      "/repo/a": {
        status: "loaded",
        entries: [
          { name: "b", kind: "dir", size: 0, mtime: 2 },
          { name: "new.txt", kind: "file", size: 5, mtime: 4 },
        ],
      },
    };

    const result = updateFileTreeRows(
      prev,
      ["/repo/a"],
      makeParams(updatedNodes, expanded),
    );

    const fullRebuild = buildFileTreeRows({
      rootPath: "/repo",
      nodes: updatedNodes,
      expanded,
      pendingCreate: null,
      renaming: null,
    });

    expect(result.rows).toEqual(fullRebuild.rows);
    expect(Object.fromEntries(result.entryIndexByPath)).toEqual(
      Object.fromEntries(fullRebuild.entryIndexByPath),
    );
  });

  it("handles multiple changed paths in one call", () => {
    const nodes: FileTreeState = {
      "/repo": {
        status: "loaded",
        entries: [
          { name: "src", kind: "dir", size: 0, mtime: 1 },
          { name: "lib", kind: "dir", size: 0, mtime: 2 },
        ],
      },
      "/repo/src": {
        status: "loaded",
        entries: [{ name: "a.ts", kind: "file", size: 10, mtime: 3 }],
      },
      "/repo/lib": {
        status: "loaded",
        entries: [{ name: "b.ts", kind: "file", size: 20, mtime: 4 }],
      },
    };
    const expanded = new Set(["/repo/src", "/repo/lib"]);

    const prev = buildFileTreeRows({
      rootPath: "/repo",
      nodes,
      expanded,
      ...{ pendingCreate: null, renaming: null },
    });

    // Update both src and lib
    const updatedNodes: FileTreeState = {
      ...nodes,
      "/repo/src": {
        status: "loaded",
        entries: [
          { name: "a.ts", kind: "file", size: 10, mtime: 3 },
          { name: "a2.ts", kind: "file", size: 15, mtime: 5 },
        ],
      },
      "/repo/lib": {
        status: "loaded",
        entries: [
          { name: "b.ts", kind: "file", size: 20, mtime: 4 },
          { name: "b2.ts", kind: "file", size: 25, mtime: 6 },
        ],
      },
    };

    const result = updateFileTreeRows(
      prev,
      ["/repo/src", "/repo/lib"],
      makeParams(updatedNodes, expanded),
    );

    const fullRebuild = buildFileTreeRows({
      rootPath: "/repo",
      nodes: updatedNodes,
      expanded,
      pendingCreate: null,
      renaming: null,
    });

    expect(result.rows).toEqual(fullRebuild.rows);
    expect(Object.fromEntries(result.entryIndexByPath)).toEqual(
      Object.fromEntries(fullRebuild.entryIndexByPath),
    );
  });

  it("preserves git decorations in incremental update", () => {
    const nodes = makeTreeNodes();
    const expanded = makeExpanded();
    const gitDecorations = new Map([
      [
        "/repo/src/main.ts",
        {
          statusKind: "modified" as const,
          staged: false,
          unstaged: true,
          hasDescendantChanges: false,
          count: 1,
        },
      ],
    ]);

    const prev = buildFileTreeRows({
      rootPath: "/repo",
      nodes,
      expanded,
      pendingCreate: null,
      renaming: null,
      gitDecorations,
    });

    const updatedNodes: FileTreeState = {
      ...nodes,
      "/repo/src": {
        status: "loaded",
        entries: [
          { name: "main.ts", kind: "file", size: 100, mtime: 4 },
          { name: "utils.ts", kind: "file", size: 50, mtime: 5 },
          { name: "new.ts", kind: "file", size: 30, mtime: 6 },
        ],
      },
    };

    const result = updateFileTreeRows(prev, ["/repo/src"], {
      nodes: updatedNodes,
      expanded,
      pendingCreate: null,
      renaming: null,
      gitDecorations,
    });

    const mainRow = result.rows.find(
      (r) => r.kind === "entry" && r.path === "/repo/src/main.ts",
    );
    expect(mainRow?.kind === "entry" && mainRow.gitDecoration?.statusKind).toBe("modified");
  });

  it("matches a full rebuild on a large deeply-expanded tree", () => {
    // Build a synthetic tree with a wide-but-shallow structure so the
    // patch path actually has to walk the full visibleDirectoryPaths
    // expansion. The shape mirrors what a real monorepo produces when
    // the user opens the root and several top-level packages.
    const nodes: FileTreeState = {};
    const expanded = new Set<string>();
    const root = "/repo";
    nodes[root] = { status: "loaded", entries: [] };
    const packageCount = 24;
    const fileCount = 40;
    for (let p = 0; p < packageCount; p += 1) {
      const pkgName = `pkg_${p}`;
      const pkgPath = `${root}/${pkgName}`;
      const entries: { name: string; kind: "file" | "dir"; size: number; mtime: number }[] = [];
      for (let f = 0; f < fileCount; f += 1) {
        entries.push({ name: `f_${f}.ts`, kind: "file", size: 1, mtime: f });
      }
      nodes[pkgPath] = { status: "loaded", entries };
      nodes[root].entries!.push({ name: pkgName, kind: "dir", size: 0, mtime: p });
      expanded.add(pkgPath);
    }

    const params = {
      nodes,
      expanded,
      pendingCreate: null,
      renaming: null,
      gitDecorations: undefined,
    };

    const prev = buildFileTreeRows({
      rootPath: root,
      nodes,
      expanded,
      pendingCreate: null,
      renaming: null,
    });

    // Patch every currently expanded directory. This is the same code
    // path the explorer takes when `gitDecorations` changes after a
    // `git status` refresh.
    const visiblePaths = [root, ...expanded];
    const result = updateFileTreeRows(prev, visiblePaths, params);
    const fullRebuild = buildFileTreeRows({
      rootPath: root,
      nodes,
      expanded,
      pendingCreate: null,
      renaming: null,
    });

    expect(result.rows).toEqual(fullRebuild.rows);
    expect(Object.fromEntries(result.entryIndexByPath)).toEqual(
      Object.fromEntries(fullRebuild.entryIndexByPath),
    );
  });
});
