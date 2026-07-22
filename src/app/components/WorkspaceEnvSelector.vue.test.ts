// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkspaceEnvSelector from "./WorkspaceEnvSelector.vue";
import { useWorkspaceEnvPiniaStore } from "@/modules/workspace/workspaceEnvPinia";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import { resetTouchDeviceCache } from "@/lib/touchDevice";

vi.mock("naive-ui", async () => {
  const { defineComponent } = await vi.importActual<typeof import("vue")>("vue");
  return {
    NButton: defineComponent({
      props: ["disabled", "loading"],
      template:
        "<button :disabled='disabled' :data-loading='loading ? \"true\" : \"false\"'><slot name='icon' /><slot /></button>",
    }),
    NIcon: defineComponent({
      template: "<span><slot /></span>",
    }),
    NDropdown: defineComponent({
      props: ["options", "disabled"],
      emits: ["select"],
      template:
        '<div><slot /><button v-for="option in options" :key="option.key" :disabled="disabled" :data-option-key="option.key" @click="!disabled && $emit(\'select\', option.key)">{{ option.label }}</button></div>',
    }),
    NTooltip: defineComponent({
      template: "<span><slot name='trigger' /><slot /></span>",
    }),
  };
});

vi.mock("@/lib/tauriRuntime", () => ({
  hasTauriInternals: () => false,
}));

vi.mock("@/modules/settings/store", async () => {
  const actual = await vi.importActual<typeof import("@/modules/settings/store")>(
    "@/modules/settings/store",
  );
  return {
    ...actual,
    setLastWslDistro: vi.fn(),
  };
});

describe("WorkspaceEnvSelector.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetTouchDeviceCache();
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: 0,
    });
    delete (window as unknown as Record<string, unknown>).ontouchstart;
  });

  it("renders local workspace and available WSL distros", () => {
    const store = useWorkspaceEnvPiniaStore();
    store.distros = [{ name: "Ubuntu", default: true, running: false }];

    const wrapper = mount(WorkspaceEnvSelector);

    expect(wrapper.text()).toContain("Local");
    expect(wrapper.text()).toContain("Ubuntu");
  });

  it("emits a WSL distro selection through the dropdown", async () => {
    const store = useWorkspaceEnvPiniaStore();
    store.distros = [{ name: "Debian", default: false, running: true }];

    const wrapper = mount(WorkspaceEnvSelector);
    await wrapper.find("[data-option-key='wsl:Debian']").trigger("click");

    expect(wrapper.emitted("select")).toEqual([
      [{ kind: "wsl", distro: "Debian" }],
    ]);
    // 选择器只通过 emit 上报，不直接改动 store 的 pendingEnv。
    expect(store.pendingEnv).toEqual({ kind: "local" });
  });

  it("shows an inline switching state and blocks repeat selections", async () => {
    const store = useWorkspaceEnvPiniaStore();
    store.distros = [{ name: "Ubuntu", default: true, running: false }];

    const wrapper = mount(WorkspaceEnvSelector, {
      props: {
        switching: true,
        switchingEnv: { kind: "wsl", distro: "Ubuntu" },
      },
    });

    const button = wrapper.find("button");
    expect(button.text()).toContain("Switching to Ubuntu");
    expect(button.attributes("disabled")).toBeDefined();
    expect(button.attributes("data-loading")).toBe("true");

    await wrapper.find("[data-option-key='wsl:Ubuntu']").trigger("click");

    expect(wrapper.emitted("select")).toBeUndefined();
  });

  it("uses a larger hit area on touch devices", () => {
    const store = useWorkspaceEnvPiniaStore();
    store.distros = [];
    const prefs = usePreferencesPiniaStore();
    prefs.touchOptimizations = "on";

    const wrapper = mount(WorkspaceEnvSelector);
    const button = wrapper.find("button");

    expect(button.classes()).toContain("h-9");
  });

  it("keeps the default compact hit area on non-touch devices", () => {
    const store = useWorkspaceEnvPiniaStore();
    store.distros = [];
    const prefs = usePreferencesPiniaStore();
    prefs.touchOptimizations = "off";

    const wrapper = mount(WorkspaceEnvSelector);
    const button = wrapper.find("button");

    expect(button.classes()).toContain("h-6");
    expect(button.classes()).not.toContain("h-9");
  });
});
