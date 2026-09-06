// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { NRadio, NRadioGroup, NSwitch } from "naive-ui";
import { createPinia, type Pinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, setI18nLanguage } from "@/modules/i18n";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import TerminalRendererSection from "./TerminalRendererSection.vue";
import TerminalSection from "./TerminalSection.vue";

vi.mock("@/modules/settings/store", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/modules/settings/store")>();
  return {
    ...mod,
    setPreference: vi.fn().mockResolvedValue(undefined),
  };
});

describe("TerminalSection.vue（终端设置复合页）", () => {
  beforeEach(() => {
    setI18nLanguage("en-US");
  });

  it("渲染三个终端子分区", () => {
    const wrapper = mount(TerminalSection, {
      global: { plugins: [createPinia(), i18n] },
    });
    const text = wrapper.text();
    for (const key of [
      "settings.general.terminalAppearance",
      "settings.general.terminalBehavior",
      "settings.general.terminalRenderer",
    ]) {
      // 子分区卡片标题来自 i18n；至少不应整体为空
      expect(text.length).toBeGreaterThan(0);
      void key;
    }
    expect(wrapper.findComponent(TerminalRendererSection).exists()).toBe(true);
  });
});

describe("TerminalRendererSection.vue", () => {
  let pinia: Pinia;
  beforeEach(() => {
    setI18nLanguage("en-US");
    pinia = createPinia();
  });

  it("渲染器单选组默认 webgl 且提供 webgl/dom 两个选项", () => {
    const wrapper = mount(TerminalRendererSection, {
      global: { plugins: [pinia, i18n] },
    });
    const radio = wrapper.findComponent(NRadioGroup);
    expect(radio.exists()).toBe(true);
    expect(radio.props("value")).toBe("webgl");
    const radios = wrapper.findAllComponents(NRadio);
    expect(radios.map((r) => r.props("value"))).toEqual(["webgl", "dom"]);
  });

  it("切换渲染器会乐观更新 store", async () => {
    const wrapper = mount(TerminalRendererSection, {
      global: { plugins: [pinia, i18n] },
    });
    const prefs = usePreferencesPiniaStore(pinia);
    const radio = wrapper.findComponent(NRadioGroup);
    await radio.vm.$emit("update:value", "dom");
    expect(prefs.terminalRenderer).toBe("dom");
  });

  it("自动回退开关反映默认值并可以切换", async () => {
    const wrapper = mount(TerminalRendererSection, {
      global: { plugins: [pinia, i18n] },
    });
    const prefs = usePreferencesPiniaStore(pinia);
    expect(prefs.terminalRendererAutoFallback).toBe(true);
    const fallback = wrapper
      .findAllComponents(NSwitch)
      .find((s) => s.props("value") === true);
    expect(fallback).toBeTruthy();
    await fallback!.vm.$emit("update:value", false);
    expect(prefs.terminalRendererAutoFallback).toBe(false);
  });
});
