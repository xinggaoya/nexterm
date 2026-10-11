import { homeDir } from "@tauri-apps/api/path";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";
import { ref, type ComputedRef } from "vue";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import type { WorkspaceNative } from "@/lib/native";
import {
  WORKSPACE_FS_CHANGED_EVENT,
  type WorkspaceFsChangedEvent,
} from "@/lib/native";
import { isSameWorkspaceRoot, type WorkspaceEnv } from "@/modules/workspace";

type ListenFn = (
  event: string,
  handler: (event: { payload: WorkspaceFsChangedEvent }) => void,
) => Promise<UnlistenFn>;

export type WorkspaceLifecycleOptions = {
  /** Stable id of the workspace this lifecycle instance owns. */
  workspaceId: string;
  /** This workspace's bound environment. */
  env: WorkspaceEnv;
  /** Reactive root path for this workspace. */
  rootPath: ComputedRef<string | null>;
  /** Env-bound native surface for watcher start/stop. */
  wsNative: Pick<
    WorkspaceNative,
    "fsWatchWorkspace" | "fsUnwatchWorkspace" | "fsForceFlushWorkspace"
  >;
  hasRuntime?: () => boolean;
  listen?: ListenFn;
};

/**
 * Per-workspace lifecycle: owns one FS watcher and forwards FS-change events
 * scoped to this workspace's root.
 *
 * In the multi-workspace model each WorkspaceHost instantiates this composable
 * once. Watchers run concurrently in the backend (keyed by env+root), and the
 * single global event listener dispatches by `rootPath` — only events whose
 * root matches this workspace's root bump `workspaceFsEvent`.
 *
 * Unlike the legacy single-workspace lifecycle, switching the active
 * workspace does NOT stop watchers or touch tabs: background workspaces keep
 * watching and keep their state.
 */
