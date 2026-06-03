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
  GitPanelSnapshot,
  GitRepoInfo,
  GitStatusSnapshot,
  WorkspaceFsChangedEvent,
} from "@/lib/native";
import type { ReadonlyRef } from "@/lib/refs";
import {
  buildSourceControlEntries,
  discardEntriesForEntries,
  pathsToStage,
  pathsToUnstage,
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
  | `stash-drop:${string}`;
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

type SourceControlStateNative = {
  workspaceAuthorize: (path: string) => Promise<unknown>;
  gitPanelSnapshot: (cwd: string) => Promise<GitPanelSnapshot>;
  gitStatus: (repoRoot: string) => Promise<GitStatusSnapshot>;
};

type SourceControlStateOptions = {
  rootPath: Ref<string | null>;
  fsEvent: Ref<WorkspaceFsChangedEvent | null | undefined>;
  native: SourceControlStateNative;
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
  const stagedCount = computed(
    () => entries.value.filter((entry) => entry.staged).length,
  );
  const changedCount = computed(() => entries.value.length);
  const stageAllPaths = computed(() => pathsToStage(entries.value));
  const unstageAllPaths = computed(() => pathsToUnstage(entries.value));
  const discardAllEntries = computed(() => discardEntriesForEntries(entries.value));

  async function loadSnapshot(rootPath: string | null) {
    const currentId = ++requestId.value;

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
      await options.native.workspaceAuthorize(rootPath);
      if (currentId !== requestId.value) return;
      const snapshot = await options.native.gitPanelSnapshot(rootPath);
      if (currentId !== requestId.value) return;
      repo.value = snapshot.repo;
      status.value = snapshot.status;
      gitDecorations.value = buildGitDecorationMap(
        snapshot.status?.repoRoot ?? null,
        snapshot.status?.changedFiles ?? [],
      );
      panelState.value = snapshot.repo && snapshot.status ? "ready" : "no-repo";
    } catch (error) {
      if (currentId !== requestId.value) return;
      repo.value = null;
      status.value = null;
      errorMessage.value = normalizeError(error, options.t);
      panelState.value = "error";
    }
  }

  async function refreshStatus() {
    const root = repoRoot.value;
    if (!root) {
      await loadSnapshot(options.rootPath.value);
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
        const next = await options.native.gitStatus(root);
        if (currentId !== requestId.value) return;

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
        if (currentId !== requestId.value) return;
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
    await loadSnapshot(options.rootPath.value);
  }

  async function autoRefresh() {
    if (busyAction.value) {
      pendingAutoRefresh.value = true;
      return;
    }
    await reloadCurrent();
  }

  function scheduleAutoRefresh(delay = 260) {
    if (!options.rootPath.value) return;
    if (autoRefreshTimer) clearTimeout(autoRefreshTimer);
    autoRefreshTimer = setTimeout(() => {
      autoRefreshTimer = null;
      void autoRefresh();
    }, delay);
  }

  function dispose() {
    if (autoRefreshTimer) clearTimeout(autoRefreshTimer);
    autoRefreshTimer = null;
  }

  watch(
    options.rootPath,
    (rootPath) => {
      void loadSnapshot(rootPath);
    },
    { immediate: true },
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
