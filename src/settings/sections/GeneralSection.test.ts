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
        { label: "Cascadia Mono", value: "Cascadia Mono" },
        { label: "Consolas", value: "Consolas" },
        { label: "Menlo", value: "Menlo" },
        { label: "Source Code Pro", value: "Source Code Pro" },
        { label: "Ubuntu Mono", value: "Ubuntu Mono" },
        { label: "Roboto Mono", value: "Roboto Mono" },
        { label: "IBM Plex Mono", value: "IBM Plex Mono" },
        { label: "Monaspace Neon", value: "Monaspace Neon" },
        { label: "Maple Mono NF", value: "Maple Mono NF" },
      ]),
    );
  });
});
