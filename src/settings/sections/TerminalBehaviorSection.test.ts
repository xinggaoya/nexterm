// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { NSelect, NSwitch } from "naive-ui";
import { createPinia, type Pinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, setI18nLanguage } from "@/modules/i18n";
import { setPreference } from "@/modules/settings/store";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import TerminalBehaviorSection from "./TerminalBehaviorSection.vue";

vi.mock("@/modules/settings/store", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/modules/settings/store")>();
  return {
    ...mod,
    setPreference: vi.fn().mockResolvedValue(undefined),
  };
});

describe("TerminalBehaviorSection.vue", () => {
  let pinia: Pinia;
  beforeEach(() => {
    setI18nLanguage("en-US");
    pinia = createPinia();
  });

  it("回滚行数选择器默认 2000 且包含预设档位", () => {
    const wrapper = mount(TerminalBehaviorSection, {
      global: { plugins: [pinia, i18n] },
    });
    const scrollback = wrapper
      .findAllComponents(NSelect)
      .find((s) => s.props("value") === 2000);
    expect(scrollback).toBeTruthy();
    const options = scrollback!.props("options") as Array<{ value: number }>;
    expect(options.map((o) => o.value)).toContain(5000);
    expect(options.map((o) => o.value)).toContain(25_000);
  });

  it("切换回滚档位会乐观更新 store（含 clamp 路径）", async () => {
    const wrapper = mount(TerminalBehaviorSection, {
      global: { plugins: [pinia, i18n] },
    });
    const prefs = usePreferencesPiniaStore(pinia);
    const scrollback = wrapper
      .findAllComponents(NSelect)
      .find((s) => s.props("value") === 2000);
    await scrollback!.vm.$emit("update:value", "10000");
    expect(prefs.terminalScrollback).toBe(10_000);
  });

  it("滚动加速修饰键默认 alt", () => {
    const wrapper = mount(TerminalBehaviorSection, {
      global: { plugins: [pinia, i18n] },
    });
    const modifier = wrapper
      .findAllComponents(NSelect)
      .find((s) => s.props("value") === "alt");
    expect(modifier).toBeTruthy();
  });

  it("终端通知开关默认开启，关闭后走 updateTerminalNotificationEnabled", async () => {
    const wrapper = mount(TerminalBehaviorSection, {
      global: { plugins: [pinia, i18n] },
    });
    const prefs = usePreferencesPiniaStore(pinia);
    expect(prefs.terminalNotificationEnabled).toBe(true);

    // 按表单项标签文本定位（同名值开关太多，不能按 value 查找）。
    const item = wrapper
      .findAll(".n-form-item")
      .find((el) => el.text().includes("Terminal notifications"));
    expect(item).toBeTruthy();
    const notification = item!.findComponent(NSwitch);
    expect(notification).toBeTruthy();
    await notification.vm.$emit("update:value", false);
    expect(prefs.terminalNotificationEnabled).toBe(false);
    // 持久化路径以新 key + 关闭值触达 store 插件。
    expect(vi.mocked(setPreference)).toHaveBeenCalledWith(
      "terminalNotificationEnabled",
      false,
    );
  });
});
