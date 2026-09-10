import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_WORKSPACE } from "./workspaceEnvSnapshot";
import { useWorkspacesPiniaStore } from "./workspacesPinia";
import { useWorkspaceRootPiniaStore } from "./workspaceRootPinia";

// 适配后的多工作区 API:
// - bootstrap() 无参数, 仅 hydrate 最近列表。
// - rootPath 只读, 派生自 workspaces store 的 activeWorkspace, 不能直接赋值。
// - pickWorkspaceDirectory(env) / pickWorkspaceDirectoryForEnv(env) / chooseWorkspace(env)
//   均要求显式 env 参数。
// - openWorkspace / 无参 chooseWorkspace / 全局 env 单例均已移除。

const settingsMock = vi.hoisted(() => ({
  loadPreferences: vi.fn(),
  setLastWorkspace: vi.fn(),
  setRecentWorkspaces: vi.fn(),
  setLastWslDistro: vi.fn(),
  setOpenWorkspaces: vi.fn(),
  setActiveWorkspaceId: vi.fn(),
}));

const nativeMock = vi.hoisted(() => ({
  authorizeWorkspace: vi.fn(),
  getWslHome: vi.fn(),
}));

const pickerMock = vi.hoisted(() => ({
  openFilePicker: vi.fn(),
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
  setOpenWorkspaces: settingsMock.setOpenWorkspaces,
  setActiveWorkspaceId: settingsMock.setActiveWorkspaceId,
}));
// 使用真实 workspacesPinia 实现: chooseWorkspace 会调用
// workspaces.addWorkspace -> authorizeWorkspace, 用 mock native 控制。
vi.mock("./workspaceNative", () => ({
  authorizeWorkspace: nativeMock.authorizeWorkspace,
  getWslHome: nativeMock.getWslHome,
}));

vi.mock("@/modules/picker/filePickerDialog", () => ({
  openFilePicker: pickerMock.openFilePicker,
}));

