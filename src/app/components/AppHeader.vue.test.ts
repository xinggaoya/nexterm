// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import AppHeader from "./AppHeader.vue";
import type { Tab } from "@/modules/tabs/tabsTypes";

vi.mock("@/components/WindowControls.vue", () => ({
  default: { template: "<div data-window-controls />" },
}));

const tabs: Tab[] = [
  {
    id: 1,
    kind: "terminal",
    title: "shell",
    paneTree: { kind: "leaf", id: 2 },
    activeLeafId: 2,
  },
  {
    id: 3,
    kind: "terminal",
    title: "private",
    private: true,
    paneTree: { kind: "leaf", id: 4 },
    activeLeafId: 4,
  },
];

describe("AppHeader.vue", () => {
  it("emits workbench actions from toolbar controls", async () => {
    const wrapper = mount(AppHeader, {
      props: {
        tabs,
        activeId: 1,
        canSplit: true,
        showWindowControls: true,
      },
    });

    await wrapper.find("[data-new-tab]").trigger("click");
    await wrapper.find("[data-new-private-tab]").trigger("click");
    await wrapper.find("[data-split-row]").trigger("click");
    await wrapper.find("[data-split-col]").trigger("click");
    await wrapper.find("[data-close-active-tab]").trigger("click");
    await wrapper.find("[data-open-settings]").trigger("click");
    await wrapper.find("[data-tab-id='3']").trigger("click");
    await wrapper.find("[data-close-tab-id='3']").trigger("click");

    expect(wrapper.emitted("newTab")).toHaveLength(1);
    expect(wrapper.emitted("newPrivateTab")).toHaveLength(1);
    expect(wrapper.emitted("splitPane")).toEqual([[ "row" ], [ "col" ]]);
    expect(wrapper.emitted("closeActiveTab")).toHaveLength(1);
    expect(wrapper.emitted("openSettings")).toHaveLength(1);
    expect(wrapper.emitted("selectTab")).toEqual([[3]]);
    expect(wrapper.emitted("closeTab")).toEqual([[3]]);
    expect(wrapper.find("[data-window-controls]").exists()).toBe(true);
  });

  it("disables split actions when the active tab cannot split", () => {
    const wrapper = mount(AppHeader, {
      props: {
        tabs,
        activeId: 1,
        canSplit: false,
        showWindowControls: false,
      },
    });

    expect(wrapper.find("[data-split-row]").attributes("disabled")).toBeDefined();
    expect(wrapper.find("[data-split-col]").attributes("disabled")).toBeDefined();
    expect(wrapper.find("[data-window-controls]").exists()).toBe(false);
  });
});
