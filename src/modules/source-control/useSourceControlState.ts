import {
  computed,
  getCurrentInstance,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref,
} from "vue";
import type {
  GitDiscardEntry,
  GitRepoInfo,
  GitStatusSnapshot,
  WorkspaceFsChangedEvent,
  WorkspaceNative,
} from "@/lib/native";
import type { ReadonlyRef } from "@/lib/refs";
import {
  buildSourceControlEntries,
  type SourceControlFileEntry,
} from "./sourceControlModel";
import { buildGitDecorationMap, type GitDecorationMap } from "./gitDecorations";
import { isSameRoot, normalizeError, type SourceControlTranslate } from "./sourceControlFormat";

export type PanelState = "idle" | "loading" | "no-root" | "no-repo" | "ready" | "error";
export type BusyAction =
  | "refresh"
  | "commit"
  | "stage-all"
  | "unstage-all"
  | "discard-all"
  | "stage-selected"
  | "unstage-selected"
  | "discard-selected"
  | "fetch"
  | "pull"
  | "push"
  | "branch-create"
  | "stash-save"
  | `stage:${string}`
  | `unstage:${string}`
  | `discard:${string}`
  | `checkout:${string}`
  | `stash-pop:${string}`
  | `stash-drop:${string}`
  | `stash-apply:${string}`;
export type SourceControlRuntimeState = {
  busyAction: Ref<BusyAction | null>;
  repoRoot: ReadonlyRef<string | null>;
  entries: ReadonlyRef<SourceControlFileEntry[]>;
  gitDecorations: ReadonlyRef<GitDecorationMap>;
  stagedCount: ReadonlyRef<number>;
  stageAllPaths: ReadonlyRef<string[]>;
  unstageAllPaths: ReadonlyRef<string[]>;
  discardAllEntries: ReadonlyRef<GitDiscardEntry[]>;
  refreshStatus: () => Promise<void>;
  loadSnapshot: (rootPath: string | null) => Promise<void>;
  reloadCurrent?: () => Promise<void>;
};

type SourceControlStateOptions = {
  rootPath: Ref<string | null>;
  repoRoot: ReadonlyRef<string | null>;
  fsEvent: Ref<WorkspaceFsChangedEvent | null | undefined>;
  /** 绑定到目标 workspace 环境的 native 调用面（git/fs/workspaceAuthorize）。 */
  wsNative: WorkspaceNative;
  t: SourceControlTranslate;
};

