// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { describe, expect, it } from "vitest";
import SettingsPanel from "./SettingsPanel.vue";

describe("SettingsPanel.vue", () => {
  it("defaults to general settings and switches through category navigation", async () => {
    const wrapper = mount(SettingsPanel, {
      global: { plugins: [createPinia()] },
    });

    expect(wrapper.find("[data-settings-panel]").exists()).toBe(true);
    expect(wrapper.find("[data-settings-section='general']").exists()).toBe(true);
    expect(wrapper.find("[data-settings-tab='appearance']").exists()).toBe(true);
    expect(wrapper.find("[data-settings-tab='editor']").exists()).toBe(true);
    expect(wrapper.find("[data-settings-tab='terminal']").exists()).toBe(true);
    expect(wrapper.find("[data-settings-tab='keybindings']").exists()).toBe(true);

    await wrapper.find("[data-settings-tab='terminal']").trigger("click");

    expect(wrapper.find("[data-settings-section='general']").exists()).toBe(false);
    expect(wrapper.find("[data-settings-section='terminal']").exists()).toBe(true);
    expect(wrapper.text()).toContain("Terminal");
    expect(wrapper.text()).not.toContain("Remote terminal");
  });
});
