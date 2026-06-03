import { defineStore } from "pinia";
import { ref } from "vue";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  setLastWorkspace,
  setRecentWorkspaces,
  type StoredWorkspace,
} from "@/modules/settings/store";
import { authorizeWorkspace, getWslHome } from "./workspaceNative";
import { selectWorkspaceDirectory } from "./workspaceDialog";
import {
  LOCAL_WORKSPACE,
  workspaceScopeKey,
  type WorkspaceEnv,
} from "./workspaceEnvSnapshot";
import { useWorkspaceEnvPiniaStore } from "./workspaceEnvPinia";
import { normalizeWorkspacePath, isSameWorkspaceRoot } from "./workspacePath";

export const RECENT_WORKSPACE_LIMIT = 10;
export { normalizeWorkspacePath, isSameWorkspaceRoot };

type OpenOptions = {
  persist?: boolean;
};

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

function dialogDefaultPath(
  rootPath: string | null,
  env: WorkspaceEnv,
): string | undefined {
  if (!rootPath) return undefined;
  if (env.kind === "wsl" && isLinuxAbsolutePath(rootPath)) return undefined;
  return rootPath;
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

export const useWorkspaceRootPiniaStore = defineStore("workspace-root", () => {
  const hydrated = ref(false);
  const loading = ref(false);
  const rootPath = ref<string | null>(null);
  const lastWorkspace = ref<StoredWorkspace | null>(null);
  const recentWorkspaces = ref<StoredWorkspace[]>([]);
  const error = ref<string | null>(null);

  async function bootstrap(
    explicitLaunch?: string | LaunchWorkspace | null,
  ): Promise<void> {
    if (hydrated.value) return;
    const prefs = await loadPreferences().catch(() => DEFAULT_PREFERENCES);
    recentWorkspaces.value = normalizeRecentWorkspaces(prefs.recentWorkspaces);
    lastWorkspace.value = normalizeStoredWorkspace(prefs.lastWorkspace);

    const explicit =
      typeof explicitLaunch === "string"
        ? { path: normalizeWorkspacePath(explicitLaunch), env: LOCAL_WORKSPACE }
        : explicitLaunch
          ? {
              path: normalizeWorkspacePath(explicitLaunch.path),
              env: explicitLaunch.env,
            }
          : null;
    const candidate = explicit
      ? { ...explicit, openedAt: Date.now() }
      : lastWorkspace.value;

    if (candidate) {
      try {
        await openWorkspace(candidate.path, candidate.env, { persist: true });
      } catch (err) {
        rootPath.value = null;
        error.value = normalizeError(err);
      }
    }

    hydrated.value = true;
  }

  async function openWorkspace(
    path: string,
    env: WorkspaceEnv = useWorkspaceEnvPiniaStore().env,
    options: OpenOptions = {},
  ): Promise<StoredWorkspace> {
    loading.value = true;
    error.value = null;
    try {
      const requested = normalizeWorkspacePath(path);
      const authorized = normalizeWorkspacePath(
        await authorizeWorkspace(requested, env),
      );
      const record: StoredWorkspace = {
        path: authorized,
        env,
        openedAt: Date.now(),
      };
      const recent = upsertRecent(recentWorkspaces.value, record);

      useWorkspaceEnvPiniaStore().setEnv(env);
      rootPath.value = record.path;
      lastWorkspace.value = record;
      recentWorkspaces.value = recent;

      if (options.persist !== false) {
        try {
          await Promise.all([
            setLastWorkspace(record),
            setRecentWorkspaces(recent),
          ]);
        } catch {
          // Opening the workspace should not fail just because persistence is unavailable.
        }
      }

      return record;
    } catch (err) {
      error.value = normalizeError(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function pickWorkspaceDirectory(): Promise<WorkspaceSelection | null> {
    const env = useWorkspaceEnvPiniaStore().env;
    const selected = await selectWorkspaceDirectory(
      dialogDefaultPath(rootPath.value, env),
    );
    if (!selected) return null;
    const path = normalizeWorkspacePath(selected);
    return {
      path,
      env: envForSelectedDirectory(path, env),
    };
  }

  async function pickWorkspaceDirectoryForEnv(
    env: WorkspaceEnv,
  ): Promise<WorkspaceSelection | null> {
    const defaultPath = await resolveDialogDefaultPath(env);
    const selected = await selectWorkspaceDirectory(defaultPath);
    if (!selected) return null;
    const path = normalizeWorkspacePath(selected);
    return {
      path,
      env: envForSelectedDirectory(path, env),
    };
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

  async function chooseWorkspace(): Promise<StoredWorkspace | null> {
    const selected = await pickWorkspaceDirectory();
    if (!selected) return null;
    return openWorkspace(selected.path, selected.env);
  }

  function clearWorkspace(): void {
    rootPath.value = null;
    lastWorkspace.value = null;
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
    openWorkspace,
    pickWorkspaceDirectory,
    pickWorkspaceDirectoryForEnv,
    resolveDialogDefaultPath,
    chooseWorkspace,
    clearWorkspace,
  };
});
