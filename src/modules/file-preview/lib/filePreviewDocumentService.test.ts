import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFilePreview } from "./filePreviewDocumentService";
import type { WorkspaceNative } from "@/lib/native";

// 构造一个仅含 fsReadFileBase64 的 mock wsNative。
// env 路由已下沉到 createNativeForEnv 内部，服务层只调用方法，
// 因此测试不再关心 workspace 字段，只验证方法调用与返回值映射。
function makeWsNative() {
  return {
    fsReadFileBase64: vi.fn(),
  } as unknown as WorkspaceNative;
}

describe("file preview document service", () => {
  let wsNative: WorkspaceNative;

  beforeEach(() => {
    vi.clearAllMocks();
    wsNative = makeWsNative();
  });

  it("wraps base64 content into a data URL", async () => {
    vi.mocked(wsNative.fsReadFileBase64).mockResolvedValueOnce({
      kind: "content",
      content: "aGVsbG8=",
      size: 5,
    });

    await expect(readFilePreview(wsNative, "/repo/logo.png")).resolves.toEqual({
      status: "ready",
      src: "data:image/png;base64,aGVsbG8=",
      size: 5,
    });
    expect(wsNative.fsReadFileBase64).toHaveBeenCalledWith("/repo/logo.png");
  });

  it("maps too-large and read errors into preview states", async () => {
    vi.mocked(wsNative.fsReadFileBase64)
      .mockResolvedValueOnce({ kind: "toolarge", size: 20, limit: 15 })
      .mockRejectedValueOnce(new Error("missing"));

    await expect(
      readFilePreview(wsNative, "/repo/large.png"),
    ).resolves.toEqual({
      status: "toolarge",
      size: 20,
      limit: 15,
    });
    await expect(
      readFilePreview(wsNative, "/repo/missing.png"),
    ).resolves.toEqual({
      status: "error",
      message: "Error: missing",
    });
  });

  it("rejects non-image paths without touching the backend", async () => {
    await expect(readFilePreview(wsNative, "/repo/notes.txt")).resolves.toEqual(
      { status: "unsupported" },
    );
    expect(wsNative.fsReadFileBase64).not.toHaveBeenCalled();
  });
});
