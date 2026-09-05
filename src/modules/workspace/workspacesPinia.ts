import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  DEFAULT_PREFERENCES,
  setOpenWorkspaces,
  setActiveWorkspaceId,
  setLastWorkspace,
  setRecentWorkspaces,
  loadPreferences,
  type StoredWorkspace,
} from "@/modules/settings/store";
import { authorizeWorkspace } from "./workspaceNative";
import {
  LOCAL_WORKSPACE,
  sameWorkspaceEnv,
  workspaceScopeKey,
  type WorkspaceEnv,
} from "./workspaceEnvSnapshot";
import { normalizeWorkspacePath, isSameWorkspaceRoot } from "./workspacePath";

/**
 * A single open workspace instance in the multi-workspace model.
 *
 * Each workspace binds its own `env` (local or wsl+distro), runs its own set
 * of tabs, PTY sessions, FS watcher, and stays alive in the background when
 * the user switches to another workspace. The `id` is stable across reloads
 * (derived from env+path) so persisted state can be rehydrated and so
 * resource registries keyed by `id` survive.
 */
export interface WorkspaceInstance {
  /** Stable id: `${scopeKey}:${normalizedPath}` — unique per env+root. */
  id: string;
  /** Authorized, normalized root path (forward slashes, uppercased drive). */
  rootPath: string;
  /** This workspace's own environment — never reads a global singleton. */
  env: WorkspaceEnv;
  /** Display name (basename of rootPath). */
  name: string;
  /** Epoch ms when first added this session (also used for ordering). */
  openedAt: number;
}

/** Shape persisted to the settings store so the session can be restored. */
export interface PersistedWorkspace {
  id: string;
  rootPath: string;
  env: WorkspaceEnv;
  name: string;
  openedAt: number;
}

export const RECENT_WORKSPACE_LIMIT = 10;

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function workspaceIdOf(path: string, env: WorkspaceEnv): string {
  const scope = workspaceScopeKey(env);
  return `${scope}:${normalizeWorkspacePath(path)}`;
}

function toInstance(
  rootPath: string,
  env: WorkspaceEnv,
  openedAt = Date.now(),
): WorkspaceInstance {
  const normalized = normalizeWorkspacePath(rootPath);
  return {
    id: workspaceIdOf(normalized, env),
    rootPath: normalized,
    env,
    name: basename(normalized),
    openedAt,
  };
}

function toPersisted(ws: WorkspaceInstance): PersistedWorkspace {
  return {
    id: ws.id,
    rootPath: ws.rootPath,
    env: ws.env,
    name: ws.name,
    openedAt: ws.openedAt,
  };
}

function isPersistedWorkspace(value: unknown): value is PersistedWorkspace {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.rootPath === "string" &&
    typeof v.name === "string" &&
    typeof v.openedAt === "number" &&
    (v.env !== null &&
      typeof v.env === "object" &&
      (((v.env as { kind?: unknown }).kind === "local") ||
        ((v.env as { kind?: unknown }).kind === "wsl" &&
          typeof (v.env as { distro?: unknown }).distro === "string") ||
        ((v.env as { kind?: unknown }).kind === "ssh" &&
          typeof (v.env as { profileId?: unknown }).profileId === "string")))
  );
}

function normalizePersistedList(value: unknown): PersistedWorkspace[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isPersistedWorkspace);
}

function toStored(ws: WorkspaceInstance): StoredWorkspace {
  return { path: ws.rootPath, env: ws.env, openedAt: ws.openedAt };
}

export interface AddWorkspaceResult {
  instance: WorkspaceInstance;
  /** `true` when a new workspace was created; `false` if it already existed. */
  created: boolean;
}

