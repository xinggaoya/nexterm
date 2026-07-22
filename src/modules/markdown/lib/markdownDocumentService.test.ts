import { beforeEach, describe, expect, it, vi } from "vitest";
import { readMarkdownDocument } from "./markdownDocumentService";
import type { WorkspaceNative } from "@/lib/native";

// 构造一个仅含 fsReadFile 的 mock wsNative。
// env 路由已下沉到 createNativeForEnv 内部，服务层只调用方法，
// 因此测试不再关心 workspace 字段，只验证方法调用与返回值映射。
function makeWsNative() {
  return {
    fsReadFile: vi.fn(),
  } as unknown as WorkspaceNative;
}

describe("markdown document service", () => {
  let wsNative: WorkspaceNative;

  beforeEach(() => {
    vi.clearAllMocks();
    wsNative = makeWsNative();
  });

  it("reads markdown files via wsNative.fsReadFile", async () => {
    vi.mocked(wsNative.fsReadFile).mockResolvedValueOnce({
      kind: "text",
      content: "# Readme",
      size: 8,
    });

    await expect(
      readMarkdownDocument(wsNative, "/repo/README.md"),
    ).resolves.toEqual({
      status: "ready",
      content: "# Readme",
      size: 8,
    });
    expect(wsNative.fsReadFile).toHaveBeenCalledWith("/repo/README.md");
  });

  it("maps binary, too-large, and read errors into preview states", async () => {
    vi.mocked(wsNative.fsReadFile)
      .mockResolvedValueOnce({ kind: "binary", size: 10 })
      .mockResolvedValueOnce({ kind: "toolarge", size: 20, limit: 15 })
      .mockRejectedValueOnce(new Error("missing"));

    await expect(
      readMarkdownDocument(wsNative, "/repo/bin.md"),
    ).resolves.toEqual({
      status: "binary",
      size: 10,
    });
    await expect(
      readMarkdownDocument(wsNative, "/repo/large.md"),
    ).resolves.toEqual({
      status: "toolarge",
      size: 20,
      limit: 15,
    });
    await expect(
      readMarkdownDocument(wsNative, "/repo/missing.md"),
    ).resolves.toEqual({
      status: "error",
      message: "Error: missing",
    });
  });
});
