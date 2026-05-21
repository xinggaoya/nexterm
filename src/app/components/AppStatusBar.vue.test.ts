// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import AppStatusBar from "./AppStatusBar.vue";

vi.mock("./WorkspaceEnvSelector.vue", () => ({
  default: { template: "<button data-workspace-env>Local</button>" },
}));

describe("AppStatusBar.vue", () => {
  it("renders cwd and private terminal state", () => {
    const wrapper = mount(AppStatusBar, {
      props: {
        cwd: "/repo",
        privateActive: true,
      },
    });

    expect(wrapper.text()).toContain("/repo");
    expect(wrapper.text()).toContain("Private");
    expect(wrapper.find("[data-workspace-env]").exists()).toBe(true);
  });

  it("falls back to local workspace when cwd is unavailable", () => {
    const wrapper = mount(AppStatusBar, {
      props: {
        cwd: null,
        privateActive: false,
      },
    });

    expect(wrapper.text()).toContain("local workspace");
    expect(wrapper.text()).not.toContain("Private");
  });
});
