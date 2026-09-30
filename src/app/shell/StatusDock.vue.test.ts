// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import StatusDock from "./StatusDock.vue";

const baseProps = {
  workspaceName: "nexterm",
  env: { kind: "local" as const },
  gitBranch: "main",
};

describe("StatusDock.vue", () => {
  it("显示环境徽标、工作区名与 git 分支", () => {
    const wrapper = mount(StatusDock, {
      props: {
        ...baseProps,
        env: { kind: "wsl", distro: "Ubuntu" },
      },
    });

    expect(wrapper.find("[data-status-dock]").text()).toContain("WSL · Ubuntu");
    expect(wrapper.find("[data-status-dock]").text()).toContain("nexterm");
    expect(wrapper.find("[data-status-dock]").text()).toContain("main");
  });

  it("没有活动终端时右半边不占位", () => {
    // 此前右侧整片空着（justify-between 却只有一个子元素），24px 高的常驻条
    // 白白占位置。没有内容时就不该渲染占位符。
    const wrapper = mount(StatusDock, { props: { ...baseProps } });
    expect(wrapper.find("[data-status-dock-right]").exists()).toBe(false);
  });

  it("活动终端时显示尺寸、渲染器与会话异常状态", () => {
    // cols×rows 决定 TUI 工具的布局；renderer 是实际生效的那个（WebGL 可能
    // 已静默回退到 DOM，字形与抗锯齿都会变）。
    const wrapper = mount(StatusDock, {
      props: {
        ...baseProps,
        terminalSize: { cols: 120, rows: 30 },
        renderer: "dom",
        sessionState: "exited",
      },
    });

    expect(wrapper.get("[data-dock-size]").text()).toBe("120×30");
    expect(wrapper.get("[data-dock-renderer]").text()).toBe("DOM");
    expect(wrapper.get("[data-dock-session]").text()).toContain("exited");
  });

  it("运行中的会话不显示异常状态徽标", () => {
    const wrapper = mount(StatusDock, {
      props: {
        ...baseProps,
        terminalSize: { cols: 80, rows: 24 },
        renderer: "webgl",
        sessionState: "running",
      },
    });

    expect(wrapper.get("[data-dock-renderer]").text()).toBe("WebGL");
    expect(wrapper.find("[data-dock-session]").exists()).toBe(false);
  });
});
