// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { NSelect } from "naive-ui";
import { createPinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { applyLanguagePreference, i18n, setI18nLanguage } from "@/modules/i18n";
import GeneralSection from "./GeneralSection.vue";

describe("GeneralSection.vue", () => {
  beforeEach(() => {
    setI18nLanguage("en-US");
  });

  it("renders language preference options in the appearance section", () => {
    const wrapper = mount(GeneralSection, {
      global: { plugins: [createPinia(), i18n] },
    });

    const languageSelect = wrapper
      .findAllComponents(NSelect)
      .find((select) =>
        (select.props("options") as Array<{ value: string }> | undefined)?.some(
          (option) => option.value === "zh-CN",
        ),
      );

    expect(languageSelect).toBeTruthy();
    expect(languageSelect?.props("value")).toBe("system");
    expect(languageSelect?.props("options")).toEqual([
      { label: "System", value: "system" },
      { label: "Simplified Chinese", value: "zh-CN" },
      { label: "English", value: "en-US" },
    ]);
  });

  it("renders terminal font family as a preset-only select", () => {
    const wrapper = mount(GeneralSection, {
      global: { plugins: [createPinia(), i18n] },
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

  it("renders remote terminal controls in the terminal section", () => {
    const wrapper = mount(GeneralSection, {
      global: { plugins: [createPinia(), i18n] },
    });

    expect(wrapper.text()).toContain("Remote terminal");
    expect(wrapper.text()).toContain("Local and LAN web access");
  });

  it("renders translated labels after switching to Simplified Chinese", async () => {
    await applyLanguagePreference("zh-CN");

    const wrapper = mount(GeneralSection, {
      global: { plugins: [createPinia(), i18n] },
    });

    expect(wrapper.text()).toContain("通用");
    expect(wrapper.text()).toContain("语言");
    expect(wrapper.text()).toContain("终端");
  });
});
