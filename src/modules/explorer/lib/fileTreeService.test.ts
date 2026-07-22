import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFileTreeEntry,
  deleteFileTreePath,
  dirname,
  joinPath,
  readFileTreeDir,
  renameFileTreePath,
  searchFileTree,
} from "./fileTreeService";
import type { WorkspaceNative } from "@/lib/native";

// 构造一个仅含本测试所需方法的 mock wsNative。
// env 路由已下沉到 createNativeForEnv 内部，fileTreeService 只转发方法调用，
// 因此测试断言 wsNative 上的方法被以正确参数调用。
function makeWsNative() {
  return {
    fsReadDir: vi.fn(),
    fsCreateFile: vi.fn(),
    fsCreateDir: vi.fn(),
    fsRename: vi.fn(),
    fsDelete: vi.fn(),
    fsSearch: vi.fn(),
  } as unknown as WorkspaceNative;
}

describe("file tree service", () => {
  let wsNative: WorkspaceNative;

  beforeEach(() => {
    vi.clearAllMocks();
    wsNative = makeWsNative();
  });

  it("joins and derives POSIX-style paths", () => {
    expect(joinPath("/repo", "src")).toBe("/repo/src");
    expect(joinPath("/repo/", "src")).toBe("/repo/src");
    expect(dirname("/repo/src/main.ts")).toBe("/repo/src");
    expect(dirname("/main.ts")).toBe("/");
  });

  it("reads directory entries via wsNative.fsReadDir", async () => {
    vi.mocked(wsNative.fsReadDir).mockResolvedValueOnce([
      { name: "src", kind: "dir", size: 0, mtime: 1 },
    ]);

    const entries = await readFileTreeDir(wsNative, "/repo", true);

    expect(entries).toEqual([{ name: "src", kind: "dir", size: 0, mtime: 1 }]);
    expect(wsNative.fsReadDir).toHaveBeenCalledWith("/repo", true);
  });

  it("creates, renames, and deletes paths through wsNative fs methods", async () => {
    await createFileTreeEntry(wsNative, "/repo/new.ts", "file");
    await createFileTreeEntry(wsNative, "/repo/new-dir", "dir");
    await renameFileTreePath(wsNative, "/repo/a.ts", "/repo/b.ts");
    await deleteFileTreePath(wsNative, "/repo/b.ts");

    expect(wsNative.fsCreateFile).toHaveBeenCalledWith("/repo/new.ts");
    expect(wsNative.fsCreateDir).toHaveBeenCalledWith("/repo/new-dir");
    expect(wsNative.fsRename).toHaveBeenCalledWith("/repo/a.ts", "/repo/b.ts");
    expect(wsNative.fsDelete).toHaveBeenCalledWith("/repo/b.ts");
  });

  it("searches file tree via wsNative.fsSearch", async () => {
    vi.mocked(wsNative.fsSearch).mockResolvedValueOnce({
      hits: [
        {
          path: "/repo/src/main.ts",
          rel: "src/main.ts",
          name: "main.ts",
          is_dir: false,
        },
      ],
      truncated: false,
    });

    const result = await searchFileTree(wsNative, "/repo", "main", true);

    expect(result.hits).toHaveLength(1);
    expect(wsNative.fsSearch).toHaveBeenCalledWith("/repo", "main", true);
  });
});
