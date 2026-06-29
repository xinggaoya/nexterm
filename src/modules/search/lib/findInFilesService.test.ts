// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/native", () => ({
  native: {
    fsGrep: vi.fn(),
  },
}));

import { native } from "@/lib/native";
import { runFindInFiles } from "./findInFilesService";

describe("runFindInFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty result for blank patterns without calling native", async () => {
    const result = await runFindInFiles({
      root: "/repo",
      pattern: "   ",
      caseInsensitive: false,
      includeGlobs: [],
    });
    expect(result).toEqual({ hits: [], truncated: false, filesScanned: 0 });
    expect(native.fsGrep).not.toHaveBeenCalled();
  });

  it("forwards pattern, root, and options to native.fsGrep", async () => {
    vi.mocked(native.fsGrep).mockResolvedValue({
      hits: [{ path: "/repo/a.ts", rel: "a.ts", line: 1, text: "foo" }],
      truncated: false,
      filesScanned: 12,
    });
    const result = await runFindInFiles({
      root: "/repo",
      pattern: "foo",
      caseInsensitive: true,
      includeGlobs: ["*.ts"],
    });
    expect(native.fsGrep).toHaveBeenCalledWith("foo", "/repo", {
      glob: ["*.ts"],
      caseInsensitive: true,
    });
    expect(result.hits).toHaveLength(1);
    expect(result.filesScanned).toBe(12);
  });

  it("omits glob when no include patterns are provided", async () => {
    vi.mocked(native.fsGrep).mockResolvedValue({
      hits: [],
      truncated: false,
      filesScanned: 0,
    });
    await runFindInFiles({
      root: "/repo",
      pattern: "foo",
      caseInsensitive: false,
      includeGlobs: [],
    });
    expect(native.fsGrep).toHaveBeenCalledWith("foo", "/repo", {
      glob: undefined,
      caseInsensitive: false,
    });
  });
});