export function useSourceControlState(options: SourceControlStateOptions) {
  const panelState = ref<PanelState>("idle");
  const repo = ref<GitRepoInfo | null>(null);
  const status = ref<GitStatusSnapshot | null>(null);
  const errorMessage = ref<string | null>(null);
  const busyAction = ref<BusyAction | null>(null);
  const requestId = ref(0);
  const pendingAutoRefresh = ref(false);
  let statusRefreshInFlight: Promise<void> | null = null;
  let pendingStatusRefresh = false;
  let autoRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  const effectiveRoot = computed(
    () => options.repoRoot.value ?? options.rootPath.value,
  );
  const entries = computed(() =>
    buildSourceControlEntries(status.value?.changedFiles ?? []),
  );
  const repoRoot = computed(() => status.value?.repoRoot ?? repo.value?.repoRoot ?? null);
  const gitDecorations = shallowRef<GitDecorationMap>(new Map());
  const branchLabel = computed(() => {
    const current = status.value ?? repo.value;
    if (!current) return options.t("app.header.sourceControl");
    return current.isDetached ? "detached" : current.branch;
  });
  // Aggregate every list-level metric (counts, stage/unstage/discard
  // paths) in a single pass over `entries` to avoid re-traversing the
  // array once per derived state. With ~5000 changed files the previous
  // per-computed traversals were O(5N) re-evaluations.
  const derived = computed(() => {
    const source = entries.value;
    let stagedCount = 0;
    const stagePaths: string[] = [];
    const unstagePaths: string[] = [];
    const discardEntries: GitDiscardEntry[] = [];
    for (const entry of source) {
      if (entry.staged) stagedCount++;
      if (entry.group === "changes" && entry.unstaged) {
        stagePaths.push(entry.path);
        discardEntries.push({ path: entry.path, untracked: entry.untracked });
      }
      if (entry.group === "staged" && entry.staged) {
        unstagePaths.push(entry.path);
      }
    }
    return {
      stagedCount,
      changedCount: source.length,
      stageAllPaths: stagePaths,
      unstageAllPaths: unstagePaths,
      discardAllEntries: discardEntries,
    };
  });
  const stagedCount = computed(() => derived.value.stagedCount);
  const changedCount = computed(() => derived.value.changedCount);
  const stageAllPaths = computed(() => derived.value.stageAllPaths);
  const unstageAllPaths = computed(() => derived.value.unstageAllPaths);
  const discardAllEntries = computed(() => derived.value.discardAllEntries);

  function requestMatchesRoot(
    currentId: number,
    triggerRoot: string | null,
  ): boolean {
    const currentRoot = effectiveRoot.value;
    const sameRoot =
      currentRoot === null || triggerRoot === null
        ? currentRoot === triggerRoot
        : isSameRoot(currentRoot, triggerRoot);
    return currentId === requestId.value && sameRoot;
  }

  function beginRootGeneration(rootPath: string | null): number {
    const currentId = ++requestId.value;
    if (autoRefreshTimer) clearTimeout(autoRefreshTimer);
    autoRefreshTimer = null;
    statusRefreshInFlight = null;
    pendingStatusRefresh = false;
    pendingAutoRefresh.value = false;
    repo.value = null;
    status.value = null;
    gitDecorations.value = new Map();
    errorMessage.value = null;
    panelState.value = rootPath ? "loading" : "no-root";
    return currentId;
  }

  async function loadSnapshot(
    rootPath: string | null,
    generationId?: number,
  ) {
    const currentId = generationId ?? ++requestId.value;
    if (!requestMatchesRoot(currentId, rootPath)) return;

    if (!rootPath) {
      panelState.value = "no-root";
      repo.value = null;
      status.value = null;
      errorMessage.value = null;
      return;
    }

    panelState.value = "loading";
    errorMessage.value = null;
    try {
      await options.wsNative.workspaceAuthorize(rootPath);
      if (!requestMatchesRoot(currentId, rootPath)) return;
      const snapshot = await options.wsNative.gitPanelSnapshot(rootPath);
      if (!requestMatchesRoot(currentId, rootPath)) return;
      repo.value = snapshot.repo;
      status.value = snapshot.status;
      gitDecorations.value = buildGitDecorationMap(
        snapshot.status?.repoRoot ?? null,
        snapshot.status?.changedFiles ?? [],
      );
      panelState.value = snapshot.repo && snapshot.status ? "ready" : "no-repo";
    } catch (error) {
      if (!requestMatchesRoot(currentId, rootPath)) return;
      repo.value = null;
      status.value = null;
      gitDecorations.value = new Map();
      errorMessage.value = normalizeError(error, options.t);
      panelState.value = "error";
    }
  }

  async function refreshStatus() {
    const triggerRoot = effectiveRoot.value;
    const statusRoot = repoRoot.value;
    if (!statusRoot) {
      await loadSnapshot(triggerRoot);
      return;
    }
    if (statusRefreshInFlight) {
      pendingStatusRefresh = true;
      await statusRefreshInFlight;
      return;
    }

    const currentId = ++requestId.value;
    const refresh = (async () => {
      try {
        const next = await options.wsNative.gitStatus(statusRoot);
        if (!requestMatchesRoot(currentId, triggerRoot)) return;

        // Only rebuild git decorations if changed files actually differ.
        // This avoids triggering downstream reactive updates when the
        // file tree has not changed, which would cause unnecessary
        // rebuilds in the file explorer.
        const prevFiles = status.value?.changedFiles ?? [];
        const nextFiles = next.changedFiles;
        const filesChanged =
          prevFiles.length !== nextFiles.length ||
          prevFiles.some(
            (f, i) =>
              f.path !== nextFiles[i].path ||
              f.staged !== nextFiles[i].staged ||
              f.unstaged !== nextFiles[i].unstaged,
          );

        status.value = next;
        repo.value = {
          repoRoot: next.repoRoot,
          branch: next.branch,
          upstream: next.upstream,
          isDetached: next.isDetached,
        };
        if (filesChanged) {
          gitDecorations.value = buildGitDecorationMap(next.repoRoot, nextFiles);
        }
        panelState.value = "ready";
      } catch (error) {
        if (!requestMatchesRoot(currentId, triggerRoot)) return;
        errorMessage.value = normalizeError(error, options.t);
        panelState.value = "error";
      }
    })();

    statusRefreshInFlight = refresh;
    try {
      await refresh;
    } finally {
      if (statusRefreshInFlight === refresh) {
        statusRefreshInFlight = null;
      }
      if (!requestMatchesRoot(currentId, triggerRoot)) return;
      if (pendingStatusRefresh) {
        pendingStatusRefresh = false;
        if (busyAction.value) {
          pendingAutoRefresh.value = true;
        } else {
          await refreshStatus();
        }
      }
    }
  }

  async function reloadCurrent() {
    if (repoRoot.value) {
      await refreshStatus();
      return;
    }
    await loadSnapshot(effectiveRoot.value);
  }

  async function autoRefresh() {
    if (busyAction.value) {
      pendingAutoRefresh.value = true;
      return;
    }
    await reloadCurrent();
  }

  function scheduleAutoRefresh(delay = 260) {
    if (!effectiveRoot.value) return;
    if (autoRefreshTimer) clearTimeout(autoRefreshTimer);
    autoRefreshTimer = setTimeout(() => {
      autoRefreshTimer = null;
      void autoRefresh();
    }, delay);
  }

  function dispose() {
    requestId.value += 1;
    if (autoRefreshTimer) clearTimeout(autoRefreshTimer);
    autoRefreshTimer = null;
    statusRefreshInFlight = null;
    pendingStatusRefresh = false;
    pendingAutoRefresh.value = false;
  }

  watch(
    effectiveRoot,
    (rootPath) => {
      const generationId = beginRootGeneration(rootPath);
      void loadSnapshot(rootPath, generationId);
    },
    { immediate: true, flush: "sync" },
  );

  watch(options.fsEvent, (event) => {
    if (!event || !isSameRoot(event.rootPath, options.rootPath.value)) return;
    // Git-related events get fast refresh; non-git events still refresh,
    // just with a slightly longer debounce so we don't hammer `git status`
    // during unrelated churn (e.g. `node_modules` rebuilds in a non-git
    // directory).
    scheduleAutoRefresh(event.gitRelated ? 80 : 500);
  });

  watch(busyAction, (value) => {
    if (value || !pendingAutoRefresh.value) return;
    pendingAutoRefresh.value = false;
    scheduleAutoRefresh(80);
  });

  if (getCurrentInstance()) {
    onBeforeUnmount(dispose);
  }

  return {
    panelState,
    repo,
    status: status as Ref<GitStatusSnapshot | null>,
    errorMessage,
    busyAction,
    entries: entries as ComputedRef<SourceControlFileEntry[]>,
    gitDecorations: gitDecorations as Ref<GitDecorationMap>,
    repoRoot,
    branchLabel,
    stagedCount,
    changedCount,
    stageAllPaths,
    unstageAllPaths,
    discardAllEntries,
    loadSnapshot,
    refreshStatus,
    reloadCurrent,
    scheduleAutoRefresh,
    dispose,
  };
}
