// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { NSelect } from "naive-ui";
import { createPinia } from "pinia";
import { describe, expect, it } from "vitest";
import GeneralSection from "./GeneralSection.vue";

describe("GeneralSection.vue", () => {
  it("renders terminal font family as a preset-only select", () => {
    const wrapper = mount(GeneralSection, {
      global: { plugins: [createPinia()] },
    });

    const fontSelect = wrapper
      .findAllComponents(NSelect)
      .find((select) => select.props("value") === "");

    expect(fontSelect).toBeTruthy();
    expect(fontSelect?.props("tag")).not.toBe(true);
    expect(fontSelect?.props("options")).toEqual(
      expect.arrayContaining([
        { label: "Auto detect", value: "" },
        { label: "JetBrains Mono", value: "JetBrains Mono" },
        { label: "Fira Code", value: "Fira Code" },
      ]),
    );
  });
});
