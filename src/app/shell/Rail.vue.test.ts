// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { describe, expect, it } from "vitest";
import type { WorkspaceInstance } from "@/modules/workspace";

import Rail from "./Rail.vue";

function workspace(id: string, name: string, env: WorkspaceInstance["env"] = { kind: "local" }): WorkspaceInstance {
  return { id, rootPath: `/repo/${name}`, env, name, openedAt: 1 };
}

function mountRail(props: Partial<InstanceType<typeof Rail>["$props"]> = {}) {
  return mount(Rail, {
    props: {
      workspaces: [],
      activeWorkspaceId: null,
      explorerOpen: false,
      sourceControlOpen: false,
      tasksOpen: false,
      ...props,
    },
    global: { plugins: [createPinia()] },
  });
}

describe("Rail.vue", () => {
  it("为每个打开的工作区渲染一枚芯片,monogram 取名称首字母", () => {
    const wrapper = mountRail({
      workspaces: [workspace("w1", "nexterm"), workspace("w2", "blog", { kind: "wsl", distro: "Ubuntu" })],
      activeWorkspaceId: "w2",
    });

    const chips = wrapper.findAll("[data-workspace-chip]");
    expect(chips).toHaveLength(2);
    expect(chips[0]?.text()).toBe("N");
    expect(chips[1]?.text()).toBe("B");
    // 活动芯片 aria-pressed=true;WSL 芯片带 env 角标。
    expect(chips[0]?.attributes("aria-pressed")).toBe("false");
    expect(chips[1]?.attributes("aria-pressed")).toBe("true");
    expect(wrapper.find("[data-workspace-chip='w2'] .bg-info").exists()).toBe(true);
  });

  it("点击芯片切换工作区,中键关闭工作区", async () => {
    const wrapper = mountRail({
      workspaces: [workspace("w1", "nexterm")],
      activeWorkspaceId: "w1",
    });

    await wrapper.find("[data-workspace-chip='w1']").trigger("click");
    expect(wrapper.emitted("select-workspace")).toEqual([["w1"]]);

    // jsdom 的 MouseEvent 属性只读,中键用构造器注入。
    wrapper
      .find("[data-workspace-chip='w1']")
      .element.dispatchEvent(
        new MouseEvent("auxclick", { button: 1, bubbles: true }),
      );
    expect(wrapper.emitted("close-workspace")).toEqual([["w1"]]);
  });

  it("工具键 aria-pressed 跟随浮层状态,点击发出 toggle-tool", async () => {
    const wrapper = mountRail({ explorerOpen: true });

    const explorerToggle = wrapper.find("[data-toggle-tool='explorer']");
    expect(explorerToggle.attributes("aria-pressed")).toBe("true");
    await explorerToggle.trigger("click");
    expect(wrapper.emitted("toggle-tool")).toEqual([["explorer"]]);

    const gitToggle = wrapper.find("[data-toggle-tool='sourceControl']");
    expect(gitToggle.attributes("aria-pressed")).toBe("false");
  });

  it("底部的命令面板与设置入口发出对应事件", async () => {
    const wrapper = mountRail();

    await wrapper.find("[data-open-command-palette]").trigger("click");
    expect(wrapper.emitted("open-command-palette")).toHaveLength(1);

    await wrapper.find("[data-open-settings]").trigger("click");
    expect(wrapper.emitted("open-settings")).toHaveLength(1);
  });

  it("添加工作区按钮存在(菜单选项由 NDropdown 托管)", () => {
    const wrapper = mountRail();
    expect(wrapper.find("[data-add-workspace]").exists()).toBe(true);
  });
});
