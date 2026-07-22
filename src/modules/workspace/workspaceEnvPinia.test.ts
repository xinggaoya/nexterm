import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { native } from "@/lib/native";
import { useWorkspaceEnvPiniaStore } from "./workspaceEnvPinia";
import { LOCAL_WORKSPACE } from "./workspaceEnvSnapshot";

// env / setEnv / 与全局 snapshot 单例的联动已移除。
// store 现在持有 transient 的 pendingEnv (供 add-workspace 选择器使用) 以及
// distros / loading / error / refreshDistros。

vi.mock("@/lib/native", () => ({
  native: {
    wslListDistros: vi.fn(),
  },
}));

describe("workspace environment pinia store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("starts with pendingEnv pointing at the local workspace", () => {
    const store = useWorkspaceEnvPiniaStore();

    expect(store.pendingEnv).toEqual({ kind: "local" });
    expect(store.pendingEnv).toEqual(LOCAL_WORKSPACE);
    expect(store.distros).toEqual([]);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  it("setPendingEnv updates the selected environment without persistence side effects", () => {
    const store = useWorkspaceEnvPiniaStore();

    store.setPendingEnv({ kind: "wsl", distro: "Ubuntu-24.04" });

    expect(store.pendingEnv).toEqual({
      kind: "wsl",
      distro: "Ubuntu-24.04",
    });
  });

  it("setPendingEnv can flip back to the local workspace", () => {
    const store = useWorkspaceEnvPiniaStore();
    store.setPendingEnv({ kind: "wsl", distro: "Debian" });

    store.setPendingEnv({ kind: "local" });

    expect(store.pendingEnv).toEqual({ kind: "local" });
  });

  it("refreshes available WSL distros", async () => {
    vi.mocked(native.wslListDistros).mockResolvedValueOnce([
      { name: "Ubuntu", default: true, running: true },
    ]);
    const store = useWorkspaceEnvPiniaStore();

    const distros = await store.refreshDistros();

    expect(distros).toEqual([{ name: "Ubuntu", default: true, running: true }]);
    expect(store.distros).toEqual(distros);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  it("stores refresh errors without throwing", async () => {
    vi.mocked(native.wslListDistros).mockRejectedValueOnce(
      new Error("wsl unavailable"),
    );
    const store = useWorkspaceEnvPiniaStore();

    const distros = await store.refreshDistros();

    expect(distros).toEqual([]);
    expect(store.distros).toEqual([]);
    expect(store.loading).toBe(false);
    expect(store.error).toContain("wsl unavailable");
  });
});
