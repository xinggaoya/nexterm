import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 指针拖拽重排的边界：`SessionStrip` 的标签重排、`Sidebar` 的工作区重排、
 * `FileExplorer` 的文件搬运共用 `src/lib/usePointerDragReorder.ts`。
 *
 * 这类手势的细节（阈值、ghost 缓存、window 监听的成对移除、click 抑制、
 * pointercancel 清理）在复制粘贴时最容易悄悄漂移，所以用静态扫描锁死
 * "不再出现手写副本"，而不是靠 review 记忆。
 */
const REPO_SRC = fileURLToPath(new URL("../", import.meta.url));
const SCAN_ROOTS = ["app/shell", "modules/explorer", "modules/workspace"];

/**
 * 允许手写 pointer 手势的文件及原因。resize 语义与 reorder 语义虽然都
 * 监听 window 上的 pointermove，但前者不做幽灵指示器 / click 抑制，
 * 共用 reorder 反而会引入无意义的抽象。
 */
const ALLOWED_FILES = new Set([
  "app/shell/WorkspacePanel.vue", // 面板左缘拖宽（resize）
  "lib/usePointerDragReorder.ts", // 本体
]);

/** 命中即视为手写副本的特征：window 级 pointer 监听或自制 pointer 手势状态。 */
const HAND_ROLLED_PATTERNS: Array<{ pattern: RegExp; why: string }> = [
  {
    pattern: /addEventListener\(\s*["']pointer(?:move|up|cancel)["']/,
    why: "手写 window 级 pointer 监听（应改用 usePointerDragReorder）",
  },
  {
    pattern: /type\s+PointerDragState\b/,
    why: "手写指针手势状态（应改用 usePointerDragReorder）",
  },
  {
    pattern: /suppressedClick\w*\.value/,
    why: "手写拖拽后的 click 抑制（应改用 consumeSuppressedClick）",
  },
];

function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return [full];
  });
}

describe("pointer drag reorder boundary", () => {
  it("no component hand-rolls a reorder pointer gesture", () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      const abs = join(REPO_SRC, root);
      for (const file of walk(abs)) {
        if (!/\.(ts|vue)$/.test(file)) continue;
        const rel = toPosix(relative(REPO_SRC, file));
        if (ALLOWED_FILES.has(rel)) continue;
        // 测试文件自己构造 pointer 事件序列，不受约束。
        if (rel.endsWith(".test.ts")) continue;
        const source = readFileSync(file, "utf8");
        for (const { pattern, why } of HAND_ROLLED_PATTERNS) {
          if (pattern.test(source)) offenders.push(`${rel}: ${why}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps every reorder consumer on the shared composable", () => {
    // explorer 的文件搬运拖拽（阶段 5）接入后把
    // "modules/explorer/FileExplorer.vue" 补进这个列表。
    const consumers = [
      "app/shell/SessionStrip.vue",
      "app/shell/Sidebar.vue",
    ];
    for (const rel of consumers) {
      const source = readFileSync(join(REPO_SRC, rel), "utf8");
      expect(source, `${rel} 应使用 usePointerDragReorder`).toContain(
        "usePointerDragReorder",
      );
    }
  });
});
