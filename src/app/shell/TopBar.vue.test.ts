// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceInstance } from "@/modules/workspace";

import TopBar from "./TopBar.vue";

const startDragging = vi.fn(async () => {});
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ startDragging }),
}));

function workspace(id: string, name: string): WorkspaceInstance {
  return { id, rootPath: `/repo/${name}`, env: { kind: "local" }, name, openedAt: 1 };
}

function mountTopBar(
  props: Partial<InstanceType<typeof TopBar>["$props"]> = {},
) {
  return mount(TopBar, {
    props: {
      workspaceName: "nexterm",
      workspacePath: "/repo/nexterm",
      env: { kind: "local" },
      gitBranch: "master",
      showWindowControls: false,
      canSplit: true,
      workspaces: [],
      activeWorkspaceId: null,
      panelLayout: { left: "explorer", right: "changes" },
      leftPanelOpen: true,
      rightPanelOpen: true,
      ...props,
    },
    global: { plugins: [createPinia()] },
  });
}

describe("TopBar.vue", () => {
  it("左端渲染工作区切换器", () => {
    const wrapper = mountTopBar({
      workspaces: [workspace("w1", "nexterm")],
      activeWorkspaceId: "w1",
    });

    expect(wrapper.find("[data-workspace-switcher]").exists()).toBe(true);
  });

  it("左右两侧各有一个面板控制簇", () => {
    const wrapper = mountTopBar();

    expect(wrapper.find("[data-panel-cluster-side='left']").exists()).toBe(true);
    expect(wrapper.find("[data-panel-cluster-side='right']").exists()).toBe(true);
  });

  it("左侧控制簇按左侧面板的视图高亮", () => {
    const wrapper = mountTopBar({
      panelLayout: { left: "changes", right: "explorer" },
      leftPanelOpen: true,
      rightPanelOpen: true,
    });

    const left = wrapper.find("[data-panel-cluster-side='left']");
    expect(left.find("[data-panel-tab='changes']").attributes("aria-pressed")).toBe(
      "true",
    );
    expect(left.find("[data-panel-tab='explorer']").attributes("aria-pressed")).toBe(
      "false",
    );

    const right = wrapper.find("[data-panel-cluster-side='right']");
    expect(right.find("[data-panel-tab='explorer']").attributes("aria-pressed")).toBe(
      "true",
    );
  });

  it("左侧控制簇改视图只上抛布局变更", async () => {
    const wrapper = mountTopBar();

    await wrapper
      .find("[data-panel-cluster-side='left'] [data-panel-tab='changes']")
      .trigger("click");

    expect(wrapper.emitted("update:panel-layout")).toEqual([
      [{ left: "changes", right: "explorer" }],
    ]);
  });

  it("两侧折叠按钮各自上抛", async () => {
    const wrapper = mountTopBar();

    await wrapper
      .find("[data-panel-cluster-side='right'] [data-toggle-panel]")
      .trigger("click");
    await wrapper
      .find("[data-panel-cluster-side='left'] [data-toggle-panel]")
      .trigger("click");

    expect(wrapper.emitted("toggle:right-panel")).toHaveLength(1);
    expect(wrapper.emitted("toggle:left-panel")).toHaveLength(1);
  });

  it("按在工作区切换器上不触发窗口拖动", async () => {
    startDragging.mockClear();
    const wrapper = mountTopBar({
      workspaces: [workspace("w1", "nexterm")],
      activeWorkspaceId: "w1",
    });

    // 落在切换器根容器（data-no-drag）的空白处：不应拖动窗口。
    wrapper.find("[data-no-drag]").element.dispatchEvent(
      new MouseEvent("pointerdown", { button: 0, bubbles: true }),
    );
    expect(startDragging).not.toHaveBeenCalled();

    // 落在顶栏空白处：应当拖动窗口。
    wrapper.find("[data-top-bar]").element.dispatchEvent(
      new MouseEvent("pointerdown", { button: 0, bubbles: true }),
    );
    expect(startDragging).toHaveBeenCalledTimes(1);
  });
});
