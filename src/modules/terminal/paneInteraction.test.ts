// @vitest-environment jsdom
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useTabsPiniaStore } from "@/modules/tabs/tabsPinia";

const WS = "ws-1";

/** 拿一个分好两块的活动 terminal tab，返回 (tabId, 左侧 leafId)。 */
function splitTwoPanes(): { tabId: number; leftLeafId: number } {
  const tabs = useTabsPiniaStore();
  const tabId = tabs.newTab("/w", WS);
  tabs.splitActivePane(tabId, "row", WS);
  const tab = tabs.workspaceTabs(WS).find((t) => t.id === tabId);
  if (!tab || tab.kind !== "terminal" || tab.paneTree.kind !== "split") {
    throw new Error("expected a split terminal tab");
  }
  return { tabId, leftLeafId: tab.paneTree.children[0].id as number };
}

describe("pane split interaction", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("resizes a split through the store", () => {
    // 这条链路以前是断的：TerminalResizer 画得出来、hover 有高亮、emit 也发了，
    // 但树里没有任何监听者，layout.resizeSplit 从未被调用 —— 拖下去什么都不
    // 发生。这里验证：在 1000px 容器上往右拖 200px 能把 1:1（500/500）调成
    // 700/300，即 7:3。
    const { tabId, leftLeafId } = splitTwoPanes();
    const tabs = useTabsPiniaStore();

    tabs.resizePane(tabId, leftLeafId, 200, 1000, WS);

    const after = tabs.workspaceTabs(WS).find((t) => t.id === tabId);
    if (after?.kind !== "terminal" || after.paneTree.kind !== "split") {
      throw new Error("expected a split terminal tab");
    }
    const [a, b] = after.paneTree.children;
    const aSize = a.size ?? 1;
    const bSize = b.size ?? 1;
    expect(aSize / (aSize + bSize)).toBeCloseTo(0.7, 5);
  });

  it("ignores resizes with no measurable container", () => {
    const { tabId, leftLeafId } = splitTwoPanes();
    const tabs = useTabsPiniaStore();
    const before = JSON.stringify(
      tabs.workspaceTabs(WS).find((t) => t.id === tabId),
    );

    tabs.resizePane(tabId, leftLeafId, 200, 0, WS);

    expect(
      JSON.stringify(tabs.workspaceTabs(WS).find((t) => t.id === tabId)),
    ).toBe(before);
  });

  it("resets split sizes to equal on double-click", () => {
    const { tabId, leftLeafId } = splitTwoPanes();
    const tabs = useTabsPiniaStore();

    tabs.resizePane(tabId, leftLeafId, 300, 1000, WS);
    tabs.resetPaneSizes(tabId, leftLeafId, WS);

    const after = tabs.workspaceTabs(WS).find((t) => t.id === tabId);
    if (after?.kind !== "terminal" || after.paneTree.kind !== "split") {
      throw new Error("expected a split terminal tab");
    }
    for (const child of after.paneTree.children) {
      expect(child.size).toBe(1);
    }
  });

  it("closes a single pane and collapses the split back to one leaf", () => {
    // 以前 TerminalPane 声明了 close emit 却没有触发点，closeLeafInTab 只能
    // 收到一个永不发出的事件：分屏之后只能整标签关掉。
    const tabs = useTabsPiniaStore();
    const { tabId, leftLeafId } = splitTwoPanes();
    const tab = tabs.workspaceTabs(WS).find((t) => t.id === tabId);
    if (tab?.kind !== "terminal" || tab.paneTree.kind !== "split") {
      throw new Error("expected a split terminal tab");
    }
    const closing = tab.paneTree.children[1].id as number;

    tabs.closeLeafInTab(tabId, closing, WS);

    const after = tabs.workspaceTabs(WS).find((t) => t.id === tabId);
    expect(after?.kind).toBe("terminal");
    if (after?.kind !== "terminal") return;
    expect(after.paneTree.kind).toBe("leaf");
    // 收掉一条后活动分屏必须落在还活着的那条上。
    expect(after.paneTree.id).toBe(leftLeafId);
  });
});
