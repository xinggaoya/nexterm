// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { describe, expect, it } from "vitest";
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

  it("搜索位发出 open-command-palette,设置行发出 open-settings", async () => {
    const wrapper = mountSidebar();

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
