// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import TabContextMenu from "./TabContextMenu.vue";
import type { Tab } from "@/modules/tabs/tabsTypes";

const baseTarget = {
  x: 10,
  y: 20,
  index: 0,
  total: 2,
};

const terminalTab: Tab = {
  id: 1,
  kind: "terminal",
  title: "shell",
  paneTree: { kind: "leaf", id: 2 },
  activeLeafId: 2,
};

const editorTab: Tab = {
  id: 2,
  kind: "editor",
  title: "README.md",
  path: "/repo/README.md",
  dirty: false,
  preview: true,
};

describe("TabContextMenu", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders close / close others / close right / close all for multi-tab targets", () => {
    const wrapper = mount(TabContextMenu, {
      props: { target: { ...baseTarget, tab: editorTab }, rootPath: "/repo" },
      attachTo: document.body,
    });

    expect(wrapper.find("[data-menu-action='close']").exists()).toBe(true);
    expect(wrapper.find("[data-menu-action='close-others']").exists()).toBe(true);
    expect(wrapper.find("[data-menu-action='close-right']").exists()).toBe(true);
    expect(wrapper.find("[data-menu-action='close-all']").exists()).toBe(true);
    wrapper.unmount();
  });

  it("hides close others / close right / close all when only one tab is open", () => {
    const wrapper = mount(TabContextMenu, {
      props: { target: { ...baseTarget, total: 1, tab: editorTab }, rootPath: "/repo" },
      attachTo: document.body,
    });

    expect(wrapper.find("[data-menu-action='close-others']").exists()).toBe(false);
    expect(wrapper.find("[data-menu-action='close-right']").exists()).toBe(false);
    expect(wrapper.find("[data-menu-action='close-all']").exists()).toBe(false);
    wrapper.unmount();
  });

  it("shows terminal-specific actions only for terminal tabs", () => {
    const termWrapper = mount(TabContextMenu, {
      props: { target: { ...baseTarget, tab: terminalTab }, rootPath: null },
      attachTo: document.body,
    });
    expect(termWrapper.find("[data-menu-action='duplicate']").exists()).toBe(true);
    expect(termWrapper.find("[data-menu-action='rename']").exists()).toBe(true);
    expect(termWrapper.find("[data-menu-action='pin']").exists()).toBe(false);
    termWrapper.unmount();

    const edWrapper = mount(TabContextMenu, {
      props: { target: { ...baseTarget, tab: editorTab }, rootPath: "/repo" },
      attachTo: document.body,
    });
    expect(edWrapper.find("[data-menu-action='duplicate']").exists()).toBe(false);
    expect(edWrapper.find("[data-menu-action='rename']").exists()).toBe(false);
    expect(edWrapper.find("[data-menu-action='pin']").exists()).toBe(true);
    edWrapper.unmount();
  });

  it("emits close / close-others / close-right / close-all with the right tab id", async () => {
    const wrapper = mount(TabContextMenu, {
      props: { target: { ...baseTarget, tab: editorTab }, rootPath: "/repo" },
      attachTo: document.body,
    });

    await wrapper.find("[data-menu-action='close']").trigger("click");
    expect(wrapper.emitted("closeTab")).toEqual([[2]]);

    await wrapper.find("[data-menu-action='close-others']").trigger("click");
    expect(wrapper.emitted("closeOthers")).toEqual([[2]]);

    await wrapper.find("[data-menu-action='close-right']").trigger("click");
    expect(wrapper.emitted("closeToRight")).toEqual([[2]]);

    await wrapper.find("[data-menu-action='close-all']").trigger("click");
    expect(wrapper.emitted("closeAll")).toBeDefined();
    wrapper.unmount();
  });

  it("emits duplicate / rename for terminal tabs and pin for editor preview tabs", async () => {
    const wrapper = mount(TabContextMenu, {
      props: { target: { ...baseTarget, tab: terminalTab }, rootPath: null },
      attachTo: document.body,
    });
    await wrapper.find("[data-menu-action='duplicate']").trigger("click");
    expect(wrapper.emitted("duplicateTerminal")).toEqual([[1]]);
    await wrapper.find("[data-menu-action='rename']").trigger("click");
    expect(wrapper.emitted("requestRename")).toEqual([[1]]);
    wrapper.unmount();

    const edWrapper = mount(TabContextMenu, {
      props: { target: { ...baseTarget, tab: editorTab }, rootPath: "/repo" },
      attachTo: document.body,
    });
    await edWrapper.find("[data-menu-action='pin']").trigger("click");
    expect(edWrapper.emitted("pinEditor")).toEqual([[2]]);
    edWrapper.unmount();
  });
});
