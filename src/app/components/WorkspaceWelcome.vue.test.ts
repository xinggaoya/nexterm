// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkspaceWelcome from "./WorkspaceWelcome.vue";
import {
  LOCAL_WORKSPACE,
  setCurrentWorkspaceEnv,
} from "@/modules/workspace/workspaceEnvSnapshot";
import { useWorkspaceEnvPiniaStore } from "@/modules/workspace/workspaceEnvPinia";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  Channel: class {
    onmessage: unknown;
  },
}));

describe("WorkspaceWelcome.vue", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    setCurrentWorkspaceEnv(LOCAL_WORKSPACE);
  });

  it("renders an Open Folder button and emits chooseWorkspace on click", async () => {
    const wrapper = mount(WorkspaceWelcome, {
      global: { plugins: [createPinia()] },
      props: { recentWorkspaces: [], loading: false, error: null },
    });

    await wrapper.find("[data-open-workspace-primary]").trigger("click");

    expect(wrapper.emitted("chooseWorkspace")).toHaveLength(1);
  });

  it("emits workspaceEnvChange for the local env when its quick action is clicked", async () => {
    const wrapper = mount(WorkspaceWelcome, {
      global: { plugins: [createPinia()] },
      props: { recentWorkspaces: [], loading: false, error: null },
    });

    await wrapper.find("[data-open-workspace-local]").trigger("click");

    expect(wrapper.emitted("workspaceEnvChange")).toEqual([[LOCAL_WORKSPACE]]);
  });

  it("renders a quick action button for each WSL distro and emits the env on click", async () => {
    const pinia = createPinia();
    const envStore = useWorkspaceEnvPiniaStore(pinia);
    envStore.distros = [
      { name: "Ubuntu-22.04", default: true, running: true },
      { name: "Debian", default: false, running: false },
    ];
    const wrapper = mount(WorkspaceWelcome, {
      global: { plugins: [pinia] },
      props: { recentWorkspaces: [], loading: false, error: null },
    });
    await nextTick();

    const ubuntuButton = wrapper.find("[data-open-workspace-wsl='Ubuntu-22.04']");
    const debianButton = wrapper.find("[data-open-workspace-wsl='Debian']");
    expect(ubuntuButton.exists()).toBe(true);
    expect(debianButton.exists()).toBe(true);
    expect(ubuntuButton.text()).toContain("Ubuntu-22.04");

    await ubuntuButton.trigger("click");
    expect(wrapper.emitted("workspaceEnvChange")).toEqual([
      [{ kind: "wsl", distro: "Ubuntu-22.04" }],
    ]);

    await debianButton.trigger("click");
    expect(wrapper.emitted("workspaceEnvChange")).toEqual([
      [{ kind: "wsl", distro: "Ubuntu-22.04" }],
      [{ kind: "wsl", distro: "Debian" }],
    ]);
  });

  it("keeps the recent workspaces list rendering unchanged", () => {
    const wrapper = mount(WorkspaceWelcome, {
      global: { plugins: [createPinia()] },
      props: {
        recentWorkspaces: [
          { path: "/repo", env: LOCAL_WORKSPACE, openedAt: 1 },
        ],
        loading: false,
        error: null,
      },
    });

    expect(wrapper.text()).toContain("/repo");
  });
});
