// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, setI18nLanguage } from "@/modules/i18n";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import {
  ACCENT_PRESETS,
  ACCENT_PRESET_LABELS,
  type AccentPref,
} from "@/modules/settings/store";
import AppearanceSection from "./AppearanceSection.vue";

vi.mock("@/modules/settings/store", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/modules/settings/store")>();
  return {
    ...mod,
    setPreference: vi.fn().mockResolvedValue(undefined),
  };
});

describe("AppearanceSection.vue", () => {
  beforeEach(() => {
    setI18nLanguage("en-US");
  });

  it("renders one accent swatch per preset with cyan selected by default", () => {
    const pinia = createPinia();
    const wrapper = mount(AppearanceSection, {
      global: { plugins: [pinia, i18n] },
    });

    const swatches = wrapper.findAll(
      '[data-testid^="accent-"]',
    );
    expect(swatches).toHaveLength(ACCENT_PRESETS.length);

    for (const preset of ACCENT_PRESETS) {
      const button = wrapper.find(`[data-testid="accent-${preset}"]`);
      expect(button.exists()).toBe(true);
      expect(button.text()).toContain(ACCENT_PRESET_LABELS[preset]);
    }

    const active = wrapper.find(`[data-testid="accent-cyan"]`);
    expect(active.attributes("aria-pressed")).toBe("true");
  });

  it("calls updateAccent when a non-default preset is clicked", async () => {
    const pinia = createPinia();
    const wrapper = mount(AppearanceSection, {
      global: { plugins: [pinia, i18n] },
    });

    const prefs = usePreferencesPiniaStore(pinia);
    const updateSpy = vi.spyOn(prefs, "updateAccent");

    const target: AccentPref = "violet";
    await wrapper.find(`[data-testid="accent-${target}"]`).trigger("click");

    expect(updateSpy).toHaveBeenCalledWith(target);
  });
});