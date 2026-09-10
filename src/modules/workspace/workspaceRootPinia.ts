import { normalizeErrorMessage } from "@/lib/error";
import { basename } from "@/lib/path";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  setLastWorkspace,
  setRecentWorkspaces,
  type StoredWorkspace,
} from "@/modules/settings/store";
import type {
  FilePickerOptions,
  PickerPlace,
} from "@/modules/picker/pickerTypes";
import { getWslHome } from "./workspaceNative";
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


function isWorkspaceEnv(value: unknown): value is WorkspaceEnv {
  if (!value || typeof value !== "object") return false;
  const env = value as { kind?: unknown; distro?: unknown; profileId?: unknown };
  if (env.kind === "local") return true;
  if (env.kind === "wsl" && typeof env.distro === "string") return true;
  if (env.kind === "ssh" && typeof env.profileId === "string") return true;
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

function isUncPath(path: string): boolean {
  return path.startsWith("//");
}

function isWslUncPath(path: string): boolean {
  return /^\/\/wsl(?:\.localhost|\$)\//i.test(path);
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
 * Recent-workspace history + workspace directory picking.
 *
 * The active workspace set now lives in `workspacesPinia`. This store keeps
 * the historical/UX concerns that are still global: the recent list shown on
 * the welcome screen, and the per-env directory picking strategy —
 * 本机与 WSL 都走应用内选择器（picker 模块，浏览各自环境的文件系统），
 * SSH 走连接对话框。`rootPath` is retained as a derived view of the
 * currently active workspace for backward compatibility with callers that
 * haven't been migrated yet, but it is read-only here — all mutations go
 * through `workspacesPinia`.
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

  /** 本机选择器的初始路径：仅取 Windows 形态的当前工作区根。 */
  function pickerInitialPath(path: string | null): string | undefined {
    if (!path || path.startsWith("/")) return undefined;
    return path;
  }

  async function pickWorkspaceDirectory(
    env: WorkspaceEnv,
  ): Promise<WorkspaceSelection | null> {
    // SSH:不走目录选择对话框,而是连接对话框 —— 凭据校验 + 远端 HOME 探针
    // 一步完成,HOME 作为工作区根。口令进内存缓存供 pty_open 复用。
    if (env.kind === "ssh") {
      const { openSshConnectDialog } = await import("@/modules/ssh/sshConnectDialog");
      const { rememberSshSecret } = await import("@/modules/ssh/sshSecrets");
      const result = await openSshConnectDialog();
      if (!result) return null;
      const sshEnv: WorkspaceEnv = { kind: "ssh", profileId: result.profile.id };
      rememberSshSecret(sshEnv, result.secret);
      return { path: normalizeWorkspacePath(result.home), env: sshEnv };
    }
    // 本机与 WSL 统一走应用内选择器:浏览范围被限制在各自环境的文件系统里,
    // 选出的路径形态（C:/... 或 /home/...）必然与 env 匹配,不会像系统
    // 对话框那样在 WSL 工作区里混入 UNC / 盘符歧义。
    const { openFilePicker } = await import("@/modules/picker/filePickerDialog");
    if (env.kind === "wsl") {
      return pickWslDirectory(env, openFilePicker);
    }
    const selected = await openFilePicker({
      mode: "directory",
      workspace: env,
      initialPath: pickerInitialPath(rootPath.value),
    });
    if (!selected) return null;
    const path = normalizeWorkspacePath(selected);
    // 兜底:用户在手输路径里进入 \\wsl.localhost\... 时按本机处理。
    return { path, env: envForSelectedDirectory(path, env) };
  }

  async function pickWslDirectory(
    env: Extract<WorkspaceEnv, { kind: "wsl" }>,
    openFilePicker: (options: FilePickerOptions) => Promise<string | null>,
  ): Promise<WorkspaceSelection | null> {
    const selected = await openFilePicker({
      mode: "directory",
      workspace: env,
      initialPath: await resolveWslInitialPath(env),
      places: wslRecentPlaces(env),
    });
    if (!selected) return null;
    // 应用内选择器只能在目标发行版的 Linux 文件系统里浏览,返回的必然是
    // Linux 路径 —— 不需要 UNC 转换与 env 降级。
    return { path: normalizeWorkspacePath(selected), env };
  }

  /** 初始目录:优先同发行版的最近工作区,否则发行版 HOME。 */
  async function resolveWslInitialPath(
    env: Extract<WorkspaceEnv, { kind: "wsl" }>,
  ): Promise<string | undefined> {
    const recent = recentWorkspaces.value.find(
      (item) => item.env.kind === "wsl" && item.env.distro === env.distro,
    );
    if (recent && recent.path.startsWith("/")) return recent.path;
    try {
      return await getWslHome(env.distro);
    } catch {
      return undefined;
    }
  }

  /** 同一发行版的最近工作区作为快捷位置,最多 3 个。 */
  function wslRecentPlaces(
    env: Extract<WorkspaceEnv, { kind: "wsl" }>,
  ): PickerPlace[] {
    return recentWorkspaces.value
      .filter(
        (item) => item.env.kind === "wsl" && item.env.distro === env.distro,
      )
      .slice(0, 3)
      .map((item) => ({
        key: `recent:${item.path}`,
        label: basename(item.path) || item.path,
        path: item.path,
      }));
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
    pickerInitialPath,
    pickWorkspaceDirectory,
    pickWorkspaceDirectoryForEnv,
    chooseWorkspace,
    recordRecent,
    clearWorkspace,
    // Re-exported for tests / legacy callers that referenced these off the
    // root store. They delegate to the equivalent workspaces store methods.
    normalizeError: normalizeErrorMessage,
  };
});
