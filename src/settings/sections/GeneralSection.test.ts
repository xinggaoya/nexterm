// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { NSelect } from "naive-ui";
import { createPinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyLanguagePreference, i18n, setI18nLanguage } from "@/modules/i18n";
import AppearanceSection from "./AppearanceSection.vue";
import GeneralSection from "./GeneralSection.vue";
import TerminalSection from "./TerminalSection.vue";

const { nativeMock } = vi.hoisted(() => ({
  nativeMock: {
    devtoolsAvailable: vi.fn(async () => true),
    isDevtoolsOpen: vi.fn(async () => false),
    toggleDevtools: vi.fn(async () => true),
    crabnebulaDevtoolsAvailable: vi.fn(async () => false),
    toggleCrabnebulaDevtools: vi.fn(async () => undefined),
  },
}));

vi.mock("@/lib/native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/native")>();
  return {
    ...actual,
    native: {
      ...actual.native,
      ...nativeMock,
    },
  };
});

vi.mock("@/lib/tauriRuntime", () => ({
  hasTauriInternals: () => true,
}));

describe("GeneralSection.vue", () => {
  beforeEach(() => {
    setI18nLanguage("en-US");
    nativeMock.devtoolsAvailable.mockResolvedValue(true);
    nativeMock.crabnebulaDevtoolsAvailable.mockResolvedValue(false);
    nativeMock.isDevtoolsOpen.mockResolvedValue(false);
    vi.clearAllMocks();
  });

  it("renders language preference options in the appearance section", () => {
    const wrapper = mount(AppearanceSection, {
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

  it("keeps removed remote terminal controls out of general settings", () => {
    const wrapper = mount(GeneralSection, {
      global: { plugins: [createPinia(), i18n] },
    });

    expect(wrapper.text()).not.toContain("Remote terminal");
    expect(wrapper.text()).not.toContain("Local and LAN web access");
  });

  it("renders terminal font family as a preset-only select", () => {
    const wrapper = mount(TerminalSection, {
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

  it("renders translated labels after switching to Simplified Chinese", async () => {
    await applyLanguagePreference("zh-CN");

    const wrapper = mount(GeneralSection, {
      global: { plugins: [createPinia(), i18n] },
    });

    expect(wrapper.text()).toContain("通用");
    expect(wrapper.text()).toContain("恢复窗口");
    expect(wrapper.text()).toContain("显示隐藏文件");
  });

  it("offers the backend DevTools entry only when the integration is available", async () => {
    nativeMock.crabnebulaDevtoolsAvailable.mockResolvedValue(false);

    const unavailable = mount(GeneralSection, {
      global: { plugins: [createPinia(), i18n] },
    });
    await flushPromises();

    // 不可用时不渲染这一行：与其留一个点了就报错的按钮，不如整行不出现。
    expect(unavailable.find("[data-open-backend-devtools]").exists()).toBe(
      false,
    );

    nativeMock.crabnebulaDevtoolsAvailable.mockResolvedValue(true);
    const wrapper = mount(GeneralSection, {
      global: { plugins: [createPinia(), i18n] },
    });
    await flushPromises();

    const button = wrapper.find("[data-open-backend-devtools]");
    expect(button.exists()).toBe(true);
    expect(button.attributes("disabled")).toBeUndefined();

    await button.trigger("click");
    expect(nativeMock.toggleCrabnebulaDevtools).toHaveBeenCalledTimes(1);
  });
});
