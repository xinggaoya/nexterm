import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  createFileTreeEntry,
  deleteFileTreePath,
  dirname,
  joinPath,
  readFileTreeDir,
  renameFileTreePath,
} from "./fileTreeService";
import {
  LOCAL_WORKSPACE,
  setCurrentWorkspaceEnv,
} from "@/modules/workspace/workspaceEnvSnapshot";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("file tree service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentWorkspaceEnv(LOCAL_WORKSPACE);
  });

  it("joins and derives POSIX-style paths", () => {
    expect(joinPath("/repo", "src")).toBe("/repo/src");
    expect(joinPath("/repo/", "src")).toBe("/repo/src");
    expect(dirname("/repo/src/main.ts")).toBe("/repo/src");
    expect(dirname("/main.ts")).toBe("/");
  });

  it("reads directory entries with current workspace context", async () => {
    setCurrentWorkspaceEnv({ kind: "wsl", distro: "Ubuntu" });
    vi.mocked(invoke).mockResolvedValueOnce([
      { name: "src", kind: "dir", size: 0, mtime: 1 },
    ]);

    const entries = await readFileTreeDir("/repo", true);

    expect(entries).toEqual([{ name: "src", kind: "dir", size: 0, mtime: 1 }]);
    expect(invoke).toHaveBeenCalledWith("fs_read_dir", {
      path: "/repo",
      showHidden: true,
      workspace: { kind: "wsl", distro: "Ubuntu" },
    });
  });

  it("creates, renames, and deletes paths through filesystem IPC", async () => {
    await createFileTreeEntry("/repo/new.ts", "file");
    await createFileTreeEntry("/repo/new-dir", "dir");
    await renameFileTreePath("/repo/a.ts", "/repo/b.ts");
    await deleteFileTreePath("/repo/b.ts");

    expect(invoke).toHaveBeenNthCalledWith(1, "fs_create_file", {
      path: "/repo/new.ts",
      workspace: LOCAL_WORKSPACE,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "fs_create_dir", {
      path: "/repo/new-dir",
      workspace: LOCAL_WORKSPACE,
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "fs_rename", {
      from: "/repo/a.ts",
      to: "/repo/b.ts",
      workspace: LOCAL_WORKSPACE,
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "fs_delete", {
      path: "/repo/b.ts",
      workspace: LOCAL_WORKSPACE,
    });
  });
});
