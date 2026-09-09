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
      },
    });

    expect(wrapper.find("[data-status-dock]").text()).toContain("WSL · Ubuntu");
    expect(wrapper.find("[data-status-dock]").text()).toContain("nexterm");
    expect(wrapper.find("[data-status-dock]").text()).toContain("main");
  });
});