export const useWorkspacesPiniaStore = defineStore("workspaces", () => {
  const hydrated = ref(false);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const workspaces = ref<WorkspaceInstance[]>([]);
  const activeWorkspaceId = ref<string | null>(null);
  /** Workspaces whose resources have finished initializing (tabs + watcher). */
  const readyWorkspaceIds = ref<Set<string>>(new Set());

  const activeWorkspace = computed<WorkspaceInstance | null>(
    () =>
      workspaces.value.find((ws) => ws.id === activeWorkspaceId.value) ?? null,
  );

  const hasWorkspaces = computed(() => workspaces.value.length > 0);

  function isReady(id: string): boolean {
    return readyWorkspaceIds.value.has(id);
  }

  function markReady(id: string): void {
    if (!readyWorkspaceIds.value.has(id)) {
      const next = new Set(readyWorkspaceIds.value);
      next.add(id);
      readyWorkspaceIds.value = next;
    }
  }

  function clearReady(id: string): void {
    if (readyWorkspaceIds.value.has(id)) {
      const next = new Set(readyWorkspaceIds.value);
      next.delete(id);
      readyWorkspaceIds.value = next;
    }
  }

  /**
   * Add a workspace (or focus it if the same env+root is already open).
   * Authorizes the path on the backend, appends to the list, sets it active,
   * and persists the open set + recent history. Does NOT touch tab/watcher
   * state — that is the caller's responsibility (see useWorkspaceLifecycle
   * and tabs store `initWorkspace`).
   */
  async function addWorkspace(
    path: string,
    env: WorkspaceEnv,
  ): Promise<AddWorkspaceResult> {
    loading.value = true;
    error.value = null;
    try {
      const authorized = normalizeWorkspacePath(
        await authorizeWorkspace(path, env),
      );
      const id = workspaceIdOf(authorized, env);
      const existing = workspaces.value.find((ws) => ws.id === id);
      if (existing) {
        activeWorkspaceId.value = id;
        await persist();
        return { instance: existing, created: false };
      }
      const instance = toInstance(authorized, env);
      workspaces.value = [...workspaces.value, instance];
      activeWorkspaceId.value = id;
      await persist();
      // Also keep the legacy "last/recent" history in sync so the welcome
      // screen and migration paths keep working.
      const stored = toStored(instance);
      try {
        await setLastWorkspace(stored);
      } catch {
        // non-fatal
      }
      return { instance, created: true };
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Remove a workspace and clear its ready flag. Destroying its PTY sessions,
   * watcher, and tabs is the caller's responsibility (handled by the
   * WorkspaceHost teardown + tabs store `disposeWorkspaceTabs`).
   */
  async function removeWorkspace(id: string): Promise<void> {
    const idx = workspaces.value.findIndex((ws) => ws.id === id);
    if (idx < 0) return;
    clearReady(id);
    const next = workspaces.value.filter((ws) => ws.id !== id);
    workspaces.value = next;
    if (activeWorkspaceId.value === id) {
      activeWorkspaceId.value = next[Math.max(0, idx - 1)]?.id ?? next[0]?.id ?? null;
    }
    await persist();
  }

  /** Switch the active workspace without touching any other's resources. */
  function setActive(id: string): void {
    if (!workspaces.value.some((ws) => ws.id === id)) return;
    activeWorkspaceId.value = id;
    void persistActive();
  }

  function reorder(id: string, toIndex: number): void {
    const from = workspaces.value.findIndex((ws) => ws.id === id);
    if (from < 0 || toIndex < 0 || toIndex >= workspaces.value.length) return;
    if (from === toIndex) return;
    const next = [...workspaces.value];
    const [moved] = next.splice(from, 1);
    next.splice(toIndex, 0, moved);
    workspaces.value = next;
    void persist();
  }

  /** True when a workspace with the same env+root is already open. */
  function isOpen(path: string, env: WorkspaceEnv): boolean {
    const id = workspaceIdOf(normalizeWorkspacePath(path), env);
    return workspaces.value.some((ws) => ws.id === id);
  }

  /** Lookup by env+root, useful for deep-link dedup. */
  function findBySelection(
    path: string,
    env: WorkspaceEnv,
  ): WorkspaceInstance | null {
    const id = workspaceIdOf(normalizeWorkspacePath(path), env);
    return workspaces.value.find((ws) => ws.id === id) ?? null;
  }

  function findSameRoot(rootPath: string): WorkspaceInstance | null {
    return (
      workspaces.value.find((ws) =>
        isSameWorkspaceRoot(ws.rootPath, rootPath),
      ) ?? null
    );
  }

  async function persist(): Promise<void> {
    const persisted = workspaces.value.map(toPersisted);
    try {
      await Promise.all([
        setOpenWorkspaces(persisted),
        setActiveWorkspaceId(activeWorkspaceId.value),
        setRecentWorkspaces(
          persisted.slice(-RECENT_WORKSPACE_LIMIT).map(toStored),
        ),
      ]);
    } catch {
      // Persistence failures must not break workspace operations.
    }
  }

  async function persistActive(): Promise<void> {
    try {
      await setActiveWorkspaceId(activeWorkspaceId.value);
    } catch {
      // ignore
    }
  }

  /**
   * Rehydrate the open workspace set + active id from persisted prefs. Called
   * once at app boot. Does NOT authorize paths or start watchers — the
   * WorkspaceHost layer does that per-workspace as it mounts.
   */
  async function bootstrap(): Promise<void> {
    if (hydrated.value) return;
    const prefs = await loadPreferences().catch(() => DEFAULT_PREFERENCES);
    const persisted = normalizePersistedList(
      (prefs as unknown as { openWorkspaces?: unknown }).openWorkspaces,
    );
    // Migration: if no persisted open set but a lastWorkspace exists, seed
    // from it so existing users keep their workspace on first launch.
    if (persisted.length === 0 && prefs.lastWorkspace) {
      const seed = prefs.lastWorkspace;
      const instance = toInstance(seed.path, seed.env, seed.openedAt);
      workspaces.value = [instance];
      activeWorkspaceId.value = instance.id;
    } else {
      workspaces.value = persisted.map((p) => ({
        id: p.id,
        rootPath: normalizeWorkspacePath(p.rootPath),
        env: p.env,
        name: basename(normalizeWorkspacePath(p.rootPath)),
        openedAt: p.openedAt,
      }));
      const savedActive = (
        prefs as unknown as { activeWorkspaceId?: string | null }
      ).activeWorkspaceId;
      activeWorkspaceId.value =
        (savedActive &&
          workspaces.value.some((ws) => ws.id === savedActive) &&
          savedActive) ||
        workspaces.value[0]?.id ||
        null;
    }
    hydrated.value = true;
  }

  return {
    hydrated,
    loading,
    error,
    workspaces,
    activeWorkspaceId,
    activeWorkspace,
    hasWorkspaces,
    readyWorkspaceIds,
    isReady,
    markReady,
    clearReady,
    addWorkspace,
    removeWorkspace,
    setActive,
    reorder,
    isOpen,
    findBySelection,
    findSameRoot,
    bootstrap,
    persist,
  };
});

export {
  normalizeWorkspacePath,
  isSameWorkspaceRoot,
  workspaceIdOf,
  sameWorkspaceEnv,
  LOCAL_WORKSPACE,
};
