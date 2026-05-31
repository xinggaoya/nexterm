import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentWorkspaceEnv,
  LOCAL_WORKSPACE,
  setCurrentWorkspaceEnv,
} from "./workspaceEnvSnapshot";
import { useWorkspaceEnvPiniaStore } from "./workspaceEnvPinia";
import { useWorkspaceRootPiniaStore } from "./workspaceRootPinia";

const settingsMock = vi.hoisted(() => ({
  loadPreferences: vi.fn(),
  setLastWorkspace: vi.fn(),
  setRecentWorkspaces: vi.fn(),
  setLastWslDistro: vi.fn(),
}));

const nativeMock = vi.hoisted(() => ({
  authorizeWorkspace: vi.fn(),
}));

const dialogMock = vi.hoisted(() => ({
  selectWorkspaceDirectory: vi.fn(),
}));

vi.mock("@/modules/settings/store", () => ({
  DEFAULT_PREFERENCES: {
    lastWorkspace: null,
    recentWorkspaces: [],
  },
  loadPreferences: settingsMock.loadPreferences,
  setLastWorkspace: settingsMock.setLastWorkspace,
  setRecentWorkspaces: settingsMock.setRecentWorkspaces,
  setLastWslDistro: settingsMock.setLastWslDistro,
}));

vi.mock("./workspaceNative", () => ({
  authorizeWorkspace: nativeMock.authorizeWorkspace,
}));

vi.mock("./workspaceDialog", () => ({
  selectWorkspaceDirectory: dialogMock.selectWorkspaceDirectory,
}));

