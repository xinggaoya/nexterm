import {
  getCurrentInstance,
  onBeforeUnmount,
  ref,
  watch,
  type Ref,
} from "vue";
import type {
  GitRepositoryDiscovery,
  GitWorkspaceRepo,
  WorkspaceFsChangedEvent,
} from "@/lib/native";
import { isSameRoot, normalizePath } from "./sourceControlFormat";

type GitRepositoryRegistryNative = {
  gitDiscoverRepositories: (
    rootPath: string,
    options?: { maxDepth?: number; maxRepos?: number },
  ) => Promise<GitRepositoryDiscovery>;
};

type GitRepositoryRegistryOptions = {
  rootPath: Ref<string | null>;
  workspaceScope: Ref<string>;
  fsEvent: Ref<WorkspaceFsChangedEvent | null | undefined>;
  native: GitRepositoryRegistryNative;
};

const DISCOVERY_OPTIONS = { maxDepth: 4, maxRepos: 32 } as const;
const FS_REFRESH_DEBOUNCE_MS = 250;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

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

  async function refresh() {
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
      const discovery = await options.native.gitDiscoverRepositories(
        root,
        DISCOVERY_OPTIONS,
      );
      if (!requestMatchesWorkspace(currentId, triggerOwner)) return;
      repositoriesOwner.value = triggerOwner;
      repositories.value = discovery.repositories;
      truncated.value = discovery.truncated;
    } catch (cause) {
      if (!requestMatchesWorkspace(currentId, triggerOwner)) return;
      error.value = errorMessage(cause);
    } finally {
      if (requestMatchesWorkspace(currentId, triggerOwner)) {
        loading.value = false;
      }
    }
  }

  function scheduleRefresh() {
    clearRefreshTimer();
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void refresh();
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
      if (owner && !disposed) void refresh();
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
