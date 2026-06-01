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
  isSameWorkspaceRoot,
  normalizeWorkspacePath,
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
  const switchingWorkspaceEnv = ref<WorkspaceEnv | null>(null);
  const workspaceSwitching = computed(() => switchingWorkspaceEnv.value !== null);
  let workspaceFsUnlisten: UnlistenFn | null = null;
  let watchedWorkspaceKey: string | null = null;
  // Monotonically increasing counter for received FS events. We pair it
  // with a snapshot of the latest payload so consumers watching
  // `workspaceFsEvent` always see a fresh object reference (Vue's `watch`
  // would otherwise skip notifications when two payloads are deeply equal,
  // and a single-value ref would lose bursts because the second payload
  // overwrites the first before subscribers process it).
  const fsEventVersion = ref(0);
  const fsEventPayload = ref<WorkspaceFsChangedEvent | null>(null);
  const workspaceFsEvent = computed<WorkspaceFsChangedEvent | null>(() => {
    if (fsEventVersion.value === 0 || !fsEventPayload.value) return null;
    return fsEventPayload.value;
  });
  // Serialize watcher (re)starts so a second invocation can't early-return
  // while the first one is still awaiting `fsUnwatchWorkspace` /
  // `fsWatchWorkspace` on the backend.
  let watcherRestartInFlight: Promise<void> | null = null;

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
    if (!runtimeAvailable()) return;
    const watcherKey = workspaceWatcherKey(rootPath, options.workspaceEnv.env);
    // If a previous restart is still in flight, chain onto it so the order
    // of `fsUnwatchWorkspace` + `fsWatchWorkspace` calls is preserved. We
    // intentionally do NOT early-return based on `watchedWorkspaceKey`
    // alone, because a quick A→B→A sequence needs the second A request to
    // re-watch after B's teardown completes.
    const prior = watcherRestartInFlight ?? Promise.resolve();
    const next = prior
      .then(async () => {
        // Re-evaluate inside the chain: a later request may have already
        // advanced `watchedWorkspaceKey` past ours; skip the redundant
        // unwatch+watch in that case.
        if (watchedWorkspaceKey === watcherKey) return;
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
      const rootPath = options.workspaceRoot.value;
      if (!isSameWorkspaceRoot(event.payload.rootPath, rootPath)) return;
      // Reassign both refs in a microtask so back-to-back events never get
      // collapsed by Vue's reactivity batching into a single update.
      fsEventPayload.value = event.payload;
      fsEventVersion.value += 1;
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
