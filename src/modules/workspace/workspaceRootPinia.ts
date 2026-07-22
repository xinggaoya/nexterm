import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  setLastWorkspace,
  setRecentWorkspaces,
  type StoredWorkspace,
} from "@/modules/settings/store";
import { getWslHome } from "./workspaceNative";
import { selectWorkspaceDirectory } from "./workspaceDialog";
import {
  LOCAL_WORKSPACE,
  workspaceScopeKey,
  type WorkspaceEnv,
} from "./workspaceEnvSnapshot";
import { normalizeWorkspacePath, isSameWorkspaceRoot } from "./workspacePath";
import { useWorkspacesPiniaStore } from "./workspacesPinia";

export const RECENT_WORKSPACE_LIMIT = 10;
export { normalizeWorkspacePath, isSameWorkspaceRoot };

export type WorkspaceSelection = {
  path: string;
  env: WorkspaceEnv;
};

export type LaunchWorkspace = WorkspaceSelection;

function normalizeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

function isWorkspaceEnv(value: unknown): value is WorkspaceEnv {
  if (!value || typeof value !== "object") return false;
  const env = value as { kind?: unknown; distro?: unknown };
  if (env.kind === "local") return true;
  if (env.kind === "wsl" && typeof env.distro === "string") return true;
  return false;
}

function isStoredWorkspace(value: unknown): value is StoredWorkspace {
  if (!value || typeof value !== "object") return false;
  const ws = value as { path?: unknown; env?: unknown; openedAt?: unknown };
  return (
    typeof ws.path === "string" &&
    isWorkspaceEnv(ws.env) &&
    typeof ws.openedAt === "number"
  );
}

function normalizeStoredWorkspace(value: unknown): StoredWorkspace | null {
  return isStoredWorkspace(value) ? value : null;
}

function normalizeRecentWorkspaces(value: unknown): StoredWorkspace[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isStoredWorkspace);
}

function workspaceKey(record: Pick<StoredWorkspace, "path" | "env">): string {
  return `${workspaceScopeKey(record.env)}:${record.path}`;
}

function isWindowsDrivePath(path: string): boolean {
  return /^[A-Za-z]:\//.test(path);
}

function isLinuxAbsolutePath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//");
}

function isUncPath(path: string): boolean {
  return path.startsWith("//");
}

function isWslUncPath(path: string): boolean {
  return /^\/\/wsl(?:\.localhost|\$)\//i.test(path);
}

function wslHomeToUnc(distro: string, linuxPath: string): string {
  const normalized = linuxPath.replace(/\\/g, "/");
  const tail = normalized.replace(/^\/+/, "");
  return `\\\\wsl.localhost\\${distro}\\${tail.replace(/\//g, "\\")}`;
}

function envForSelectedDirectory(
  selected: string,
  current: WorkspaceEnv,
): WorkspaceEnv {
  const path = normalizeWorkspacePath(selected);
  if (
    current.kind === "wsl" &&
    (isWindowsDrivePath(path) || (isUncPath(path) && !isWslUncPath(path)))
  ) {
    return LOCAL_WORKSPACE;
  }
  return current;
}

function upsertRecent(
  recent: StoredWorkspace[],
  record: StoredWorkspace,
): StoredWorkspace[] {
  const key = workspaceKey(record);
  const filtered = recent.filter((item) => workspaceKey(item) !== key);
  return [record, ...filtered].slice(0, RECENT_WORKSPACE_LIMIT);
}

/**
 * Recent-workspace history + directory picker helpers.
 *
 * The active workspace set now lives in `workspacesPinia`. This store keeps
 * the historical/UX concerns that are still global: the recent list shown on
 * the welcome screen, and the native folder-picker dialog wiring (which
 * decides a default path based on env). `rootPath` is retained as a derived
 * view of the currently active workspace for backward compatibility with
 * callers that haven't been migrated yet, but it is read-only here — all
 * mutations go through `workspacesPinia`.
 */
