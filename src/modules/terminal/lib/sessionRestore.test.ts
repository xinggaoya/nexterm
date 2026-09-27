import { describe, expect, it } from "vitest";
import {
  deserializeTerminals,
  isWorthPersisting,
  serializeTerminal,
  type PersistedTerminalLayout,
} from "./sessionRestore";
import type { PaneNode } from "./layout";

/** 造一棵分屏树：leaf ids 由测试指定，方便断言。 */
function tree(...specs: Array<[string] | [string, string]>): PaneNode {
  if (specs.length === 1) {
    const [id, cwd] = specs[0]!;
    return { kind: "leaf", id, ...(cwd ? { cwd } : {}) };
  }
  const half = Math.floor(specs.length / 2);
  return {
    kind: "split",
    id: `s${specs.length}`,
    dir: "col",
    children: [tree(...specs.slice(0, half)), tree(...specs.slice(half))],
  };
}

describe("sessionRestore", () => {
  it("单叶子终端：往返后 cwd 不丢", () => {
    const tab = {
      kind: "terminal",
      title: "shell",
      paneTree: tree(["p1", "/repo/src"]),
      activeLeafId: "p1",
    };
    const persisted = serializeTerminal(tab);
    expect(persisted).not.toBeNull();
    const restored = deserializeTerminals({
      terminals: [persisted!],
      activeTerminalIndex: 0,
    });
    expect(restored.terminals[0]?.leaves).toEqual([{ cwd: "/repo/src" }]);
  });

  it("分屏：每个叶子的下标路径稳定，且带上各自的 cwd", () => {
    const tab = {
      kind: "terminal",
      title: "two",
      paneTree: tree(["p1", "/a"], ["p2", "/b"]),
      activeLeafId: "p2",
    };
    const persisted = serializeTerminal(tab)!;
    expect(persisted.leaves.map((leaf) => leaf.path)).toEqual(["0", "1"]);
    expect(persisted.leaves.map((leaf) => leaf.cwd)).toEqual(["/a", "/b"]);
    // 活动叶子按路径记录，而不是按 id
    expect(persisted.activeLeafPath).toBe("1");

    const restored = deserializeTerminals({
      terminals: [persisted],
      activeTerminalIndex: 0,
    });
    expect(restored.terminals[0]?.leaves.map((leaf) => leaf.cwd)).toEqual([
      "/a",
      "/b",
    ]);
    expect(restored.terminals[0]?.activeLeafIndex).toBe(1);
  });

  it("三层嵌套的路径仍然正确", () => {
    const tab = {
      kind: "terminal",
      title: "deep",
      paneTree: tree(["p1", "/1"], ["p2", "/2"], ["p3", "/3"]),
      activeLeafId: "p1",
    };
    const persisted = serializeTerminal(tab)!;
    expect(persisted.leaves.map((leaf) => leaf.path)).toEqual([
      "0",
      "1.0",
      "1.1",
    ]);
    expect(persisted.activeLeafPath).toBe("0");
  });

  it("带启动命令的任务终端：命令一并持久化", () => {
    const tab = {
      kind: "terminal",
      title: "task: pnpm dev",
      paneTree: {
        kind: "leaf" as const,
        id: "p1",
        cwd: "/repo",
        startupInput: "pnpm run dev\r",
      },
      activeLeafId: "p1",
    };
    const persisted = serializeTerminal(tab)!;
    expect(persisted.leaves[0]?.startupInput).toBe("pnpm run dev\r");
    const restored = deserializeTerminals({
      terminals: [persisted],
      activeTerminalIndex: 0,
    });
    expect(restored.terminals[0]?.leaves[0]?.startupInput).toBe("pnpm run dev\r");
  });

  it("非终端标签不参与序列化", () => {
    const editor = {
      kind: "editor",
      title: "a.ts",
      paneTree: tree(["p1"]),
      activeLeafId: "p1",
    };
    expect(serializeTerminal(editor)).toBeNull();
  });

  it("活动叶子 id 找不到时回落到第一个（不产出空路径）", () => {
    const tab = {
      kind: "terminal",
      title: "shell",
      paneTree: tree(["p1", "/a"], ["p2", "/b"]),
      activeLeafId: "does-not-exist",
    };
    const persisted = serializeTerminal(tab)!;
    expect(persisted.activeLeafPath).toBe("0");
  });

  it("空 / 缺字段 / 叶子为空的布局被安全丢弃", () => {
    expect(deserializeTerminals(null).terminals).toEqual([]);
    expect(deserializeTerminals(undefined).terminals).toEqual([]);
    expect(deserializeTerminals({ terminals: [], activeTerminalIndex: 0 }).terminals).toEqual([]);
    expect(
      deserializeTerminals({
        terminals: [{ title: "x", pinned: true, activeLeafPath: "", leaves: [] }],
        activeTerminalIndex: 0,
      }).terminals,
    ).toEqual([]);
  });

  it("活动下标越界被钳制", () => {
    const layout: PersistedTerminalLayout = {
      terminals: [
        { title: "a", pinned: true, activeLeafPath: "0", leaves: [{ path: "0" }] },
      ],
      activeTerminalIndex: 9,
    };
    expect(deserializeTerminals(layout).activeIndex).toBe(0);
  });

  it("只有一个裸 shell 时不值得持久化", () => {
    const single = {
      kind: "terminal",
      title: "shell",
      paneTree: tree(["p1", "/repo"]),
      activeLeafId: "p1",
    };
    expect(isWorthPersisting([single])).toBe(false);
    // 多个终端值得
    expect(isWorthPersisting([single, single])).toBe(true);
    // 单个但分了屏也值得
    expect(isWorthPersisting([{ ...single, paneTree: tree(["p1"], ["p2"]) }])).toBe(true);
  });
});
