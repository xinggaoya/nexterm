import {
  getCurrentInstance,
  onBeforeUnmount,
  ref,
  watch,
  type Ref,
} from "vue";
import type {
  GitWorkspaceRepo,
  WorkspaceFsChangedEvent,
  WorkspaceNative,
} from "@/lib/native";
import { normalizeErrorMessage } from "@/lib/error";
import { gitDiscoverCoordinator } from "./gitDiscoverCoordinator";
import { isSameRoot, normalizePath } from "./sourceControlFormat";

type GitRepositoryRegistryOptions = {
  rootPath: Ref<string | null>;
  workspaceScope: Ref<string>;
  fsEvent: Ref<WorkspaceFsChangedEvent | null | undefined>;
  /** 绑定到目标 workspace 环境的 native 调用面（git 仓库发现）。 */
  wsNative: WorkspaceNative;
};

const DISCOVERY_OPTIONS = { maxDepth: 4, maxRepos: 32 } as const;
const FS_REFRESH_DEBOUNCE_MS = 250;

function ownershipKey(
  scope: string,
  root: string | null | undefined,
): string | null {
  const normalized = root ? normalizePath(root) : null;
  return normalized ? `${scope}\0${normalized}` : null;
}

export function useGitRepositoryRegistry(
  options: GitRepositoryRegistryOptions,
) {
  const repositories = ref<GitWorkspaceRepo[]>([]);
  const repositoriesOwner = ref<string | null>(null);
  const truncated = ref(false);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let requestId = 0;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function clearRefreshTimer() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  function clearRegistry() {
    repositories.value = [];
    repositoriesOwner.value = null;
    truncated.value = false;
    loading.value = false;
    error.value = null;
  }

  function requestMatchesWorkspace(
    currentId: number,
    triggerOwner: string,
  ): boolean {
    return (
      !disposed &&
      currentId === requestId &&
      ownershipKey(options.workspaceScope.value, options.rootPath.value) ===
        triggerOwner
    );
  }

  /**
   * 拉一次仓库列表。
   *
   * @param fresh 是否要求最新结果，默认 `true`（显式刷新就该拿到最新
   *   数据）。工作区里刚 `git init` 出来的仓库必须立刻可见，不能被缓存
   *   窗口挡住（否则没有后续 FS 事件时它就永远不出现）。
   *   只有「初始化」路径用 `false` —— 那时多个面板实例会同时问同一个
   *   工作区，复用同一份结果即可。
   */
  async function refresh(fresh = true) {
    const root = options.rootPath.value;
    const triggerOwner = ownershipKey(options.workspaceScope.value, root);
    const currentId = ++requestId;

    if (!root || !triggerOwner || disposed) {
      clearRegistry();
      return;
    }

    loading.value = true;
    error.value = null;
    try {
      // 走全局协调器：同一 (scope, root) 的并发请求合并成一次后端调用，
      // 短时间内重复的请求由 TTL 缓存挡下。发现本身很贵（遍历目录树 +
      // 每个候选仓库 fork git 进程），不合并的话多面板场景会把它打到
      // 每秒数次，把后端 blocking pool 占满。
      const discovery = await gitDiscoverCoordinator.request({
        scope: options.workspaceScope.value,
        rootPath: root,
        maxDepth: DISCOVERY_OPTIONS.maxDepth,
        maxRepos: DISCOVERY_OPTIONS.maxRepos,
        fresh,
        wsNative: options.wsNative,
      });
      if (!requestMatchesWorkspace(currentId, triggerOwner)) return;
      repositoriesOwner.value = triggerOwner;
      repositories.value = discovery.repositories;
      truncated.value = discovery.truncated;
    } catch (cause) {
      if (!requestMatchesWorkspace(currentId, triggerOwner)) return;
      error.value = normalizeErrorMessage(cause);
    } finally {
      if (requestMatchesWorkspace(currentId, triggerOwner)) {
        loading.value = false;
      }
    }
  }

  function scheduleRefresh(fresh = true) {
    clearRefreshTimer();
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void refresh(fresh);
    }, FS_REFRESH_DEBOUNCE_MS);
  }

  function isCurrentWorkspaceList(): boolean {
    const currentOwner = ownershipKey(
      options.workspaceScope.value,
      options.rootPath.value,
    );
    return !!currentOwner && repositoriesOwner.value === currentOwner;
  }

  function isValidRepoRoot(repoRoot: string | null): boolean {
    if (!repoRoot || !isCurrentWorkspaceList()) return false;
    return repositories.value.some((repo) =>
      isSameRoot(repo.repoRoot, repoRoot),
    );
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    requestId += 1;
    clearRefreshTimer();
  }

  watch(
    () => ownershipKey(options.workspaceScope.value, options.rootPath.value),
    (owner, previousOwner) => {
      if (owner === previousOwner) return;
      clearRefreshTimer();
      requestId += 1;
      clearRegistry();
      // 初始化路径：用缓存即可 —— 同一时刻多个面板实例会问同一个工作区，
      // 复用同一份结果，避免重复打后端（发现很贵）。
      if (owner && !disposed) void refresh(false);
    },
    { immediate: true, flush: "sync" },
  );

  watch(options.fsEvent, (event) => {
    if (!event || !isSameRoot(event.rootPath, options.rootPath.value)) return;
    scheduleRefresh();
  });

  if (getCurrentInstance()) onBeforeUnmount(dispose);

  return {
    repositories,
    truncated,
    loading,
    error,
    refresh,
    isCurrentWorkspaceList,
    isValidRepoRoot,
    dispose,
  };
}
