import { describe, expect, it } from "vitest";
import {
  copyTargetName,
  describeRejections,
  isInsideDir,
  planTransfer,
  summarizeTransfer,
  type PlanPolicy,
  type TransferMode,
} from "./fileTransfer";
import type { FsConflictPolicy } from "@/lib/native";

/** 内存里的目录内容：`entries` 以目录为键，值为该目录下的条目名。 */
function makeTree(entries: Record<string, string[]>) {
  return (path: string): boolean => {
    const slash = path.lastIndexOf("/");
    const names = entries[path.slice(0, slash)];
    return names ? names.includes(path.slice(slash + 1)) : false;
  };
}

function plan(
  sources: string[],
  targetDir: string,
  mode: TransferMode,
  exists: (path: string) => boolean,
  policy: PlanPolicy = "detect",
  isDir?: (path: string) => boolean,
) {
  return planTransfer({ sources, targetDir, mode, policy, exists, isDir });
}

describe("fileTransfer planTransfer", () => {
  it("规划单文件移动到目标目录", () => {
    const result = plan(
      ["/repo/src/a.ts"],
      "/repo/lib",
      "move",
      makeTree({ "/repo/lib": [] }),
    );
    expect(result.items).toEqual([{ from: "/repo/src/a.ts", to: "/repo/lib/a.ts" }]);
    expect(result.conflicts).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it("多条源各自取 basename 落到同一目标目录", () => {
    const result = plan(
      ["/repo/src/a.ts", "/repo/test/a.rs"],
      "/repo/lib",
      "move",
      makeTree({ "/repo/lib": [] }),
    );
    expect(result.items.map((i) => i.to)).toEqual([
      "/repo/lib/a.ts",
      "/repo/lib/a.rs",
    ]);
  });

  it("detect 策略记录冲突并把落点预解为自动改名", () => {
    const result = plan(
      ["/repo/src/a.ts"],
      "/repo/lib",
      "move",
      makeTree({ "/repo/lib": ["a.ts"] }),
    );
    expect(result.conflicts).toEqual([
      { from: "/repo/src/a.ts", existingTo: "/repo/lib/a.ts", isDir: false },
    ]);
    expect(result.items[0]?.to).toBe("/repo/lib/a copy.ts");
  });

  it("覆盖 / 跳过策略不再记录冲突", () => {
    const exists = makeTree({ "/repo/lib": ["a.ts"] });
    for (const policy of ["overwrite", "skip", "rename"] as FsConflictPolicy[]) {
      const result = plan(["/repo/src/a.ts"], "/repo/lib", "move", exists, policy);
      expect(result.conflicts, policy).toEqual([]);
    }
  });

  it("自动改名沿用后端计数序列", () => {
    const result = plan(
      ["/repo/src/a.ts"],
      "/repo/lib",
      "move",
      makeTree({ "/repo/lib": ["a.ts", "a copy.ts", "a copy 2.ts"] }),
    );
    expect(result.items[0]?.to).toBe("/repo/lib/a copy 3.ts");
  });

  it("同一批次内两条同名源不会解析到同一个落点", () => {
    // 两个不同目录下的 a.ts（常见的重名），目标目录已有一个 a.ts。
    const result = plan(
      ["/repo/src/a.ts", "/repo/test/a.ts"],
      "/repo/lib",
      "move",
      makeTree({ "/repo/lib": ["a.ts"] }),
    );
    const targets = result.items.map((item) => item.to);
    expect(new Set(targets).size).toBe(2);
    expect(targets).toEqual(["/repo/lib/a copy.ts", "/repo/lib/a copy 2.ts"]);
  });

  it("拒绝把目录移动到它自己的子目录", () => {
    const result = plan(
      ["/repo/src"],
      "/repo/src/nested",
      "move",
      makeTree({ "/repo/src/nested": [] }),
    );
    expect(result.items).toEqual([]);
    expect(result.rejected).toEqual([
      { from: "/repo/src", reason: "own-subtree" },
    ]);
    expect(describeRejections(result.rejected)).toMatch(/subfolder|子目录/);
  });

  it("复制到自身子目录是允许的", () => {
    const result = plan(
      ["/repo/src"],
      "/repo/src/nested",
      "copy",
      makeTree({ "/repo/src/nested": [] }),
    );
    expect(result.items).toEqual([{ from: "/repo/src", to: "/repo/src/nested/src" }]);
    expect(result.rejected).toEqual([]);
  });

  it("拒绝移动到自身", () => {
    const result = plan(["/repo/src"], "/repo/src", "move", () => false);
    expect(result.rejected).toEqual([{ from: "/repo/src", reason: "self" }]);
  });

  it("拒绝同目录内移动（已经是那个位置了）", () => {
    const result = plan(["/repo/src/a.ts"], "/repo/src", "move", () => false);
    expect(result.rejected).toEqual([
      { from: "/repo/src/a.ts", reason: "same-directory" },
    ]);
  });

  it("部分非法时只把合法的放进 items", () => {
    const result = plan(
      ["/repo/src/a.ts", "/repo/src"],
      "/repo/src/nested",
      "move",
      () => false,
    );
    expect(result.items).toEqual([
      { from: "/repo/src/a.ts", to: "/repo/src/nested/a.ts" },
    ]);
    expect(result.rejected).toHaveLength(1);
  });

  it("目标目录未加载时按不冲突处理，交给后端兼底", () => {
    // exists 对未加载目录返回 false：不为一次拖拽把整条路径拉起来。
    const result = plan(["/repo/src/a.ts"], "/repo/lib", "move", () => false);
    expect(result.conflicts).toEqual([]);
    expect(result.items[0]?.to).toBe("/repo/lib/a.ts");
  });

  it("冲突项的 isDir 来自注入的探测，用于“覆盖会递归删除”的提示", () => {
    const result = plan(
      ["/repo/src/lib"],
      "/repo/dest",
      "copy",
      makeTree({ "/repo/dest": ["lib"] }),
      "detect",
      (path) => path.endsWith("/lib"),
    );
    expect(result.conflicts[0]?.isDir).toBe(true);
  });
});

describe("fileTransfer naming + summary", () => {
  it("copyTargetName 与后端规则一致", () => {
    expect(copyTargetName("/a/foo.txt", 0)).toBe("foo copy.txt");
    expect(copyTargetName("/a/foo.txt", 1)).toBe("foo copy 2.txt");
    expect(copyTargetName("/a/foo.txt", 4)).toBe("foo copy 5.txt");
    // 多点扩展名只拆最后一个点
    expect(copyTargetName("/a/foo.tar.gz", 0)).toBe("foo.tar copy.gz");
    // 点开头的名字整体当词干
    expect(copyTargetName("/a/.gitignore", 0)).toBe(".gitignore copy");
    // 无扩展名
    expect(copyTargetName("/a/README", 0)).toBe("README copy");
  });

  it("isInsideDir 覆盖相等与前缀相似两种边界", () => {
    expect(isInsideDir("/repo/src", "/repo/src")).toBe(true);
    expect(isInsideDir("/repo/src/a", "/repo/src")).toBe(true);
    expect(isInsideDir("/repo/src2", "/repo/src")).toBe(false);
    expect(isInsideDir("/repo", "/repo/src")).toBe(false);
  });

  it("summarizeTransfer 把跨设备回落单列出来", () => {
    const result = summarizeTransfer({
      completed: [{ from: "/a", to: "/b" }],
      skipped: [{ from: "/c", to: "/d" }],
      failed: [{ from: "/e", to: "/f", error: "boom" }],
      crossDevice: [{ from: "/g", to: "/h" }],
      warnings: ["skipped symlink"],
    });
    expect(result).toMatchObject({
      moved: 2,
      skipped: 1,
      failed: 1,
      crossDevice: 1,
      notable: true,
    });
  });

  it("summarizeTransfer 全成功且无告警时不算 notable", () => {
    const result = summarizeTransfer({
      completed: [{ from: "/a", to: "/b" }],
      skipped: [],
      failed: [],
      crossDevice: [],
      warnings: [],
    });
    expect(result.notable).toBe(false);
    expect(result.moved).toBe(1);
  });
});
