import { homeDir } from "@tauri-apps/api/path";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";
import { computed, ref, watch, type ComputedRef } from "vue";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import {
  native,
  WORKSPACE_FS_CHANGED_EVENT,
  type WorkspaceFsChangedEvent,
} from "@/lib/native";
import type { StoredWorkspace } from "@/modules/settings/store";
import { dirtyEditorTabs } from "@/modules/tabs/closeGuards";
import type { Tab } from "@/modules/tabs/tabsTypes";
import {
  getWslHome as getDefaultWslHome,
  normalizeWorkspacePath,
  openWorkspaceInNewWindow,
  type WorkspaceEnv,
} from "@/modules/workspace";

type WorkspaceRootStoreLike = {
  rootPath: string | null;
  recentWorkspaces: StoredWorkspace[];
  loading: boolean;
  error: string | null;
  openWorkspace: (path: string, env: WorkspaceEnv) => Promise<StoredWorkspace>;
  chooseWorkspace: () => Promise<StoredWorkspace | null>;
};

type WorkspaceEnvStoreLike = {
  env: WorkspaceEnv;
};

type TabsStoreLike = {
  initialized: boolean;
  tabs: Tab[];
  init: (cwd?: string) => void;
  resetWorkspace: (cwd?: string) => void;
};

type WorkspaceNativeLike = Pick<
  typeof native,
  "fsWatchWorkspace" | "fsUnwatchWorkspace"
>;

type ListenFn = (
  event: string,
  handler: (event: { payload: WorkspaceFsChangedEvent }) => void,
) => Promise<UnlistenFn>;

export type WorkspaceLifecycleOptions = {
  workspaceRoot: ComputedRef<string | null>;
  workspaceEnv: WorkspaceEnvStoreLike;
  workspaceRootStore: WorkspaceRootStoreLike;
  tabs: TabsStoreLike;
  t: (key: string) => string;
  alert?: (message: string) => void;
  getLocalHome?: () => Promise<string>;
  getWslHome?: (distro: string) => Promise<string>;
  hasRuntime?: () => boolean;
  listen?: ListenFn;
  native?: WorkspaceNativeLike;
};

function isSameWorkspaceRoot(a: string | null, b: string | null): boolean {
  return !!a && !!b && normalizeWorkspacePath(a) === normalizeWorkspacePath(b);
}

function workspaceWatcherKey(
  rootPath: string | null,
  env: WorkspaceEnv,
): string | null {
  if (!rootPath) return null;
  const scope = env.kind === "wsl" ? `wsl:${env.distro}` : "local";
  return `${scope}:${normalizeWorkspacePath(rootPath)}`;
}

function sameWorkspaceEnv(a: WorkspaceEnv, b: WorkspaceEnv): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "local" || (b.kind === "wsl" && a.distro === b.distro);
}

