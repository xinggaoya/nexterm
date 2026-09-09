// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import StatusDock from "./StatusDock.vue";

describe("StatusDock.vue", () => {
  it("显示环境徽标、工作区名与 git 分支", () => {
    const wrapper = mount(StatusDock, {
      props: {
        workspaceName: "nexterm",
        env: { kind: "wsl", distro: "Ubuntu" },
        gitBranch: "main",
        runningTasks: 0,
      },
    });

    expect(wrapper.find("[data-status-dock]").text()).toContain("WSL · Ubuntu");
    expect(wrapper.find("[data-status-dock]").text()).toContain("nexterm");
    expect(wrapper.find("[data-status-dock]").text()).toContain("main");
    expect(wrapper.find("[data-running-tasks]").exists()).toBe(false);
  });

  it("有任务运行时显示运行计数", () => {
    const wrapper = mount(StatusDock, {
      props: {
        workspaceName: "nexterm",
        env: { kind: "local" },
        gitBranch: null,
        runningTasks: 2,
      },
    });

    expect(wrapper.find("[data-running-tasks]").text()).toContain("2");
  });
});