describe("workspace root pinia store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    settingsMock.loadPreferences.mockResolvedValue({
      lastWorkspace: null,
      recentWorkspaces: [],
    });
    // authorizeWorkspace 默认原样返回路径 (不改变驱动器大小写以外的形式)。
    nativeMock.authorizeWorkspace.mockImplementation(
      async (path: string) => path,
    );
  });

  it("bootstrap is parameterless and only hydrates recent history", async () => {
    settingsMock.loadPreferences.mockResolvedValueOnce({
      lastWorkspace: { path: "/last", env: LOCAL_WORKSPACE, openedAt: 1 },
      recentWorkspaces: [
        { path: "/recent", env: LOCAL_WORKSPACE, openedAt: 5 },
      ],
    });
    const store = useWorkspaceRootPiniaStore();

    await store.bootstrap();

    expect(store.recentWorkspaces).toEqual([
      { path: "/recent", env: LOCAL_WORKSPACE, openedAt: 5 },
    ]);
    // rootPath 派生自 workspaces store, 此时无 active workspace。
    expect(store.rootPath).toBeNull();
    expect(nativeMock.authorizeWorkspace).not.toHaveBeenCalled();
  });

  it("rootPath is a read-only computed — assignment is a no-op", () => {
    const store = useWorkspaceRootPiniaStore();
    expect(store.rootPath).toBeNull();
    // Vue readonly computed 在赋值时不会抛错, 而是静默忽略 (仅 warn)。
    // 这里确认赋值后值不变: 真正改变 rootPath 必须通过 workspaces.addWorkspace。
    // @ts-expect-error - rootPath 是只读 computed, 不应允许赋值
    store.rootPath = "/anywhere";
    expect(store.rootPath).toBeNull();
  });

  it("pickWorkspaceDirectory requires an explicit env and does not open the workspace", async () => {
    pickerMock.openFilePicker.mockResolvedValueOnce("/picked");
    const store = useWorkspaceRootPiniaStore();

    const selected = await store.pickWorkspaceDirectory(LOCAL_WORKSPACE);

    expect(selected).toEqual({ path: "/picked", env: LOCAL_WORKSPACE });
    expect(pickerMock.openFilePicker).toHaveBeenCalledWith({
      mode: "directory",
      workspace: LOCAL_WORKSPACE,
      initialPath: undefined,
    });
    expect(store.rootPath).toBeNull();
    expect(nativeMock.authorizeWorkspace).not.toHaveBeenCalled();
  });

  it("pickWorkspaceDirectory returns null when the user cancels", async () => {
    pickerMock.openFilePicker.mockResolvedValueOnce(null);
    const store = useWorkspaceRootPiniaStore();

    const selected = await store.pickWorkspaceDirectory(LOCAL_WORKSPACE);

    expect(selected).toBeNull();
    expect(store.rootPath).toBeNull();
  });

  it("chooseWorkspace(env) adds the picked path to the workspaces store and records recent", async () => {
    pickerMock.openFilePicker.mockResolvedValueOnce("/picked");
    const store = useWorkspaceRootPiniaStore();
    const workspaces = useWorkspacesPiniaStore();

    const opened = await store.chooseWorkspace(LOCAL_WORKSPACE);

    expect(opened).not.toBeNull();
    expect(opened?.path).toBe("/picked");
    expect(opened?.env).toEqual(LOCAL_WORKSPACE);
    // rootPath 现在派生自 workspaces store 的 active workspace。
    expect(store.rootPath).toBe("/picked");
    expect(workspaces.activeWorkspace?.rootPath).toBe("/picked");
    expect(nativeMock.authorizeWorkspace).toHaveBeenCalledWith(
      "/picked",
      LOCAL_WORKSPACE,
    );
    expect(settingsMock.setLastWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/picked", env: LOCAL_WORKSPACE }),
    );
  });

  it("chooseWorkspace(env) returns null when the dialog is cancelled", async () => {
    pickerMock.openFilePicker.mockResolvedValueOnce(null);
    const store = useWorkspaceRootPiniaStore();

    const opened = await store.chooseWorkspace(LOCAL_WORKSPACE);

    expect(opened).toBeNull();
    expect(store.rootPath).toBeNull();
    expect(nativeMock.authorizeWorkspace).not.toHaveBeenCalled();
  });

  it("picks a WSL directory via the in-app picker rooted at the distro home", async () => {
    const env = { kind: "wsl" as const, distro: "Ubuntu" };
    nativeMock.getWslHome.mockResolvedValueOnce("/home/dev");
    pickerMock.openFilePicker.mockResolvedValueOnce("/home/dev/repo");
    const store = useWorkspaceRootPiniaStore();

    const selected = await store.pickWorkspaceDirectoryForEnv(env);

    // WSL 与本机统一走应用内选择器，不再有任何系统对话框路径。
    expect(selected).toEqual({ path: "/home/dev/repo", env });
    expect(nativeMock.getWslHome).toHaveBeenCalledWith("Ubuntu");
    expect(pickerMock.openFilePicker).toHaveBeenCalledTimes(1);
    expect(pickerMock.openFilePicker).toHaveBeenCalledWith({
      mode: "directory",
      workspace: env,
      initialPath: "/home/dev",
      places: [],
    });
  });

  it("picks a directory for an explicit local env using the current root path as default", async () => {
    // 先通过 workspaces store 建立一个 active workspace, 使 rootPath 可派生。
    const workspaces = useWorkspacesPiniaStore();
    await workspaces.addWorkspace("D:/repo", LOCAL_WORKSPACE);

    pickerMock.openFilePicker.mockResolvedValueOnce("D:/other");
    const store = useWorkspaceRootPiniaStore();

    const selected = await store.pickWorkspaceDirectoryForEnv(LOCAL_WORKSPACE);

    expect(selected).toEqual({ path: "D:/other", env: LOCAL_WORKSPACE });
    expect(pickerMock.openFilePicker).toHaveBeenCalledWith({
      mode: "directory",
      workspace: LOCAL_WORKSPACE,
      initialPath: "D:/repo",
    });
    expect(nativeMock.getWslHome).not.toHaveBeenCalled();
  });

  it("uses the most recent WSL workspace path as the picker's initial path and quick place", async () => {
    const env = { kind: "wsl" as const, distro: "Ubuntu" };
    pickerMock.openFilePicker.mockResolvedValueOnce("/home/dev/projects/repo");
    const store = useWorkspaceRootPiniaStore();
    // 通过 bootstrap 注入 recent 历史而不是直接改 rootPath。
    settingsMock.loadPreferences.mockResolvedValueOnce({
      lastWorkspace: null,
      recentWorkspaces: [
        { path: "/home/dev/projects/repo", env, openedAt: 100 },
      ],
    });
    await store.bootstrap();

    await store.pickWorkspaceDirectoryForEnv(env);

    expect(nativeMock.getWslHome).not.toHaveBeenCalled();
    expect(pickerMock.openFilePicker).toHaveBeenCalledWith({
      mode: "directory",
      workspace: env,
      initialPath: "/home/dev/projects/repo",
      places: [{ key: "recent:/home/dev/projects/repo", label: "repo", path: "/home/dev/projects/repo" }],
    });
  });

  it("falls back to no initial path when the WSL home cannot be resolved", async () => {
    const env = { kind: "wsl" as const, distro: "Debian" };
    nativeMock.getWslHome.mockRejectedValueOnce(new Error("missing"));
    pickerMock.openFilePicker.mockResolvedValueOnce(null);
    const store = useWorkspaceRootPiniaStore();

    const selected = await store.pickWorkspaceDirectoryForEnv(env);

    expect(selected).toBeNull();
    expect(pickerMock.openFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({ initialPath: undefined }),
    );
  });

  it("recordRecent deduplicates recent workspaces and keeps the newest ten entries", async () => {
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

    await store.recordRecent({
      path: "/repo",
      env: LOCAL_WORKSPACE,
      openedAt: 999,
    });

    const calls = settingsMock.setRecentWorkspaces.mock.calls;
    const recent = calls[calls.length - 1]?.[0];
    expect(recent).toHaveLength(10);
    expect(recent[0]).toEqual(
      expect.objectContaining({
        path: "/repo",
        env: LOCAL_WORKSPACE,
        openedAt: 999,
      }),
    );
    expect(
      recent.filter((item: { path: string }) => item.path === "/repo"),
    ).toHaveLength(1);
  });
});