export function useWorkspaceLifecycle(options: WorkspaceLifecycleOptions) {
  const runtimeAvailable = options.hasRuntime ?? hasTauriInternals;
  const listenFn: ListenFn =
    options.listen ??
    ((event, handler) => tauriListen<WorkspaceFsChangedEvent>(event, handler));
  const workspaceNative = options.native ?? native;
  const showAlert = options.alert ?? ((message: string) => window.alert(message));
  const getLocalHome =
    options.getLocalHome ??
    (async () => (await homeDir()).replace(/\\/g, "/"));
  const getWslHome = options.getWslHome ?? getDefaultWslHome;
  const workspaceFsEvent = ref<WorkspaceFsChangedEvent | null>(null);
  const switchingWorkspaceEnv = ref<WorkspaceEnv | null>(null);
  const workspaceSwitching = computed(() => switchingWorkspaceEnv.value !== null);
  let workspaceFsUnlisten: UnlistenFn | null = null;
  let watchedWorkspaceKey: string | null = null;

  function hasDirtyEditors(): boolean {
    if (dirtyEditorTabs(options.tabs.tabs).length > 0) {
      showAlert(options.t("app.unsaved.switchWorkspaceBlocked"));
      return true;
    }
    return false;
  }

  function syncTabsForWorkspace(path: string, resetExisting: boolean) {
    if (!options.tabs.initialized || options.tabs.tabs.length === 0) {
      options.tabs.init(path);
      return;
    }
    if (!resetExisting) return;
    options.tabs.resetWorkspace(path);
  }

  async function restartWorkspaceWatcher(rootPath: string | null) {
    const watcherKey = workspaceWatcherKey(rootPath, options.workspaceEnv.env);
    if (!runtimeAvailable() || watchedWorkspaceKey === watcherKey) return;
    watchedWorkspaceKey = watcherKey;
    try {
      await workspaceNative.fsUnwatchWorkspace();
    } catch (error) {
      console.warn("Failed to stop workspace watcher", error);
    }
    if (!rootPath) return;
    try {
      await workspaceNative.fsWatchWorkspace(rootPath);
    } catch (error) {
      console.warn("Workspace watcher unavailable", error);
    }
  }

  async function listenWorkspaceFsChanges() {
    if (!runtimeAvailable() || workspaceFsUnlisten) return;
    workspaceFsUnlisten = await listenFn(WORKSPACE_FS_CHANGED_EVENT, (event) => {
      const rootPath = options.workspaceRoot.value;
      if (!isSameWorkspaceRoot(event.payload.rootPath, rootPath)) return;
      workspaceFsEvent.value = event.payload;
    });
  }

  async function startWorkspaceLifecycle() {
    if (!runtimeAvailable()) return;
    await listenWorkspaceFsChanges();
    await restartWorkspaceWatcher(options.workspaceRoot.value);
  }

  function stopWorkspaceLifecycle() {
    if (workspaceFsUnlisten) {
      workspaceFsUnlisten();
      workspaceFsUnlisten = null;
    }
    if (runtimeAvailable()) void workspaceNative.fsUnwatchWorkspace();
  }

  async function openWorkspacePath(
    path: string,
    env: WorkspaceEnv = options.workspaceEnv.env,
  ) {
    const hadWorkspace = !!options.workspaceRoot.value;
    if (hadWorkspace && hasDirtyEditors()) return;
    try {
      const record = await options.workspaceRootStore.openWorkspace(path, env);
      syncTabsForWorkspace(record.path, hadWorkspace);
    } catch (error) {
      showAlert(String(error));
    }
  }

  async function chooseWorkspace() {
    const hadWorkspace = !!options.workspaceRoot.value;
    if (hadWorkspace && hasDirtyEditors()) return;
    try {
      const record = await options.workspaceRootStore.chooseWorkspace();
      if (record) syncTabsForWorkspace(record.path, hadWorkspace);
    } catch (error) {
      showAlert(String(error));
    }
  }

  async function openRecentWorkspace(record: StoredWorkspace) {
    await openWorkspacePath(record.path, record.env);
  }

  async function switchWorkspace(env: WorkspaceEnv) {
    if (sameWorkspaceEnv(env, options.workspaceEnv.env) && options.workspaceRoot.value) {
      return;
    }
    if (workspaceSwitching.value) return;
    if (hasDirtyEditors()) return;

    switchingWorkspaceEnv.value = env;
    try {
      const nextHome =
        env.kind === "wsl" ? await getWslHome(env.distro) : await getLocalHome();
      await openWorkspacePath(nextHome, env);
    } catch (error) {
      showAlert(String(error));
    } finally {
      switchingWorkspaceEnv.value = null;
    }
  }

  async function openEnvHomeInNewWindow(env: WorkspaceEnv) {
    if (hasDirtyEditors()) return;
    try {
      const home =
        env.kind === "wsl" ? await getWslHome(env.distro) : await getLocalHome();
      const webview = openWorkspaceInNewWindow({
        path: normalizeWorkspacePath(home),
        env,
      });
      void webview.once("tauri://error", (event) => {
        showAlert(String(event.payload));
      });
    } catch (error) {
      showAlert(String(error));
    }
  }

  watch(
    () => [options.workspaceRoot.value, options.workspaceEnv.env] as const,
    ([rootPath]) => {
      void restartWorkspaceWatcher(rootPath);
      if (!rootPath) return;
      if (!options.tabs.initialized || options.tabs.tabs.length === 0) {
        options.tabs.init(rootPath);
      }
    },
    { immediate: true },
  );

  return {
    chooseWorkspace,
    hasDirtyEditors,
    listenWorkspaceFsChanges,
    openEnvHomeInNewWindow,
    openRecentWorkspace,
    openWorkspacePath,
    restartWorkspaceWatcher,
    startWorkspaceLifecycle,
    stopWorkspaceLifecycle,
    switchWorkspace,
    switchingWorkspaceEnv,
    syncTabsForWorkspace,
    workspaceSwitching,
    workspaceFsEvent,
  };
}
