import { describe, expect, it, vi } from "vitest";

import { useTerminalLayoutPersistence } from "./useTerminalLayoutPersistence";
import type { TerminalTab } from "./tabsTypes";
import type { PaneNode } from "@/modules/terminal/lib/layout";

function terminalTab(id: number, cwd?: string): TerminalTab {
  const leaf: PaneNode = { kind: "leaf", id: id * 10, ...(cwd ? { cwd } : {}) };
  return {
    id,
    workspaceId: "ws",
    kind: "terminal",
    title: `t${id}`,
    paneTree: leaf,
    activeLeafId: id * 10,
  };
}

function makeHarness(initial: TerminalTab[], activeId: number) {
  let tabs = initial;
  const write = vi.fn(() => Promise.resolve());
  const persistence = useTerminalLayoutPersistence({
    readTerminalTabs: () => tabs,
    readActiveTabId: () => activeId,
    write,
  });
  return {
    persistence,
    write,
    setTabs: (next: TerminalTab[]) => {
      tabs = next;
    },
  };
}

describe("terminal layout persistence", () => {
  it("holds the injected snapshot per workspace", () => {
    const { persistence } = makeHarness([], 0);
    expect(persistence.snapshotFor("ws")).toBeUndefined();

    persistence.setSnapshot({
      ws: {
        terminals: [
          { title: "a", leaves: [{ path: "0" }], pinned: false, activeLeafPath: "0" },
        ],
        activeTerminalIndex: 0,
      },
    });
    expect(persistence.snapshotFor("ws")?.terminals[0]?.title).toBe("a");
    expect(persistence.snapshotFor("other")).toBeUndefined();
  });

  it("flush writes the serialized layout immediately", async () => {
    const { persistence, write } = makeHarness(
      [terminalTab(1, "/a"), terminalTab(2, "/b")],
      2,
    );

    persistence.flush("ws");
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));

    const [wsId, layout] = write.mock.calls[0] as unknown as [
      string,
      { terminals: unknown[]; activeTerminalIndex: number } | null,
    ];
    expect(wsId).toBe("ws");
    expect(layout?.terminals).toHaveLength(2);
    expect(layout?.activeTerminalIndex).toBe(1);
  });

  it("flush erases the stored layout when only a bare shell remains", async () => {
    // 只有一个没有 cwd 的裸 shell 时不留痕，否则每次启动都会恢复出一个
    // 看起来多余的空终端。
    const { persistence, write } = makeHarness([terminalTab(1)], 1);

    persistence.flush("ws");
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith("ws", null));
  });

  it("schedule debounces: repeated calls collapse into one write", async () => {
    vi.useFakeTimers();
    try {
      const { persistence, write } = makeHarness(
        [terminalTab(1, "/a")],
        1,
      );

      persistence.schedulePersist("ws");
      persistence.schedulePersist("ws");
      persistence.schedulePersist("ws");
      expect(write).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(600);
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancel drops a pending write", async () => {
    vi.useFakeTimers();
    try {
      const { persistence, write } = makeHarness([terminalTab(1, "/a")], 1);
      persistence.schedulePersist("ws");
      persistence.cancel("ws");

      await vi.advanceTimersByTimeAsync(600);
      expect(write).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
