// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceNative } from "@/lib/native";
import { runFindInFiles } from "./findInFilesService";

// 构造一个仅含 fsGrep 的 mock wsNative。
// env 路由已下沉到 createNativeForEnv，服务层只转发 fsGrep 调用，
// 因此测试断言 wsNative.fsGrep 被以正确参数调用。
function makeWsNative() {
  return {
    fsGrep: vi.fn(),
  } as unknown as WorkspaceNative;
}

describe("runFindInFiles", () => {
  let wsNative: WorkspaceNative;

  beforeEach(() => {
    vi.clearAllMocks();
    wsNative = makeWsNative();
  });

  it("returns empty result for blank patterns without calling native", async () => {
    const result = await runFindInFiles(wsNative, {
      root: "/repo",
      pattern: "   ",
      caseInsensitive: false,
      includeGlobs: [],
    });
    expect(result).toEqual({ hits: [], truncated: false, filesScanned: 0 });
    expect(wsNative.fsGrep).not.toHaveBeenCalled();
  });

  it("forwards pattern, root, and options to wsNative.fsGrep", async () => {
    vi.mocked(wsNative.fsGrep).mockResolvedValue({
      hits: [{ path: "/repo/a.ts", rel: "a.ts", line: 1, text: "foo" }],
      truncated: false,
      filesScanned: 12,
    });
    const result = await runFindInFiles(wsNative, {
      root: "/repo",
      pattern: "foo",
      caseInsensitive: true,
      includeGlobs: ["*.ts"],
    });
    expect(wsNative.fsGrep).toHaveBeenCalledWith("foo", "/repo", {
      glob: ["*.ts"],
      caseInsensitive: true,
    });
    expect(result.hits).toHaveLength(1);
    expect(result.filesScanned).toBe(12);
  });

  it("omits glob when no include patterns are provided", async () => {
    vi.mocked(wsNative.fsGrep).mockResolvedValue({
      hits: [],
      truncated: false,
      filesScanned: 0,
    });
    await runFindInFiles(wsNative, {
      root: "/repo",
      pattern: "foo",
      caseInsensitive: false,
      includeGlobs: [],
    });
    expect(wsNative.fsGrep).toHaveBeenCalledWith("foo", "/repo", {
      glob: undefined,
      caseInsensitive: false,
    });
  });
});
