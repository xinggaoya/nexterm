// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInstance } from "@/modules/workspace";

import Sidebar from "./Sidebar.vue";

function workspace(id: string, name: string, env: WorkspaceInstance["env"] = { kind: "local" }): WorkspaceInstance {
  return { id, rootPath: `/repo/${name}`, env, name, openedAt: 1 };
}

function mountSidebar(props: Partial<InstanceType<typeof Sidebar>["$props"]> = {}) {
  return mount(Sidebar, {
    props: {
      workspaces: [],
      activeWorkspaceId: null,
      collapsed: false,
      ...props,
    },
    global: { plugins: [createPinia()] },
  });
}

// jsdom 没有实现 document.elementFromPoint,拖拽测试直接挂一个 mock。
const elementFromPointMock = vi.fn((): Element | null => null);
const originalElementFromPoint = document.elementFromPoint;

function fakeWorkspaceElement(id: string) {
  // 组件会对 elementFromPoint 的返回值再调 closest,这里让假元素返回自身。
  const el = {
    dataset: { workspaceRow: id },
    getBoundingClientRect: () => ({ left: 0, width: 200, top: 0, height: 32 }),
    closest: () => el,
  };
  return el as unknown as HTMLElement;
}

beforeEach(() => {
  elementFromPointMock.mockReset();
  elementFromPointMock.mockReturnValue(null);
  document.elementFromPoint = elementFromPointMock as unknown as typeof document.elementFromPoint;
});

afterEach(() => {
  document.elementFromPoint = originalElementFromPoint;
});

describe("Sidebar.vue", () => {
  it("展开态:为每个工作区渲染一行(monogram + 名称 + env 图标)", () => {
    const wrapper = mountSidebar({
      workspaces: [workspace("w1", "nexterm"), workspace("w2", "blog", { kind: "wsl", distro: "Ubuntu" })],
      activeWorkspaceId: "w2",
    });

    const rows = wrapper.findAll("[data-workspace-row]");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.text()).toContain("nexterm");
    expect(rows[0]?.text()).toContain("N");
    // WSL 行带 env 图标(信息色);活动行 aria-pressed。
    expect(rows[1]?.find(".text-info").exists()).toBe(true);
    expect(rows[0]?.attributes("aria-pressed")).toBe("false");
    expect(rows[1]?.attributes("aria-pressed")).toBe("true");
  });

  it("点击行切换工作区,行内 × 关闭工作区", async () => {
    const wrapper = mountSidebar({
      workspaces: [workspace("w1", "nexterm")],
      activeWorkspaceId: "w1",
    });

    await wrapper.find("[data-workspace-row='w1']").trigger("click");
    expect(wrapper.emitted("select-workspace")).toEqual([["w1"]]);

    await wrapper.find("[data-close-workspace='w1']").trigger("click");
    expect(wrapper.emitted("close-workspace")).toEqual([["w1"]]);
  });

  it("拖拽工作区行越过阈值后在目标下半区松手 → 发出 reorder-workspace(after)", () => {
    const wrapper = mountSidebar({
      workspaces: [workspace("w1", "nexterm"), workspace("w2", "blog")],
      activeWorkspaceId: "w1",
    });

    // jsdom 的 MouseEvent 属性只读,trigger 不能带 clientY;改用构造器注入。
    wrapper.find("[data-workspace-row='w2']").element.dispatchEvent(
      new MouseEvent("pointerdown", { button: 0, clientX: 20, clientY: 40, bubbles: true }),
    );

    // 移到 w1 行下半区(假元素 rect: top 0 / height 32,clientY 20 命中 after)。
    elementFromPointMock.mockReturnValue(fakeWorkspaceElement("w1"));
    window.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 24, clientY: 20, bubbles: true }),
    );
    window.dispatchEvent(
      new MouseEvent("pointerup", { clientX: 24, clientY: 20, bubbles: true }),
    );

    expect(wrapper.emitted("reorder-workspace")).toEqual([["w2", "w1", "after"]]);
  });

  it("折叠态拖拽芯片同样发出 reorder-workspace(before)", () => {
    const wrapper = mountSidebar({
      workspaces: [workspace("w1", "nexterm"), workspace("w2", "blog")],
      activeWorkspaceId: "w1",
      collapsed: true,
    });

    wrapper.find("[data-workspace-chip='w1']").element.dispatchEvent(
      new MouseEvent("pointerdown", { button: 0, clientX: 20, clientY: 10, bubbles: true }),
    );

    elementFromPointMock.mockReturnValue(fakeWorkspaceElement("w2"));
    window.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 20, clientY: 4, bubbles: true }),
    );
    window.dispatchEvent(
      new MouseEvent("pointerup", { clientX: 20, clientY: 4, bubbles: true }),
    );

    expect(wrapper.emitted("reorder-workspace")).toEqual([["w1", "w2", "before"]]);
  });

  it("指针位移小于阈值时不进入拖拽,不发出 reorder-workspace", () => {
    const wrapper = mountSidebar({
      workspaces: [workspace("w1", "nexterm"), workspace("w2", "blog")],
    });

    wrapper.find("[data-workspace-row='w2']").element.dispatchEvent(
      new MouseEvent("pointerdown", { button: 0, clientX: 20, clientY: 40, bubbles: true }),
    );
    window.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 22, clientY: 41, bubbles: true }),
    );
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));

    expect(wrapper.emitted("reorder-workspace")).toBeUndefined();
  });

  it("仅一个工作区时按下不启动拖拽", () => {
    const wrapper = mountSidebar({ workspaces: [workspace("w1", "nexterm")] });

    wrapper.find("[data-workspace-row='w1']").element.dispatchEvent(
      new MouseEvent("pointerdown", { button: 0, clientX: 20, clientY: 40, bubbles: true }),
    );
    elementFromPointMock.mockReturnValue(fakeWorkspaceElement("w1"));
    window.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 40, clientY: 80, bubbles: true }),
    );
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));

    expect(wrapper.emitted("reorder-workspace")).toBeUndefined();
  });

  it("搜索位发出 open-command-palette,设置行发出 open-settings", async () => {    const wrapper = mountSidebar();

    await wrapper.find("[data-sidebar-search]").trigger("click");
    expect(wrapper.emitted("open-command-palette")).toHaveLength(1);

    await wrapper.find("[data-open-settings]").trigger("click");
    expect(wrapper.emitted("open-settings")).toHaveLength(1);
  });

  it("折叠态:渲染为芯片轨道,展开按钮发出 toggle-collapse", async () => {
    const wrapper = mountSidebar({
      workspaces: [workspace("w1", "nexterm")],
      activeWorkspaceId: "w1",
      collapsed: true,
    });

    const root = wrapper.find("[data-sidebar]");
    expect(root.attributes("data-sidebar-collapsed")).toBeDefined();
    expect(wrapper.find("[data-workspace-chip='w1']").exists()).toBe(true);
    expect(wrapper.find("[data-workspace-row]").exists()).toBe(false);

    await wrapper.find("[data-sidebar-expand]").trigger("click");
    expect(wrapper.emitted("toggle-collapse")).toHaveLength(1);
  });

  it("展开态提供折叠按钮", async () => {
    const wrapper = mountSidebar({ collapsed: false });
    await wrapper.find("[data-sidebar-collapse]").trigger("click");
    expect(wrapper.emitted("toggle-collapse")).toHaveLength(1);
  });

  it("添加工作区按钮存在(菜单选项由 NDropdown 托管)", () => {
    const wrapper = mountSidebar({ collapsed: true });
    expect(wrapper.find("[data-add-workspace]").exists()).toBe(true);
  });
});
