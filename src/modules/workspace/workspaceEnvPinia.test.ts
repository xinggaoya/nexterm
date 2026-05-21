import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { setLastWslDistro } from "@/modules/settings/store";
import { useWorkspaceEnvPiniaStore } from "./workspaceEnvPinia";
import {
  currentWorkspaceEnv,
  LOCAL_WORKSPACE,
  setCurrentWorkspaceEnv,
} from "./workspaceEnvSnapshot";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@/modules/settings/store", () => ({
  setLastWslDistro: vi.fn(),
}));

describe("workspace environment pinia store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    setCurrentWorkspaceEnv(LOCAL_WORKSPACE);
    vi.clearAllMocks();
  });

  afterEach(() => {
    setCurrentWorkspaceEnv(LOCAL_WORKSPACE);
  });

  it("starts with the local workspace and syncs the framework-neutral snapshot", () => {
    const store = useWorkspaceEnvPiniaStore();

    expect(store.env).toEqual({ kind: "local" });
    expect(currentWorkspaceEnv()).toEqual({ kind: "local" });
  });

  it("sets WSL workspace environment and persists the last distro", () => {
    const store = useWorkspaceEnvPiniaStore();

    store.setEnv({ kind: "wsl", distro: "Ubuntu-24.04" });

    expect(store.env).toEqual({ kind: "wsl", distro: "Ubuntu-24.04" });
    expect(currentWorkspaceEnv()).toEqual({
      kind: "wsl",
      distro: "Ubuntu-24.04",
    });
    expect(setLastWslDistro).toHaveBeenCalledWith("Ubuntu-24.04");
  });

  it("refreshes available WSL distros", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      { name: "Ubuntu", default: true, running: true },
    ]);
    const store = useWorkspaceEnvPiniaStore();

    const distros = await store.refreshDistros();

    expect(invoke).toHaveBeenCalledWith("wsl_list_distros");
    expect(distros).toEqual([{ name: "Ubuntu", default: true, running: true }]);
    expect(store.distros).toEqual(distros);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  it("stores refresh errors without throwing", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("wsl unavailable"));
    const store = useWorkspaceEnvPiniaStore();

    const distros = await store.refreshDistros();

    expect(distros).toEqual([]);
    expect(store.distros).toEqual([]);
    expect(store.loading).toBe(false);
    expect(store.error).toContain("wsl unavailable");
  });
});
