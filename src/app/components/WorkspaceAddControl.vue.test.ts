// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkspaceAddControl from "./WorkspaceAddControl.vue";
import { LOCAL_WORKSPACE } from "@/modules/workspace/workspaceEnvSnapshot";
import { useWorkspaceEnvPiniaStore } from "@/modules/workspace/workspaceEnvPinia";

const platformMock = vi.hoisted(() => ({
  isWindows: true,
}));

vi.mock("@/lib/platform", () => ({
  get IS_WINDOWS() {
    return platformMock.isWindows;
  },
}));

vi.mock("naive-ui", async () => {
  const { defineComponent, h } = await vi.importActual<typeof import("vue")>("vue");
  return {
    NDropdown: defineComponent({
      props: ["options"],
      emits: ["select"],
      template:
        '<div><slot /><button v-for="option in options" :key="option.key" :data-wsl-option="option.key" @click="$emit(\'select\', option.key)">{{ option.label }}</button></div>',
    }),
    NIcon: defineComponent({
      template: "<span><slot /></span>",
    }),
    NButton: defineComponent({
      name: "NButton",
      emits: ["click"],
      setup(_, { slots, attrs, emit }) {
        return () =>
          h(
            "button",
            {
              ...attrs,
              onClick: (event: MouseEvent) => emit("click", event),
            },
            slots.default?.(),
          );
      },
    }),
  };
});

describe("WorkspaceAddControl.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    platformMock.isWindows = true;
  });

  it("emits the explicit local environment from the add button", async () => {
    const wrapper = mount(WorkspaceAddControl);

    await wrapper.find("[data-add-workspace-local]").trigger("click");

    expect(wrapper.emitted("addWorkspace")).toEqual([[LOCAL_WORKSPACE]]);
  });

  it("lists Windows WSL distros and emits the selected environment", async () => {
    const workspaceEnv = useWorkspaceEnvPiniaStore();
    workspaceEnv.distros = [
      { name: "Ubuntu", default: true, running: true },
      { name: "Debian", default: false, running: false },
    ];
    const wrapper = mount(WorkspaceAddControl);

    expect(wrapper.find("[data-add-workspace-wsl]").exists()).toBe(true);
    expect(wrapper.find("[data-wsl-option='Ubuntu']").exists()).toBe(true);
    expect(wrapper.find("[data-wsl-option='Debian']").exists()).toBe(true);

    await wrapper.find("[data-wsl-option='Ubuntu']").trigger("click");

    expect(wrapper.emitted("addWorkspace")).toEqual([
      [{ kind: "wsl", distro: "Ubuntu" }],
    ]);
  });

  it("hides the WSL action when no distro is available", () => {
    const wrapper = mount(WorkspaceAddControl, {
      props: { embedded: true },
    });

    expect(wrapper.find("[data-add-workspace-wsl]").exists()).toBe(false);
  });

  it("hides the WSL action outside Windows even when distros exist", () => {
    platformMock.isWindows = false;
    const workspaceEnv = useWorkspaceEnvPiniaStore();
    workspaceEnv.distros = [
      { name: "Ubuntu", default: true, running: true },
    ];

    const wrapper = mount(WorkspaceAddControl);

    expect(wrapper.find("[data-add-workspace-wsl]").exists()).toBe(false);
  });

  it("exposes accessible labels and menu state on compact actions", () => {
    const workspaceEnv = useWorkspaceEnvPiniaStore();
    // 多 distro 场景：仍走下拉菜单，按钮带有 menu 语义。
    workspaceEnv.distros = [
      { name: "Ubuntu", default: true, running: true },
      { name: "Debian", default: false, running: false },
    ];
    const wrapper = mount(WorkspaceAddControl);

    expect(
      wrapper.find("[data-add-workspace-local]").attributes("aria-label"),
    ).toBe("Add local workspace");
    const wslButton = wrapper.find("[data-add-workspace-wsl]");
    expect(wslButton.attributes("aria-label")).toBe("Add WSL workspace");
    expect(wslButton.attributes("aria-haspopup")).toBe("menu");
    expect(wslButton.attributes("aria-expanded")).toBe("false");
  });

  it("opens directly without a dropdown when only one WSL distro exists", async () => {
    const workspaceEnv = useWorkspaceEnvPiniaStore();
    workspaceEnv.distros = [
      { name: "Ubuntu", default: true, running: true },
    ];
    const wrapper = mount(WorkspaceAddControl);

    // 单 distro：渲染直开按钮，无下拉选项，无 menu 语义。
    const wslButton = wrapper.find("[data-add-workspace-wsl]");
    expect(wslButton.exists()).toBe(true);
    expect(wrapper.find("[data-wsl-option='Ubuntu']").exists()).toBe(false);
    expect(wslButton.attributes("aria-haspopup")).toBeUndefined();

    // 点击直接发起添加。
    await wslButton.trigger("click");

    expect(wrapper.emitted("addWorkspace")).toEqual([
      [{ kind: "wsl", distro: "Ubuntu" }],
    ]);
  });
});
