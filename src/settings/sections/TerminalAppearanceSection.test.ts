// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { NSelect, NSwitch } from "naive-ui";
import { createPinia, type Pinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, setI18nLanguage } from "@/modules/i18n";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import TerminalAppearanceSection from "./TerminalAppearanceSection.vue";

vi.mock("@/modules/settings/store", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/modules/settings/store")>();
  return {
    ...mod,
    setPreference: vi.fn().mockResolvedValue(undefined),
  };
});

describe("TerminalAppearanceSection.vue", () => {
  let pinia: Pinia;
  beforeEach(() => {
    setI18nLanguage("en-US");
    pinia = createPinia();
  });

  it("字体选择器默认 autoDetect（空串），并包含常见字体预设", () => {
    const wrapper = mount(TerminalAppearanceSection, {
      global: { plugins: [pinia, i18n] },
    });
    const select = wrapper.findComponent(NSelect);
    expect(select.exists()).toBe(true);
    expect(select.props("value")).toBe("");
    const options = select.props("options") as Array<{ value: string }>;
    const values = options.map((o) => o.value);
    expect(values).toContain("");
    expect(values).toContain("JetBrains Mono");
  });

  it("字体开关（nerd font / CJK / emoji）默认全开且可切换", async () => {
    const wrapper = mount(TerminalAppearanceSection, {
      global: { plugins: [pinia, i18n] },
    });
    const prefs = usePreferencesPiniaStore(pinia);
    expect(prefs.terminalNerdFontEnabled).toBe(true);
    expect(prefs.terminalCjkFontEnabled).toBe(true);
    expect(prefs.terminalEmojiFontEnabled).toBe(true);

    const switches = wrapper.findAllComponents(NSwitch);
    expect(switches.length).toBeGreaterThanOrEqual(3);
    await switches[0].vm.$emit("update:value", false);
    expect(prefs.terminalNerdFontEnabled).toBe(false);
  });

  it("字号反映默认值 14，切换字重会乐观更新 store", async () => {
    const wrapper = mount(TerminalAppearanceSection, {
      global: { plugins: [pinia, i18n] },
    });
    const prefs = usePreferencesPiniaStore(pinia);
    expect(prefs.terminalFontSize).toBe(14);

    const weightSelect = wrapper
      .findAllComponents(NSelect)
      .find((s) => s.props("value") === 400);
    expect(weightSelect).toBeTruthy();
    await weightSelect!.vm.$emit("update:value", 700);
    expect(prefs.terminalFontWeight).toBe(700);
  });
});
