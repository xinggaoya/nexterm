import {
  computed,
  getCurrentInstance,
  onBeforeUnmount,
  ref,
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
import {
  buildSourceControlEntries,
  discardEntriesForEntries,
  pathsToStage,
  pathsToUnstage,
  type SourceControlFileEntry,
} from "./sourceControlModel";
import { isSameRoot, normalizeError, type SourceControlTranslate } from "./sourceControlFormat";

export type PanelState = "idle" | "loading" | "no-root" | "no-repo" | "ready" | "error";
export type BusyAction =
  | "refresh"
  | "commit"
  | "stage-all"
  | "unstage-all"
  | "discard-all"
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

export type ReadableRef<T> = {
  readonly value: T;
};

export type SourceControlRuntimeState = {
  busyAction: Ref<BusyAction | null>;
  repoRoot: ReadableRef<string | null>;
  entries: ReadableRef<SourceControlFileEntry[]>;
  stagedCount: ReadableRef<number>;
  stageAllPaths: ReadableRef<string[]>;
  unstageAllPaths: ReadableRef<string[]>;
  discardAllEntries: ReadableRef<GitDiscardEntry[]>;
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
        status.value = next;
        repo.value = {
          repoRoot: next.repoRoot,
          branch: next.branch,
          upstream: next.upstream,
          isDetached: next.isDetached,
        };
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
    scheduleAutoRefresh(event.gitRelated ? 80 : 650);
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
