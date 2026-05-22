import { defineStore } from "pinia";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  setLastWorkspace,
  setRecentWorkspaces,
  type StoredWorkspace,
} from "@/modules/settings/store";
import { authorizeWorkspace } from "./workspaceNative";
import { selectWorkspaceDirectory } from "./workspaceDialog";
import {
  LOCAL_WORKSPACE,
  workspaceScopeKey,
  type WorkspaceEnv,
} from "./workspaceEnvSnapshot";
import { useWorkspaceEnvPiniaStore } from "./workspaceEnvPinia";
import { normalizeWorkspacePath } from "./workspacePath";

export const RECENT_WORKSPACE_LIMIT = 10;
export { normalizeWorkspacePath };

type State = {
  hydrated: boolean;
  loading: boolean;
  rootPath: string | null;
  lastWorkspace: StoredWorkspace | null;
  recentWorkspaces: StoredWorkspace[];
  error: string | null;
};

type OpenOptions = {
  persist?: boolean;
};

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
  return env.kind === "wsl" && typeof env.distro === "string" && env.distro.length > 0;
}

function isStoredWorkspace(value: unknown): value is StoredWorkspace {
  if (!value || typeof value !== "object") return false;
  const item = value as { path?: unknown; env?: unknown; openedAt?: unknown };
  return (
    typeof item.path === "string" &&
    item.path.trim().length > 0 &&
    isWorkspaceEnv(item.env) &&
    typeof item.openedAt === "number"
  );
}

function normalizeStoredWorkspace(value: unknown): StoredWorkspace | null {
  if (!isStoredWorkspace(value)) return null;
  return {
    path: normalizeWorkspacePath(value.path),
    env: value.env,
    openedAt: value.openedAt,
  };
}

function normalizeRecentWorkspaces(value: unknown): StoredWorkspace[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeStoredWorkspace)
    .filter((item): item is StoredWorkspace => item !== null)
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, RECENT_WORKSPACE_LIMIT);
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
  return [
    record,
    ...recent.filter((item) => workspaceKey(item) !== key),
  ].slice(0, RECENT_WORKSPACE_LIMIT);
}

export const useWorkspaceRootPiniaStore = defineStore("workspace-root", {
  state: (): State => ({
    hydrated: false,
    loading: false,
    rootPath: null,
    lastWorkspace: null,
    recentWorkspaces: [],
    error: null,
  }),
  actions: {
    async bootstrap(explicitLaunchDir?: string | null): Promise<void> {
      if (this.hydrated) return;
      const prefs = await loadPreferences().catch(() => DEFAULT_PREFERENCES);
      this.recentWorkspaces = normalizeRecentWorkspaces(prefs.recentWorkspaces);
      this.lastWorkspace = normalizeStoredWorkspace(prefs.lastWorkspace);

      const explicit = explicitLaunchDir
        ? normalizeWorkspacePath(explicitLaunchDir)
        : null;
      const candidate = explicit
        ? { path: explicit, env: LOCAL_WORKSPACE, openedAt: Date.now() }
        : this.lastWorkspace;

      if (candidate) {
        await this.openWorkspace(candidate.path, candidate.env, { persist: true }).catch(
          (error) => {
            this.rootPath = null;
            this.error = normalizeError(error);
          },
        );
      }

      this.hydrated = true;
    },
    async openWorkspace(
      path: string,
      env: WorkspaceEnv = useWorkspaceEnvPiniaStore().env,
      options: OpenOptions = {},
    ): Promise<StoredWorkspace> {
      this.loading = true;
      this.error = null;
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
        const recent = upsertRecent(this.recentWorkspaces, record);

        useWorkspaceEnvPiniaStore().setEnv(env);
        this.rootPath = record.path;
        this.lastWorkspace = record;
        this.recentWorkspaces = recent;

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
      } catch (error) {
        this.error = normalizeError(error);
        throw error;
      } finally {
        this.loading = false;
      }
    },
    async chooseWorkspace(): Promise<StoredWorkspace | null> {
      const env = useWorkspaceEnvPiniaStore().env;
      const selected = await selectWorkspaceDirectory(
        dialogDefaultPath(this.rootPath, env),
      );
      if (!selected) return null;
      return this.openWorkspace(selected, envForSelectedDirectory(selected, env));
    },
    clearWorkspace() {
      this.rootPath = null;
      this.lastWorkspace = null;
      this.error = null;
    },
  },
});
