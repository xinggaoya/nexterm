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
      panelTab: "explorer",
      panelVisible: true,
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

  it("面板控制簇:分段控件按当前标签高亮", () => {
    const wrapper = mountTopBar({ panelTab: "changes" });

    expect(wrapper.find("[data-panel-tab-switch]").exists()).toBe(true);
    expect(wrapper.find("[data-panel-tab='changes']").attributes("aria-pressed")).toBe(
      "true",
    );
    expect(wrapper.find("[data-panel-tab='explorer']").attributes("aria-pressed")).toBe(
      "false",
    );
  });

  it("点击分段控件发出 update:panel-tab", async () => {
    const wrapper = mountTopBar({ panelTab: "explorer" });

    await wrapper.find("[data-panel-tab='changes']").trigger("click");

    expect(wrapper.emitted("update:panel-tab")).toEqual([["changes"]]);
  });

  it("折叠按钮发出 toggle-panel,aria-pressed 反映面板可见性", async () => {
    const wrapper = mountTopBar({ panelVisible: false });

    const toggle = wrapper.find("[data-toggle-panel]");
    expect(toggle.attributes("aria-pressed")).toBe("false");

    await toggle.trigger("click");
    expect(wrapper.emitted("toggle-panel")).toHaveLength(1);
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
