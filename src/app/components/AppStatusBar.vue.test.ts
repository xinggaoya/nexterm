// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import AppStatusBar from "./AppStatusBar.vue";

vi.mock("./WorkspaceEnvSelector.vue", () => ({
  default: {
    emits: ["select"],
    template:
      "<button data-workspace-env @click=\"$emit('select', { kind: 'wsl', distro: 'Ubuntu' })\">Local</button>",
  },
}));

describe("AppStatusBar.vue", () => {
  it("renders workspace root, terminal cwd, and private terminal state", () => {
    const wrapper = mount(AppStatusBar, {
      props: {
        workspaceRoot: "/repo",
        terminalCwd: "/tmp",
        privateActive: true,
      },
    });

    expect(wrapper.text()).toContain("/repo");
    expect(wrapper.text()).toContain("/tmp");
    expect(wrapper.text()).toContain("Private");
    expect(wrapper.find("[data-workspace-env]").exists()).toBe(true);
    expect(wrapper.find("[data-open-workspace]").exists()).toBe(false);
  });

  it("falls back to no workspace when a root is unavailable", () => {
    const wrapper = mount(AppStatusBar, {
      props: {
        workspaceRoot: null,
        terminalCwd: null,
        privateActive: false,
      },
    });

    expect(wrapper.text()).toContain("No workspace");
    expect(wrapper.text()).not.toContain("Private");
  });

  it("forwards workspace environment selections", async () => {
    const wrapper = mount(AppStatusBar, {
      props: {
        workspaceRoot: null,
        terminalCwd: null,
        privateActive: false,
      },
    });

    await wrapper.find("[data-workspace-env]").trigger("click");

    expect(wrapper.emitted("workspaceChange")).toEqual([
      [{ kind: "wsl", distro: "Ubuntu" }],
    ]);
  });

});
