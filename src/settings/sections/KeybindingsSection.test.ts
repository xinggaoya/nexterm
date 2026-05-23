// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, setI18nLanguage } from "@/modules/i18n";
import type { CommandId } from "@/modules/commands";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import KeybindingsSection from "./KeybindingsSection.vue";

describe("KeybindingsSection.vue", () => {
  beforeEach(() => {
    setI18nLanguage("en-US");
  });

  it("renders core commands and records custom shortcuts", async () => {
    const pinia = createPinia();
    const prefs = usePreferencesPiniaStore(pinia);
    const updateCommandKeybinding = vi.fn(
      async (id: CommandId, keybinding: string | null | undefined) => {
        if (keybinding === undefined) {
          const { [id]: _removed, ...rest } = prefs.keybindings;
          prefs.keybindings = rest;
          return;
        }
        prefs.keybindings = { ...prefs.keybindings, [id]: keybinding };
      },
    );
    (prefs as unknown as { updateCommandKeybinding: typeof updateCommandKeybinding })
      .updateCommandKeybinding = updateCommandKeybinding;

    const wrapper = mount(KeybindingsSection, {
      global: { plugins: [pinia, i18n] },
    });

    expect(wrapper.text()).toContain("Keyboard shortcuts");
    expect(wrapper.text()).toContain("Command Center");
    expect(wrapper.text()).toContain("New Terminal");

    await wrapper
      .find("[data-keybinding-input='terminal.new']")
      .trigger("keydown", {
        key: "`",
        ctrlKey: true,
      });

    expect(updateCommandKeybinding).toHaveBeenCalledWith("terminal.new", "Mod+`");
  });

  it("shows conflicts and restores command defaults", async () => {
    const pinia = createPinia();
    const prefs = usePreferencesPiniaStore(pinia);
    prefs.keybindings = { "workbench.quickOpen.open": "Mod+K" };
    const updateCommandKeybinding = vi.fn(
      async (id: CommandId, keybinding: string | null | undefined) => {
        if (keybinding === undefined) {
          const { [id]: _removed, ...rest } = prefs.keybindings;
          prefs.keybindings = rest;
        }
      },
    );
    (prefs as unknown as { updateCommandKeybinding: typeof updateCommandKeybinding })
      .updateCommandKeybinding = updateCommandKeybinding;

    const wrapper = mount(KeybindingsSection, {
      global: { plugins: [pinia, i18n] },
    });

    expect(wrapper.text()).toContain("Shortcut conflict");

    await wrapper
      .find("[data-keybinding-reset='workbench.quickOpen.open']")
      .trigger("click");

    expect(updateCommandKeybinding).toHaveBeenCalledWith(
      "workbench.quickOpen.open",
      undefined,
    );
  });
});