export const useWorkspaceRootPiniaStore = defineStore("workspace-root", () => {
  const hydrated = ref(false);
  const loading = ref(false);
  const lastWorkspace = ref<StoredWorkspace | null>(null);
  const recentWorkspaces = ref<StoredWorkspace[]>([]);
  const error = ref<string | null>(null);

  // Derived view of the active workspace's root path.
  const rootPath = computed(() => {
    return useWorkspacesPiniaStore().activeWorkspace?.rootPath ?? null;
  });

  async function bootstrap(): Promise<void> {
    if (hydrated.value) return;
    const prefs = await loadPreferences().catch(() => DEFAULT_PREFERENCES);
    recentWorkspaces.value = normalizeRecentWorkspaces(prefs.recentWorkspaces);
    lastWorkspace.value = normalizeStoredWorkspace(prefs.lastWorkspace);
    hydrated.value = true;
  }

  function dialogDefaultPath(
    path: string | null,
    env: WorkspaceEnv,
  ): string | undefined {
    if (!path) return undefined;
    if (env.kind === "wsl" && isLinuxAbsolutePath(path)) return undefined;
    return path;
  }

  async function pickWorkspaceDirectory(
    env: WorkspaceEnv,
  ): Promise<WorkspaceSelection | null> {
    const defaultPath = await resolveDialogDefaultPath(env);
    const selected = await selectWorkspaceDirectory(defaultPath);
    if (!selected) return null;
    const path = normalizeWorkspacePath(selected);
    return { path, env: envForSelectedDirectory(path, env) };
  }

  async function pickWorkspaceDirectoryForEnv(
    env: WorkspaceEnv,
  ): Promise<WorkspaceSelection | null> {
    return pickWorkspaceDirectory(env);
  }

  /**
   * Pick a directory then add it as a workspace via the workspaces store.
   * Returns the created/focused instance (or null if the user cancelled).
   */
  async function chooseWorkspace(env: WorkspaceEnv): Promise<StoredWorkspace | null> {
    const selected = await pickWorkspaceDirectory(env);
    if (!selected) return null;
    const workspaces = useWorkspacesPiniaStore();
    const { instance } = await workspaces.addWorkspace(selected.path, selected.env);
    const record: StoredWorkspace = {
      path: instance.rootPath,
      env: instance.env,
      openedAt: instance.openedAt,
    };
    await recordRecent(record);
    return record;
  }

  async function resolveDialogDefaultPath(
    env: WorkspaceEnv,
  ): Promise<string | undefined> {
    if (env.kind === "local") {
      return dialogDefaultPath(rootPath.value, env);
    }
    const recent = recentWorkspaces.value.find(
      (item) => item.env.kind === "wsl" && item.env.distro === env.distro,
    );
    if (recent) {
      return recent.path.startsWith("/")
        ? wslHomeToUnc(env.distro, recent.path)
        : recent.path;
    }
    try {
      const home = await getWslHome(env.distro);
      return wslHomeToUnc(env.distro, home);
    } catch {
      return undefined;
    }
  }

  /**
   * Record a freshly opened/added workspace into recent history. Called by
   * `workspacesPinia.addWorkspace` consumers after the instance is created.
   */
  async function recordRecent(record: StoredWorkspace): Promise<void> {
    const recent = upsertRecent(recentWorkspaces.value, record);
    recentWorkspaces.value = recent;
    lastWorkspace.value = record;
    try {
      await Promise.all([
        setLastWorkspace(record),
        setRecentWorkspaces(recent),
      ]);
    } catch {
      // Persistence is best-effort.
    }
  }

  function clearWorkspace(): void {
    error.value = null;
  }

  return {
    hydrated,
    loading,
    rootPath,
    lastWorkspace,
    recentWorkspaces,
    error,
    bootstrap,
    dialogDefaultPath,
    pickWorkspaceDirectory,
    pickWorkspaceDirectoryForEnv,
    resolveDialogDefaultPath,
    chooseWorkspace,
    recordRecent,
    clearWorkspace,
    // Re-exported for tests / legacy callers that referenced these off the
    // root store. They delegate to the equivalent workspaces store methods.
    normalizeError,
  };
});
