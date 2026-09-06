// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import TabBar from "./TabBar.vue";
import TabContextMenu from "./TabContextMenu.vue";
import type { Tab, TerminalTab } from "@/modules/tabs/tabsTypes";

function terminalTab(id: number, title: string): TerminalTab {
  return {
    id,
    workspaceId: "w1",
    kind: "terminal",
    title,
    cwd: `/repo/${id}`,
    paneTree: id as unknown as TerminalTab["paneTree"],
    activeLeafId: id,
    terminalTitle: title,
  };
}

const tabs: Tab[] = [
  terminalTab(1, "shell 1"),
  terminalTab(2, "shell 2"),
];

function mountBar() {
  return mount(TabBar, {
    props: {
      tabs,
      activeId: 1,
      canSplit: true,
      showActions: true,
      widthMode: "auto",
      fixedWidth: 160,
    },
  });
}

/** jsdom 没有 elementFromPoint：桩化为始终返回目标 tab 元素。 */
function stubElementFromPoint(target: HTMLElement) {
  (document as { elementFromPoint?: unknown }).elementFromPoint = () => target;
}
function restoreElementFromPoint() {
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;
}

/** jsdom 的 MouseEvent.button/pointerId 为只读或缺失，注入后手动派发。 */
function pointerEvent(type: string, clientX: number, clientY: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
  });
  Object.defineProperty(event, "button", { value: 0 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

function firePointerDown(el: Element, clientX: number, clientY: number) {
  (el as HTMLElement).dispatchEvent(pointerEvent("pointerdown", clientX, clientY));
}

function fireWindowPointer(type: "pointermove" | "pointerup", clientX: number, clientY: number) {
  window.dispatchEvent(pointerEvent(type, clientX, clientY));
}

describe("TabBar.vue", () => {
  it("渲染每个 tab 的标题并标记活动 tab", () => {
    const wrapper = mountBar();
    const items = wrapper.findAll("[data-tab-id]");
    expect(items).toHaveLength(2);
    expect(wrapper.text()).toContain("shell 1");
    expect(wrapper.text()).toContain("shell 2");
  });

  it("点击 tab 发出 selectTab，关闭按钮发出 closeTab", async () => {
    const wrapper = mountBar();
    await wrapper.find('[data-tab-id="2"]').trigger("click");
    expect(wrapper.emitted("selectTab")).toEqual([[2]]);

    const close = wrapper.find('[data-tab-id="2"]').find("[role=button]");
    expect(close.exists()).toBe(true);
    await close.trigger("click");
    expect(wrapper.emitted("closeTab")).toEqual([[2]]);
  });

  it("右键填充上下文菜单 target 并转发菜单事件", async () => {
    const wrapper = mountBar();
    // 菜单组件常驻渲染，未右键时 target 为 null。
    const menu = wrapper.findComponent(TabContextMenu);
    expect(menu.exists()).toBe(true);
    expect(menu.props("target")).toBeNull();

    await wrapper.find('[data-tab-id="1"]').trigger("contextmenu");
    expect(menu.props("target")).toMatchObject({ tab: { id: 1 } });

    // 菜单里选择"重命名终端标题"→ 透传 requestRename
    await menu.vm.$emit("requestRename", 1);
    expect(wrapper.emitted("requestRename")).toEqual([[1]]);

    // 关闭事件透传
    await menu.vm.$emit("closeTab", 1);
    expect(wrapper.emitted("closeTab")).toEqual([[1]]);
    await menu.vm.$emit("close");
    expect(menu.props("target")).toBeNull();
  });

  it("拖拽 tab 到另一个 tab 上发出 reorderTab（落点在右半 → after）", async () => {
    const wrapper = mountBar();
    const targetEl = wrapper.find('[data-tab-id="2"]').element as HTMLElement;
    stubElementFromPoint(targetEl);

    firePointerDown(wrapper.find('[data-tab-id="1"]').element, 10, 10);
    // 移动超过 DRAG_THRESHOLD(6px) 进入拖拽态
    fireWindowPointer("pointermove", 40, 10);
    // 目标元素 rect 在 jsdom 全 0，clientX 40 在其右半 → placement "after"
    fireWindowPointer("pointerup", 40, 10);

    expect(wrapper.emitted("reorderTab")).toEqual([[1, 2, "after"]]);
    restoreElementFromPoint();
  });

  it("pointerup 时未越过阈值不产生拖拽也不 emit reorder", async () => {
    const wrapper = mountBar();
    const targetEl = wrapper.find('[data-tab-id="2"]').element as HTMLElement;
    stubElementFromPoint(targetEl);

    firePointerDown(wrapper.find('[data-tab-id="1"]').element, 10, 10);
    fireWindowPointer("pointermove", 12, 10);
    fireWindowPointer("pointerup", 12, 10);

    expect(wrapper.emitted("reorderTab")).toBeUndefined();
    restoreElementFromPoint();
  });

  it("新建终端按钮发出 newTab", async () => {
    const wrapper = mountBar();
    await wrapper.find("[data-new-tab]").trigger("click");
    expect(wrapper.emitted("newTab")).toHaveLength(1);
  });
});
