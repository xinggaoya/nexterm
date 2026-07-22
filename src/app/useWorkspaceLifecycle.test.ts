import { computed, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceEnv } from "@/modules/workspace";
import { LOCAL_WORKSPACE } from "@/modules/workspace";
import { useWorkspaceLifecycle } from "./useWorkspaceLifecycle";

const WSL: WorkspaceEnv = { kind: "wsl", distro: "Ubuntu" };

/**
 * 构造一个最小化的 wsNative mock，仅实现 lifecycle 关注的两个方法。
 */
function createMockWsNative() {
  return {
    fsWatchWorkspace: vi.fn(async (_rootPath: string) => undefined),
    fsUnwatchWorkspace: vi.fn(async (_rootPath: string) => undefined),
  };
}

describe("useWorkspaceLifecycle", () => {
  it("startWorkspaceLifecycle 启动监听并以当前 root 启动 watcher", async () => {
    const wsNative = createMockWsNative();
    const rootPath = computed<string | null>(() => "/repo");
    const listen = vi.fn(async () => vi.fn());

    const lifecycle = useWorkspaceLifecycle({
      workspaceId: "test-ws",
      env: LOCAL_WORKSPACE,
      rootPath,
      wsNative,
      hasRuntime: () => true,
      listen,
    });

    await lifecycle.startWorkspaceLifecycle();

    // 注册一次全局 FS 变更事件监听
    expect(listen).toHaveBeenCalledTimes(1);
    // watcher 以当前 root 启动
    expect(wsNative.fsWatchWorkspace).toHaveBeenCalledWith("/repo");
  });

  it("runtime 不可用时 startWorkspaceLifecycle 为空操作", async () => {
    const wsNative = createMockWsNative();
    const rootPath = computed<string | null>(() => "/repo");
    const listen = vi.fn(async () => vi.fn());

    const lifecycle = useWorkspaceLifecycle({
      workspaceId: "test-ws",
      env: LOCAL_WORKSPACE,
      rootPath,
      wsNative,
      hasRuntime: () => false,
      listen,
    });

    await lifecycle.startWorkspaceLifecycle();

    expect(listen).not.toHaveBeenCalled();
    expect(wsNative.fsWatchWorkspace).not.toHaveBeenCalled();
  });

  it("只转发与当前 workspace root 匹配的 FS 事件", async () => {
    const wsNative = createMockWsNative();
    const rootPath = ref<string | null>("/repo");
    type FsHandler = (event: {
      payload: { rootPath: string; paths: string[]; gitRelated: boolean };
    }) => void;
    let handler: FsHandler | undefined;
    const listen = vi.fn(async (_event: string, nextHandler: FsHandler) => {
      handler = nextHandler;
      return vi.fn();
    });

    const lifecycle = useWorkspaceLifecycle({
      workspaceId: "test-ws",
      env: LOCAL_WORKSPACE,
      rootPath: computed(() => rootPath.value),
      wsNative,
      hasRuntime: () => true,
      listen,
    });

    await lifecycle.startWorkspaceLifecycle();

    // 其它 workspace 的事件应被忽略
    handler!({
      payload: {
        rootPath: "/elsewhere",
        paths: ["/elsewhere/a"],
        gitRelated: false,
      },
    });
    expect(lifecycle.workspaceFsEvent.value).toBeNull();

    // 本 workspace root 的事件应被转发
    handler!({
      payload: {
        rootPath: "/repo",
        paths: ["/repo/src/main.ts"],
        gitRelated: true,
      },
    });

    expect(lifecycle.workspaceFsEvent.value?.paths).toEqual([
      "/repo/src/main.ts",
    ]);
    expect(lifecycle.workspaceFsEvent.value?.gitRelated).toBe(true);
  });

  it("连续收到多个事件时 workspaceFsEvent 始终产生新引用以触发 watch", async () => {
    const wsNative = createMockWsNative();
    const rootPath = computed<string | null>(() => "/repo");
    type FsHandler = (event: {
      payload: { rootPath: string; paths: string[]; gitRelated: boolean };
    }) => void;
    let handler: FsHandler | undefined;
    const listen = vi.fn(async (_event: string, nextHandler: FsHandler) => {
      handler = nextHandler;
      return vi.fn();
    });

    const lifecycle = useWorkspaceLifecycle({
      workspaceId: "test-ws",
      env: LOCAL_WORKSPACE,
      rootPath,
      wsNative,
      hasRuntime: () => true,
      listen,
    });

    await lifecycle.startWorkspaceLifecycle();

    handler!({
      payload: { rootPath: "/repo", paths: ["/repo/a"], gitRelated: false },
    });
    const first = lifecycle.workspaceFsEvent.value;
    expect(first?.paths).toEqual(["/repo/a"]);

    handler!({
      payload: { rootPath: "/repo", paths: ["/repo/a"], gitRelated: false },
    });
    // 即使 payload 内容相同，版本号自增也会让 computed 返回新对象引用
    expect(lifecycle.workspaceFsEvent.value?.paths).toEqual(["/repo/a"]);
    expect(lifecycle.workspaceFsEvent.value).not.toBe(first);
  });

  it("restartWorkspaceWatcher 切换 root 时对旧 root 执行 unwatch + 对新 root 执行 watch", async () => {
    // 实现跟踪上一次 watch 的 root（watchedRoot），切换时先 unwatch 旧 root
    // （后端按 env+root 去重，必须用旧 root 才能正确停止），再 watch 新 root。
    const wsNative = createMockWsNative();
    const rootPath = ref<string | null>("/repo");

    const lifecycle = useWorkspaceLifecycle({
      workspaceId: "test-ws",
      env: LOCAL_WORKSPACE,
      rootPath: computed(() => rootPath.value),
      wsNative,
      hasRuntime: () => true,
      listen: vi.fn(async () => vi.fn()),
    });

    await lifecycle.startWorkspaceLifecycle();
    expect(wsNative.fsWatchWorkspace).toHaveBeenCalledWith("/repo");
    expect(wsNative.fsUnwatchWorkspace).not.toHaveBeenCalled();

    // 切换到新 root：先 unwatch 旧 root /repo，再 watch 新 root /other
    rootPath.value = "/other";
    await lifecycle.restartWorkspaceWatcher("/other");

    expect(wsNative.fsUnwatchWorkspace).toHaveBeenCalledWith("/repo");
    expect(wsNative.fsWatchWorkspace).toHaveBeenCalledWith("/other");
  });

  it("restartWorkspaceWatcher 在 root 为 null 时停止旧 watcher 且不启动新的", async () => {
    // 传 null 时：先 unwatch 上一次的 root（watchedRoot），然后因 rootPath
    // 为 null 不启动新 watcher。
    const wsNative = createMockWsNative();
    const rootPath = ref<string | null>("/repo");

    const lifecycle = useWorkspaceLifecycle({
      workspaceId: "test-ws",
      env: LOCAL_WORKSPACE,
      rootPath: computed(() => rootPath.value),
      wsNative,
      hasRuntime: () => true,
      listen: vi.fn(async () => vi.fn()),
    });

    await lifecycle.startWorkspaceLifecycle();
    const initialWatchCalls = wsNative.fsWatchWorkspace.mock.calls.length;

    await lifecycle.restartWorkspaceWatcher(null);

    // unwatch 上一次的 root，不再启动新 watcher
    expect(wsNative.fsUnwatchWorkspace).toHaveBeenCalledWith("/repo");
    expect(wsNative.fsWatchWorkspace).toHaveBeenCalledTimes(initialWatchCalls);
  });

  it("stopWorkspaceLifecycle 注销监听并停止 watcher", async () => {
    const wsNative = createMockWsNative();
    const unlisten = vi.fn();
    const rootPath = computed<string | null>(() => "/repo");
    const listen = vi.fn(async () => unlisten);

    const lifecycle = useWorkspaceLifecycle({
      workspaceId: "test-ws",
      env: LOCAL_WORKSPACE,
      rootPath,
      wsNative,
      hasRuntime: () => true,
      listen,
    });

    await lifecycle.startWorkspaceLifecycle();
    lifecycle.stopWorkspaceLifecycle();

    expect(unlisten).toHaveBeenCalled();
    expect(wsNative.fsUnwatchWorkspace).toHaveBeenCalledWith("/repo");
  });

  it("listenWorkspaceFsChanges 重复调用只注册一次监听", async () => {
    const wsNative = createMockWsNative();
    const rootPath = computed<string | null>(() => "/repo");
    const listen = vi.fn(async () => vi.fn());

    const lifecycle = useWorkspaceLifecycle({
      workspaceId: "test-ws",
      env: LOCAL_WORKSPACE,
      rootPath,
      wsNative,
      hasRuntime: () => true,
      listen,
    });

    await lifecycle.listenWorkspaceFsChanges();
    await lifecycle.listenWorkspaceFsChanges();

    expect(listen).toHaveBeenCalledTimes(1);
  });

  it("环境绑定到 workspace，env 不再触发 watcher 重启（仅 root 变化触发）", async () => {
    // 这个测试验证新模型：env 是不可变的，per-workspace 实例绑定后不再变化。
    // 两个不同 env 的 workspace 各自拥有独立的 lifecycle，互不干扰。
    const localNative = createMockWsNative();
    const wslNative = createMockWsNative();

    const localLifecycle = useWorkspaceLifecycle({
      workspaceId: "local-ws",
      env: LOCAL_WORKSPACE,
      rootPath: computed(() => "/repo"),
      wsNative: localNative,
      hasRuntime: () => true,
      listen: vi.fn(async () => vi.fn()),
    });

    const wslLifecycle = useWorkspaceLifecycle({
      workspaceId: "wsl-ws",
      env: WSL,
      rootPath: computed(() => "/home/dev"),
      wsNative: wslNative,
      hasRuntime: () => true,
      listen: vi.fn(async () => vi.fn()),
    });

    await localLifecycle.startWorkspaceLifecycle();
    await wslLifecycle.startWorkspaceLifecycle();

    // 每个 workspace 只通过自己的 wsNative 启动自己的 watcher
    expect(localNative.fsWatchWorkspace).toHaveBeenCalledWith("/repo");
    expect(wslNative.fsWatchWorkspace).toHaveBeenCalledWith("/home/dev");
    expect(localNative.fsWatchWorkspace).toHaveBeenCalledTimes(1);
    expect(wslNative.fsWatchWorkspace).toHaveBeenCalledTimes(1);
  });
});
