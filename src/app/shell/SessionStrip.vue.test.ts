// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tab } from "@/modules/tabs/tabsTypes";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    startDragging: vi.fn(async () => {}),
  }),
}));

vi.mock("@/modules/explorer/lib/iconResolver", () => ({
  fileIconUrl: vi.fn(() => "file-icon.png"),
}));

vi.mock("./TabContextMenu.vue", () => ({
  default: {
    name: "TabContextMenuStub",
    props: ["target"],
    emits: [
      "close",
      "close-tab",
      "close-others",
      "close-to-right",
      "close-all",
      "duplicate-terminal",
      "rename-tab",
      "request-rename",
      "pin-editor",
    ],
    template: "<div class='tab-contextmenu-stub' />",
  },
}));

import SessionStrip from "./SessionStrip.vue";

function terminalTab(id: number, title = `sh-${id}`): Tab {
  return {
    id,
    workspaceId: "w1",
    kind: "terminal",
    title,
    paneTree: { kind: "leaf", id: `leaf-${id}` },
    activeLeafId: id,
    cwd: `/repo/${id}`,
  } as unknown as Tab;
}

function editorTab(id: number, path: string, dirty = false): Tab {
  return {
    id,
    workspaceId: "w1",
    kind: "editor",
    title: path,
    path,
    dirty,
    preview: false,
  };
}

function mountStrip(tabs: Tab[], activeId = tabs[0]?.id ?? 0) {
  return mount(SessionStrip, {
    props: {
      tabs,
      activeId,
      widthMode: "auto",
      fixedWidth: 160,
    },
  });
}

const elementFromPointMock = vi.fn((): Element | null => null);

function fakeTabElement(id: number) {
  // 组件的 tabElementFromPoint 会对 elementFromPoint 的返回值再调
  // closest("[data-tab-id]"),这里让假元素返回自身以模拟命中的就是标签。
  const el = {
    dataset: { tabId: String(id) },
    getBoundingClientRect: () => ({ left: 0, width: 100, top: 0, height: 28 }),
    closest: () => el,
  };
  return el as unknown as HTMLElement;
}

const originalElementFromPoint = document.elementFromPoint;

beforeEach(() => {
  elementFromPointMock.mockReset();
  elementFromPointMock.mockReturnValue(null);
  // jsdom 没有实现 document.elementFromPoint,直接挂一个 mock。
  document.elementFromPoint = elementFromPointMock as unknown as typeof document.elementFromPoint;
});

afterEach(() => {
  document.elementFromPoint = originalElementFromPoint;
});

describe("SessionStrip.vue", () => {
  it("单终端 tab 时进入极简模式:渲染面包屑而不是标签", async () => {
    const wrapper = mountStrip([terminalTab(1)]);
    expect(wrapper.find("[data-session-minimal]").exists()).toBe(true);
    expect(wrapper.find("[data-tab-id]").exists()).toBe(false);

    await wrapper.find("[data-session-minimal]").trigger("click");
    expect(wrapper.emitted("selectTab")).toEqual([[1]]);
  });

  it("多个 tab 时渲染完整标签,激活态可见", () => {
    const wrapper = mountStrip([terminalTab(1), editorTab(2, "/repo/a.ts")], 2);
    expect(wrapper.find("[data-session-minimal]").exists()).toBe(false);
    const tabs = wrapper.findAll("[data-tab-id]");
    expect(tabs).toHaveLength(2);
    expect(tabs[1]?.attributes("aria-pressed")).toBe("true");
    expect(tabs[0]?.attributes("aria-pressed")).toBe("false");
  });

  it("点击标签发出 selectTab,关闭按钮发出 closeTab", async () => {
    const wrapper = mountStrip([terminalTab(1), editorTab(2, "/repo/a.ts")], 1);
    await wrapper.find("[data-tab-id='2']").trigger("click");
    expect(wrapper.emitted("selectTab")).toEqual([[2]]);

    const closeButton = wrapper
      .find("[data-tab-id='2']")
      .find("[role='button']");
    await closeButton.trigger("click");
    expect(wrapper.emitted("closeTab")).toEqual([[2]]);
  });

  it("右键菜单桩的 close-tab 转发为顶层 closeTab", async () => {
    const wrapper = mountStrip([terminalTab(1), terminalTab(2)], 1);
    const menu = wrapper.findComponent({ name: "TabContextMenuStub" });
    await menu.vm.$emit("close-tab", 2);
    expect(wrapper.emitted("closeTab")).toEqual([[2]]);
    await menu.vm.$emit("request-rename", 2);
    expect(wrapper.emitted("requestRename")).toEqual([[2]]);
  });

  it("拖拽标签越过阈值后在目标上松手 → 发出 reorderTab(after)", async () => {
    const wrapper = mountStrip([terminalTab(1), terminalTab(2)], 1);
    const source = wrapper.find("[data-tab-id='2']");

    // jsdom 的 MouseEvent 属性只读,trigger 不能带 clientX;改用构造器注入。
    source.element.dispatchEvent(
      new MouseEvent("pointerdown", { button: 0, clientX: 50, clientY: 10, bubbles: true }),
    );

    // 移动到 tab 1 右半区(elementFromPoint 命中 tab 1)。
    elementFromPointMock.mockReturnValue(fakeTabElement(1));
    window.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 80, clientY: 10, bubbles: true }),
    );
    window.dispatchEvent(
      new MouseEvent("pointerup", { clientX: 80, clientY: 10, bubbles: true }),
    );

    expect(wrapper.emitted("reorderTab")).toEqual([[2, 1, "after"]]);
  });

  it("指针位移小于阈值时不进入拖拽,不发出 reorderTab", async () => {
    const wrapper = mountStrip([terminalTab(1), terminalTab(2)], 1);
    wrapper
      .find("[data-tab-id='2']")
      .element.dispatchEvent(
        new MouseEvent("pointerdown", { button: 0, clientX: 50, clientY: 10, bubbles: true }),
      );

    window.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 52, clientY: 11, bubbles: true }),
    );
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));

    expect(wrapper.emitted("reorderTab")).toBeUndefined();
  });
});
