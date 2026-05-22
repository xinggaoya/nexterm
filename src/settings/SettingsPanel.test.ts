// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { describe, expect, it } from "vitest";
import SettingsPanel from "./SettingsPanel.vue";

describe("SettingsPanel.vue", () => {
  it("defaults to general settings and switches to about without routing", async () => {
    const wrapper = mount(SettingsPanel, {
      global: { plugins: [createPinia()] },
    });

    expect(wrapper.find("[data-settings-panel]").exists()).toBe(true);
    expect(wrapper.find("[data-settings-section='general']").exists()).toBe(true);
    expect(wrapper.find("[data-settings-section='about']").exists()).toBe(false);

    await wrapper.find("[data-settings-tab='about']").trigger("click");

    expect(wrapper.find("[data-settings-section='general']").exists()).toBe(false);
    expect(wrapper.find("[data-settings-section='about']").exists()).toBe(true);
  });
});
