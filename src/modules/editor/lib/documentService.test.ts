import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  readEditorDocument,
  writeEditorDocument,
  type EditorDocumentState,
} from "./documentService";
import {
  LOCAL_WORKSPACE,
  setCurrentWorkspaceEnv,
} from "@/modules/workspace/workspaceEnvSnapshot";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("editor document service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentWorkspaceEnv(LOCAL_WORKSPACE);
  });

  it("reads text documents with workspace context", async () => {
    setCurrentWorkspaceEnv({ kind: "wsl", distro: "Ubuntu" });
    vi.mocked(invoke).mockResolvedValueOnce({
      kind: "text",
      content: "hello",
      size: 5,
    });

    const doc = await readEditorDocument("/repo/a.ts");

    expect(doc).toEqual({
      status: "ready",
      content: "hello",
      size: 5,
    } satisfies EditorDocumentState);
    expect(invoke).toHaveBeenCalledWith("fs_read_file", {
      path: "/repo/a.ts",
      workspace: { kind: "wsl", distro: "Ubuntu" },
    });
  });

  it("maps binary, too-large, and read errors into document states", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ kind: "binary", size: 10 })
      .mockResolvedValueOnce({ kind: "toolarge", size: 20, limit: 15 })
      .mockRejectedValueOnce(new Error("missing"));

    await expect(readEditorDocument("/repo/bin")).resolves.toEqual({
      status: "binary",
      size: 10,
    });
    await expect(readEditorDocument("/repo/large")).resolves.toEqual({
      status: "toolarge",
      size: 20,
      limit: 15,
    });
    await expect(readEditorDocument("/repo/missing")).resolves.toEqual({
      status: "error",
      message: "Error: missing",
    });
  });

  it("writes editor documents with editor source metadata", async () => {
    await writeEditorDocument("/repo/a.ts", "next");

    expect(invoke).toHaveBeenCalledWith("fs_write_file", {
      path: "/repo/a.ts",
      content: "next",
      workspace: LOCAL_WORKSPACE,
      source: "editor",
    });
  });
});
