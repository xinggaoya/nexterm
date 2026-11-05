// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_WORKSPACE, type WorkspaceInstance } from "@/modules/workspace";

import WorkspaceSwitcher from "./WorkspaceSwitcher.vue";

function workspace(
  id: string,
  name: string,
  env: WorkspaceInstance["env"] = { kind: "local" },
): WorkspaceInstance {
  return { id, rootPath: `/repo/${name}`, env, name, openedAt: 1 };
}

function mountSwitcher(
  props: Partial<InstanceType<typeof WorkspaceSwitcher>["$props"]> = {},
) {
  return mount(WorkspaceSwitcher, {
    props: {
      workspaces: [],
      activeWorkspaceId: null,
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
  document.elementFromPoint =
    elementFromPointMock as unknown as typeof document.elementFromPoint;
});

afterEach(() => {
  document.elementFromPoint = originalElementFromPoint;
});

describe("WorkspaceSwitcher.vue", () => {
  it("触发按钮显示活动工作区的名称与 monogram", () => {
    const wrapper = mountSwitcher({
      workspaces: [
        workspace("w1", "nexterm"),
        workspace("w2", "blog", { kind: "wsl", distro: "Ubuntu" }),
      ],
      activeWorkspaceId: "w2",
    });

    const trigger = wrapper.find("[data-workspace-switcher]");
    expect(trigger.exists()).toBe(true);
    expect(trigger.text()).toContain("blog");
    expect(trigger.text()).toContain("B");
  });

  it("浮层默认收起,点击触发按钮后展开", async () => {
    const wrapper = mountSwitcher({
      workspaces: [workspace("w1", "nexterm")],
      activeWorkspaceId: "w1",
    });

    expect(wrapper.find("[data-workspace-popover]").exists()).toBe(false);

    await wrapper.find("[data-workspace-switcher]").trigger("click");
    expect(wrapper.find("[data-workspace-popover]").exists()).toBe(true);
  });

  it("浮层内为每个工作区渲染一行,活动行高亮", async () => {
    const wrapper = mountSwitcher({
      workspaces: [workspace("w1", "nexterm"), workspace("w2", "blog")],
      activeWorkspaceId: "w2",
    });

    await wrapper.find("[data-workspace-switcher]").trigger("click");

    const rows = wrapper.findAll("[data-workspace-row]");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.text()).toContain("nexterm");
    expect(rows[1]?.attributes("data-workspace-active")).toBe("true");
    expect(rows[0]?.attributes("data-workspace-active")).toBe("false");
  });

  it("点击行发出 select-workspace", async () => {
    const wrapper = mountSwitcher({
      workspaces: [workspace("w1", "nexterm"), workspace("w2", "blog")],
      activeWorkspaceId: "w1",
    });

    await wrapper.find("[data-workspace-switcher]").trigger("click");
    await wrapper.find("[data-workspace-select='w2']").trigger("click");

    expect(wrapper.emitted("select-workspace")).toEqual([["w2"]]);
  });

  it("行内动作区:在新窗口打开 / 移除工作区", async () => {
    const wrapper = mountSwitcher({
      workspaces: [workspace("w1", "nexterm")],
      activeWorkspaceId: "w1",
    });

    await wrapper.find("[data-workspace-switcher]").trigger("click");
    await wrapper.find("[data-workspace-more='w1']").trigger("click");

    const actions = wrapper.find("[data-workspace-actions='w1']");
    expect(actions.exists()).toBe(true);

    // “在新窗口打开”：动作条收起，但浮层保持展开（用户可能连着做几件事）。
    await wrapper.find("[data-workspace-new-window='w1']").trigger("click");
    expect(wrapper.emitted("open-workspace-in-new-window")).toEqual([["w1"]]);
    expect(wrapper.find("[data-workspace-actions='w1']").exists()).toBe(false);
    expect(wrapper.find("[data-workspace-popover]").exists()).toBe(true);

    await wrapper.find("[data-workspace-more='w1']").trigger("click");
    await wrapper.find("[data-workspace-close='w1']").trigger("click");
    expect(wrapper.emitted("close-workspace")).toEqual([["w1"]]);
  });

  it("添加工作区:展开选项后选择本机 → add-workspace(LOCAL_WORKSPACE)", async () => {
    const wrapper = mountSwitcher({
      workspaces: [workspace("w1", "nexterm")],
      activeWorkspaceId: "w1",
    });

    await wrapper.find("[data-workspace-switcher]").trigger("click");
    await wrapper.find("[data-add-workspace]").trigger("click");

    const option = wrapper.find("[data-add-option='local']");
    expect(option.exists()).toBe(true);
    await option.trigger("click");

    expect(wrapper.emitted("add-workspace")).toEqual([[LOCAL_WORKSPACE]]);
  });

  it("拖拽工作区行越过阈值后松手 → 发出 reorder-workspace", async () => {
    const wrapper = mountSwitcher({
      workspaces: [workspace("w1", "nexterm"), workspace("w2", "blog")],
      activeWorkspaceId: "w1",
    });

    await wrapper.find("[data-workspace-switcher]").trigger("click");

    wrapper.find("[data-workspace-row='w2']").element.dispatchEvent(
      new MouseEvent("pointerdown", {
        button: 0,
        clientX: 20,
        clientY: 40,
        bubbles: true,
      }),
    );

    elementFromPointMock.mockReturnValue(fakeWorkspaceElement("w1"));
    window.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 24, clientY: 20, bubbles: true }),
    );
    window.dispatchEvent(
      new MouseEvent("pointerup", { clientX: 24, clientY: 20, bubbles: true }),
    );

    expect(wrapper.emitted("reorder-workspace")).toEqual([["w2", "w1", "after"]]);
  });

  it("仅一个工作区时按下不启动拖拽", async () => {
    const wrapper = mountSwitcher({
      workspaces: [workspace("w1", "nexterm")],
      activeWorkspaceId: "w1",
    });

    await wrapper.find("[data-workspace-switcher]").trigger("click");

    wrapper.find("[data-workspace-row='w1']").element.dispatchEvent(
      new MouseEvent("pointerdown", {
        button: 0,
        clientX: 20,
        clientY: 40,
        bubbles: true,
      }),
    );
    elementFromPointMock.mockReturnValue(fakeWorkspaceElement("w1"));
    window.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 40, clientY: 80, bubbles: true }),
    );
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));

    expect(wrapper.emitted("reorder-workspace")).toBeUndefined();
  });

  it("点击浮层外部收起浮层", async () => {
    const wrapper = mountSwitcher({
      workspaces: [workspace("w1", "nexterm")],
      activeWorkspaceId: "w1",
    });

    await wrapper.find("[data-workspace-switcher]").trigger("click");
    expect(wrapper.find("[data-workspace-popover]").exists()).toBe(true);

    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.find("[data-workspace-popover]").exists()).toBe(false);
  });
});