describe("workspace root pinia store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    setCurrentWorkspaceEnv(LOCAL_WORKSPACE);
    vi.clearAllMocks();
    settingsMock.loadPreferences.mockResolvedValue({
      lastWorkspace: null,
      recentWorkspaces: [],
    });
    nativeMock.authorizeWorkspace.mockImplementation(async (path: string) => path);
  });

  it("bootstraps an explicit launch directory ahead of the persisted workspace", async () => {
    settingsMock.loadPreferences.mockResolvedValueOnce({
      lastWorkspace: {
        path: "/last",
        env: LOCAL_WORKSPACE,
        openedAt: 1,
      },
      recentWorkspaces: [],
    });
    nativeMock.authorizeWorkspace.mockResolvedValueOnce("/launch");
    const store = useWorkspaceRootPiniaStore();

    await store.bootstrap("/launch");

    expect(store.rootPath).toBe("/launch");
    expect(currentWorkspaceEnv()).toEqual(LOCAL_WORKSPACE);
    expect(nativeMock.authorizeWorkspace).toHaveBeenCalledWith(
      "/launch",
      LOCAL_WORKSPACE,
    );
    expect(settingsMock.setLastWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/launch", env: LOCAL_WORKSPACE }),
    );
  });

  it("bootstraps an explicit WSL launch workspace", async () => {
    const env = { kind: "wsl" as const, distro: "Ubuntu" };
    settingsMock.loadPreferences.mockResolvedValueOnce({
      lastWorkspace: {
        path: "/last",
        env: LOCAL_WORKSPACE,
        openedAt: 1,
      },
      recentWorkspaces: [],
    });
    nativeMock.authorizeWorkspace.mockResolvedValueOnce("/home/dev/repo");
    const store = useWorkspaceRootPiniaStore();

    await store.bootstrap({ path: "/home/dev/repo", env });

    expect(store.rootPath).toBe("/home/dev/repo");
    expect(currentWorkspaceEnv()).toEqual(env);
    expect(nativeMock.authorizeWorkspace).toHaveBeenCalledWith(
      "/home/dev/repo",
      env,
    );
  });

  it("restores the last persisted workspace when no explicit launch directory exists", async () => {
    settingsMock.loadPreferences.mockResolvedValueOnce({
      lastWorkspace: {
        path: "D:\\repo",
        env: LOCAL_WORKSPACE,
        openedAt: 10,
      },
      recentWorkspaces: [],
    });
    nativeMock.authorizeWorkspace.mockResolvedValueOnce("D:/repo");
    const store = useWorkspaceRootPiniaStore();

    await store.bootstrap();

    expect(store.rootPath).toBe("D:/repo");
    expect(nativeMock.authorizeWorkspace).toHaveBeenCalledWith(
      "D:/repo",
      LOCAL_WORKSPACE,
    );
  });

  it("keeps the welcome state when the persisted workspace is not accessible", async () => {
    settingsMock.loadPreferences.mockResolvedValueOnce({
      lastWorkspace: {
        path: "/missing",
        env: LOCAL_WORKSPACE,
        openedAt: 10,
      },
      recentWorkspaces: [],
    });
    nativeMock.authorizeWorkspace.mockRejectedValueOnce(new Error("missing"));
    const store = useWorkspaceRootPiniaStore();

    await store.bootstrap();

    expect(store.rootPath).toBeNull();
    expect(store.error).toContain("missing");
    expect(settingsMock.setLastWorkspace).not.toHaveBeenCalled();
  });

  it("deduplicates recent workspaces and keeps the newest ten entries", async () => {
    const older = Array.from({ length: 11 }, (_, index) => ({
      path: `/repo-${index}`,
      env: LOCAL_WORKSPACE,
      openedAt: index + 1,
    }));
    settingsMock.loadPreferences.mockResolvedValueOnce({
      lastWorkspace: null,
      recentWorkspaces: [
        { path: "/repo", env: LOCAL_WORKSPACE, openedAt: 1 },
        ...older,
      ],
    });
    const store = useWorkspaceRootPiniaStore();

    await store.bootstrap();
    await store.openWorkspace("/repo", LOCAL_WORKSPACE);

    const calls = settingsMock.setRecentWorkspaces.mock.calls;
    const recent = calls[calls.length - 1]?.[0];
    expect(recent).toHaveLength(10);
    expect(recent[0]).toEqual(
      expect.objectContaining({ path: "/repo", env: LOCAL_WORKSPACE }),
    );
    expect(recent.filter((item: { path: string }) => item.path === "/repo")).toHaveLength(1);
  });

  it("opens a selected directory from the system directory picker", async () => {
    dialogMock.selectWorkspaceDirectory.mockResolvedValueOnce("/picked");
    nativeMock.authorizeWorkspace.mockResolvedValueOnce("/picked");
    const store = useWorkspaceRootPiniaStore();

    const opened = await store.chooseWorkspace();

    expect(opened?.path).toBe("/picked");
    expect(store.rootPath).toBe("/picked");
    expect(dialogMock.selectWorkspaceDirectory).toHaveBeenCalledWith(undefined);
  });

  it("picks a workspace directory without opening it", async () => {
    dialogMock.selectWorkspaceDirectory.mockResolvedValueOnce("/picked");
    const store = useWorkspaceRootPiniaStore();

    const selected = await store.pickWorkspaceDirectory();

    expect(selected).toEqual({ path: "/picked", env: LOCAL_WORKSPACE });
    expect(store.rootPath).toBeNull();
    expect(nativeMock.authorizeWorkspace).not.toHaveBeenCalled();
  });

  it("does not pass a Linux WSL path as the Windows directory picker default", async () => {
    const env = { kind: "wsl" as const, distro: "Ubuntu" };
    useWorkspaceEnvPiniaStore().setEnv(env);
    dialogMock.selectWorkspaceDirectory.mockResolvedValueOnce(null);
    const store = useWorkspaceRootPiniaStore();
    store.rootPath = "/home/dev";

    await store.chooseWorkspace();

    expect(dialogMock.selectWorkspaceDirectory).toHaveBeenCalledWith(undefined);
    expect(nativeMock.authorizeWorkspace).not.toHaveBeenCalled();
  });

  it("opens Windows drive selections as local workspaces even while WSL is active", async () => {
    const env = { kind: "wsl" as const, distro: "Ubuntu" };
    useWorkspaceEnvPiniaStore().setEnv(env);
    dialogMock.selectWorkspaceDirectory.mockResolvedValueOnce("D:/repo");
    nativeMock.authorizeWorkspace.mockResolvedValueOnce("D:/repo");
    const store = useWorkspaceRootPiniaStore();

    const opened = await store.chooseWorkspace();

    expect(opened?.path).toBe("D:/repo");
    expect(currentWorkspaceEnv()).toEqual(LOCAL_WORKSPACE);
    expect(nativeMock.authorizeWorkspace).toHaveBeenCalledWith(
      "D:/repo",
      LOCAL_WORKSPACE,
    );
  });

  it("opens non-WSL UNC selections as local workspaces while WSL is active", async () => {
    const env = { kind: "wsl" as const, distro: "Ubuntu" };
    useWorkspaceEnvPiniaStore().setEnv(env);
    dialogMock.selectWorkspaceDirectory.mockResolvedValueOnce("//server/share/repo");
    nativeMock.authorizeWorkspace.mockResolvedValueOnce("//server/share/repo");
    const store = useWorkspaceRootPiniaStore();

    await store.chooseWorkspace();

    expect(nativeMock.authorizeWorkspace).toHaveBeenCalledWith(
      "//server/share/repo",
      LOCAL_WORKSPACE,
    );
  });
});
