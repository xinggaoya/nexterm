import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readEditorDocument,
  writeEditorDocument,
  type EditorDocumentState,
} from "./documentService";
import type { WorkspaceNative } from "@/lib/native";

// 构造一个仅含本测试所需方法的 mock wsNative。
// env 路由已经下沉到 createNativeForEnv 内部，服务层只调用方法，
// 因此测试不再关心 workspace 字段，只验证方法调用与返回值映射。
function makeWsNative() {
  return {
    fsReadFile: vi.fn(),
    fsWriteFile: vi.fn(),
  } as unknown as WorkspaceNative;
}

describe("editor document service", () => {
  let wsNative: WorkspaceNative;

  beforeEach(() => {
    vi.clearAllMocks();
    wsNative = makeWsNative();
  });

  it("reads text documents via wsNative.fsReadFile", async () => {
    vi.mocked(wsNative.fsReadFile).mockResolvedValueOnce({
      kind: "text",
      content: "hello",
      size: 5,
    });

    const doc = await readEditorDocument(wsNative, "/repo/a.ts");

    expect(doc).toEqual({
      status: "ready",
      content: "hello",
      size: 5,
    } satisfies EditorDocumentState);
    expect(wsNative.fsReadFile).toHaveBeenCalledWith("/repo/a.ts");
  });

  it("maps binary, too-large, and read errors into document states", async () => {
    vi.mocked(wsNative.fsReadFile)
      .mockResolvedValueOnce({ kind: "binary", size: 10 })
      .mockResolvedValueOnce({ kind: "toolarge", size: 20, limit: 15 })
      .mockRejectedValueOnce(new Error("missing"));

    await expect(readEditorDocument(wsNative, "/repo/bin")).resolves.toEqual({
      status: "binary",
      size: 10,
    });
    await expect(readEditorDocument(wsNative, "/repo/large")).resolves.toEqual({
      status: "toolarge",
      size: 20,
      limit: 15,
    });
    await expect(
      readEditorDocument(wsNative, "/repo/missing"),
    ).resolves.toEqual({
      status: "error",
      message: "Error: missing",
    });
  });

  it("writes editor documents via wsNative.fsWriteFile", async () => {
    await writeEditorDocument(wsNative, "/repo/a.ts", "next");

    expect(wsNative.fsWriteFile).toHaveBeenCalledWith("/repo/a.ts", "next");
  });
});