export function useWorkspaceLifecycle(options: WorkspaceLifecycleOptions) {
  const runtimeAvailable = options.hasRuntime ?? hasTauriInternals;
  const listenFn: ListenFn =
    options.listen ??
    ((event, handler) => tauriListen<WorkspaceFsChangedEvent>(event, handler));

  let workspaceFsUnlisten: UnlistenFn | null = null;
  // Whether this workspace's watcher is currently started, and which root it
  // was started for (so we unwatch the *previous* root, not a new one, when
  // restarting).
  let watching = false;
  let watchedRoot: string | null = null;
  // Serialize watcher (re)starts so a second invocation can't early-return
  // while the first one is still awaiting the backend.
  let watcherRestartInFlight: Promise<void> | null = null;

  // FS 事件的单一出口。
  //
  // 必须是**可写**的：`useWorkbenchCommands` 的 `git.refresh` /
  // `explorer.refresh` / `stageAll` / `fetch` / `pull` / `push` / `stash.*`
  // 共 9 条命令靠写入一个 `paths: []` 的全量刷新事件来推动面板重绘。之前
  // 这里是只读 computed，赋值被 Vue 静默丢弃 —— 命令生效了但 UI 不动。
  //
  // 每次写入都换一个全新对象：Vue 的 `watch` 对同一引用不会触发，而 fs 事件
  // 允许 payload 深度相等（连续两次全量刷新就是这种情况），那恰恰是最需要
  // 刷新的一次。历史实现用 `ref(0)` 版本号绕开这点，但代价是这个语义只藏在
  // 一个只读 computed 里，下游按可写 ref 用就会翻车。
  const workspaceFsEvent = ref<WorkspaceFsChangedEvent | null>(null);

  /** 发布一次 FS 事件：始终写入新引用，保证订阅者一定被唤醒。 */
  function publishWorkspaceFsEvent(payload: WorkspaceFsChangedEvent): void {
    workspaceFsEvent.value = {
      ...payload,
      paths: [...payload.paths],
      ...(payload.kinds ? { kinds: [...payload.kinds] } : {}),
    };
  }

  async function restartWorkspaceWatcher(rootPath: string | null) {
    if (!runtimeAvailable()) return;
    const prior = watcherRestartInFlight ?? Promise.resolve();
    const next = prior
      .then(async () => {
        // Stop any previous watch for this workspace, then (re)start if we
        // still have a root. Each workspace manages its own watcher
        // independently; the backend dedupes by env+root key. We must unwatch
        // the *previously* watched root (not the new one) since the backend
        // keys watchers by root.
        if (watching && watchedRoot) {
          try {
            await options.wsNative.fsUnwatchWorkspace(watchedRoot);
          } catch (error) {
            console.warn("Failed to stop workspace watcher", error);
          }
          watching = false;
          watchedRoot = null;
        }
        if (!rootPath) return;
        try {
          await options.wsNative.fsWatchWorkspace(rootPath);
          watching = true;
          watchedRoot = rootPath;
        } catch (error) {
          console.warn("Workspace watcher unavailable", error);
        }
      })
      .catch((error) => {
        console.warn("Workspace watcher restart failed", error);
      });
    watcherRestartInFlight = next.finally(() => {
      if (watcherRestartInFlight === next) watcherRestartInFlight = null;
    });
    return watcherRestartInFlight;
  }

  async function listenWorkspaceFsChanges() {
    if (!runtimeAvailable() || workspaceFsUnlisten) return;
    workspaceFsUnlisten = await listenFn(WORKSPACE_FS_CHANGED_EVENT, (event) => {
      // Only forward events for THIS workspace's root. The global listener is
      // registered once per workspace instance; multiple workspaces each get
      // their own filtered stream.
      if (!isSameWorkspaceRoot(event.payload.rootPath, options.rootPath.value))
        return;
      publishWorkspaceFsEvent(event.payload);
    });
  }

  async function startWorkspaceLifecycle() {
    if (!runtimeAvailable()) return;
    await listenWorkspaceFsChanges();
    await restartWorkspaceWatcher(options.rootPath.value);
  }

  function stopWorkspaceLifecycle() {
    if (workspaceFsUnlisten) {
      workspaceFsUnlisten();
      workspaceFsUnlisten = null;
    }
    if (runtimeAvailable() && watching && watchedRoot) {
      void options.wsNative.fsUnwatchWorkspace(watchedRoot).catch(() => {});
      watching = false;
      watchedRoot = null;
    }
  }

  // Start/stop the watcher as this workspace's root changes (e.g. on first
  // authorization completing). We do NOT touch tabs here — that's the
  // WorkspaceHost's responsibility via the tabs store.
  // Note: we intentionally do NOT watch `env` — env is immutable per
  // WorkspaceInstance, bound at creation time.

  return {
    restartWorkspaceWatcher,
    listenWorkspaceFsChanges,
    startWorkspaceLifecycle,
    stopWorkspaceLifecycle,
    workspaceFsEvent,
    /** 命令系统推动面板重绘用的入口（git.refresh / explorer.refresh 等）。 */
    publishWorkspaceFsEvent,
    /**
     * 手动触发 batcher flush。在 workspace 切回时 WorkspaceHost 调,
     * 配合各组件的 flush 钩子,保证切回时 explorer / 终端 / 源码
     * 控制都显示最新状态(非切走时快照等下一波数据)。
     */
    forceFlushNow: () => {
      if (!runtimeAvailable()) return;
      const root = options.rootPath.value;
      if (!root) return;
      void options.wsNative.fsForceFlushWorkspace(root).catch((error) => {
        console.debug("force flush failed", error);
      });
    },
  };
}

/**
 * Resolve the home directory for a workspace env. Used by the add-workspace
 * flow when the user picks a bare env (local home or a WSL distro's home).
 */
export async function resolveHomeForEnv(env: WorkspaceEnv): Promise<string> {
  if (env.kind === "wsl") {
    const { getWslHome } = await import("@/modules/workspace/workspaceNative");
    return getWslHome(env.distro);
  }
  if (env.kind === "ssh") {
    // SSH 的工作区根在连接对话框里由远端 HOME 探针确定,不走此函数。
    throw new Error("ssh workspace root is resolved by the connect dialog");
  }
  return (await homeDir()).replace(/\\/g, "/");
}
