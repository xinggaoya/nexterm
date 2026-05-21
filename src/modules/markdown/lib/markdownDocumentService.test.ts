import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  LOCAL_WORKSPACE,
  setCurrentWorkspaceEnv,
} from "@/modules/workspace/workspaceEnvSnapshot";
import { readMarkdownDocument } from "./markdownDocumentService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("markdown document service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentWorkspaceEnv(LOCAL_WORKSPACE);
  });

  it("reads markdown files with workspace context", async () => {
    setCurrentWorkspaceEnv({ kind: "wsl", distro: "Ubuntu" });
    vi.mocked(invoke).mockResolvedValueOnce({
      kind: "text",
      content: "# Readme",
      size: 8,
    });

    await expect(readMarkdownDocument("/repo/README.md")).resolves.toEqual({
      status: "ready",
      content: "# Readme",
      size: 8,
    });
    expect(invoke).toHaveBeenCalledWith("fs_read_file", {
      path: "/repo/README.md",
      workspace: { kind: "wsl", distro: "Ubuntu" },
    });
  });

  it("maps binary, too-large, and read errors into preview states", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ kind: "binary", size: 10 })
      .mockResolvedValueOnce({ kind: "toolarge", size: 20, limit: 15 })
      .mockRejectedValueOnce(new Error("missing"));

    await expect(readMarkdownDocument("/repo/bin.md")).resolves.toEqual({
      status: "binary",
      size: 10,
    });
    await expect(readMarkdownDocument("/repo/large.md")).resolves.toEqual({
      status: "toolarge",
      size: 20,
      limit: 15,
    });
    await expect(readMarkdownDocument("/repo/missing.md")).resolves.toEqual({
      status: "error",
      message: "Error: missing",
    });
  });
});
