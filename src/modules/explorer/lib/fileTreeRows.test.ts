import { describe, expect, it } from "vitest";
import {
  buildFileTreeRows,
  filterFileTreeRows,
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
      gitDecorations: new Map([
        [
          "/repo/src/main.ts",
          {
            statusKind: "modified",
            staged: false,
            unstaged: true,
            hasDescendantChanges: false,
            count: 1,
          },
        ],
      ]),
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
        gitDecoration: {
          statusKind: "modified",
          staged: false,
          unstaged: true,
          hasDescendantChanges: false,
          count: 1,
        },
      },
      {
        kind: "entry",
        key: "/repo/src/broken",
        path: "/repo/src/broken",
        name: "broken",
        isDir: true,
        isExpanded: true,
        depth: 1,
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
      gitDecorations: undefined,
    });

    expect(rows[1]).toEqual({
      kind: "status",
      key: "loading:/repo/src",
      depth: 1,
      tone: "muted",
      message: "Loading...",
    });
  });
});

describe("filterFileTreeRows", () => {
  const tree = buildFileTreeRows({
    rootPath: "/repo",
    nodes: {
      "/repo": {
        status: "loaded",
        entries: [
          { name: "src", kind: "dir", size: 0, mtime: 1 },
          { name: "README.md", kind: "file", size: 1, mtime: 2 },
        ],
      },
      "/repo/src": {
        status: "loaded",
        entries: [
          { name: "main.ts", kind: "file", size: 2, mtime: 3 },
          { name: "config.ts", kind: "file", size: 3, mtime: 4 },
        ],
      },
    },
    expanded: new Set(["/repo/src"]),
    pendingCreate: null,
    renaming: null,
  });

  const paths = (rows: typeof tree.rows) =>
    rows.flatMap((row) => (row.kind === "entry" ? [row.path] : []));

  it("空查询原样返回", () => {
    expect(filterFileTreeRows(tree.rows, "")).toHaveLength(tree.rows.length);
    expect(filterFileTreeRows(tree.rows, "   ")).toHaveLength(tree.rows.length);
  });

  it("保留命中项与它的祖先链", () => {
    const filtered = filterFileTreeRows(tree.rows, "main");
    // /repo/src 是 /repo/src/main.ts 的祖先，必须保留，否则命中项不可达。
    expect(paths(filtered)).toEqual(["/repo/src", "/repo/src/main.ts"]);
  });

  it("大小写不敏感", () => {
    expect(paths(filterFileTreeRows(tree.rows, "MAIN.TS"))).toEqual([
      "/repo/src",
      "/repo/src/main.ts",
    ]);
  });

  it("只匹配 basename，不匹配路径片段", () => {
    // 查询 "repo" 不应命中：用户看到的是名字，不是路径。
    expect(paths(filterFileTreeRows(tree.rows, "repo"))).toEqual([]);
  });

  it("无命中时返回空（不保留任何骨架）", () => {
    expect(filterFileTreeRows(tree.rows, "zzz")).toEqual([]);
  });

  it("命中目录名时保留它与全部后代", () => {
    // 折叠的目录不在 rows 里，所以这里命中的是可见条目。
    const filtered = filterFileTreeRows(tree.rows, "src");
    expect(paths(filtered)).toEqual([
      "/repo/src",
      "/repo/src/main.ts",
      "/repo/src/config.ts",
    ]);
  });

  it("status / pending 行不参与过滤", () => {
    const rows = [
      { kind: "status", key: "s1", depth: 0, tone: "error" as const, message: "boom" },
      { kind: "entry", key: "e1", path: "/repo/a.ts", name: "a.ts", isDir: false, isExpanded: false, depth: 0 },
    ];
    const filtered = filterFileTreeRows(rows, "a");
    expect(filtered.map((r) => r.kind)).toEqual(["status", "entry"]);
    // 过滤后状态行仍在，不会因为输入查询词而丢掉错误提示。
    expect(filterFileTreeRows(rows, "zzz").map((r) => r.kind)).toEqual(["status"]);
  });
});
