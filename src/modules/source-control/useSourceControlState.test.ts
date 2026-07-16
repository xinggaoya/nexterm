// @vitest-environment jsdom
import { nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSourceControlState } from "./useSourceControlState";
import type {
  GitPanelSnapshot,
  GitStatusSnapshot,
  WorkspaceFsChangedEvent,
} from "@/lib/native";

const readyStatus: GitStatusSnapshot = {
  repoRoot: "/repo",
  branch: "main",
  upstream: "origin/main",
  ahead: 1,
  behind: 0,
  isDetached: false,
  truncated: false,
  changedFiles: [],
};

const readySnapshot: GitPanelSnapshot = {
  repo: {
    repoRoot: "/repo",
    branch: "main",
    upstream: "origin/main",
    isDetached: false,
  },
  status: readyStatus,
};

function createNative() {
  return {
    workspaceAuthorize: vi.fn<(path: string) => Promise<string>>().mockResolvedValue("/repo"),
    gitPanelSnapshot: vi.fn<(cwd: string) => Promise<GitPanelSnapshot>>().mockResolvedValue(readySnapshot),
    gitStatus: vi.fn<(repoRoot: string) => Promise<GitStatusSnapshot>>().mockResolvedValue(readyStatus),
  };
}

async function flush() {
  await Promise.resolve();
  await nextTick();
}

describe("useSourceControlState", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("loads snapshots and derives source control state", async () => {
    const rootPath = ref<string | null>("/repo");
    const fsEvent = ref<WorkspaceFsChangedEvent | null>(null);
    const native = createNative();

    const state = useSourceControlState({
      rootPath,
      repoRoot: ref<string | null>(null),
      fsEvent,
      native,
      t: (key) => key,
    });
    await flush();

    expect(native.workspaceAuthorize).toHaveBeenCalledWith("/repo");
    expect(native.gitPanelSnapshot).toHaveBeenCalledWith("/repo");
    expect(state.panelState.value).toBe("ready");
    expect(state.repoRoot.value).toBe("/repo");
    expect(state.branchLabel.value).toBe("main");
  });

  it("debounces file-system events and waits for busy actions", async () => {
    vi.useFakeTimers();
    const rootPath = ref<string | null>("/repo");
    const fsEvent = ref<WorkspaceFsChangedEvent | null>(null);
    const native = createNative();
    const state = useSourceControlState({
      rootPath,
      repoRoot: ref<string | null>(null),
      fsEvent,
      native,
      t: (key) => key,
    });
    await flush();
    native.gitStatus.mockClear();

    state.busyAction.value = "stage-all";
    fsEvent.value = {
      rootPath: "/repo",
      paths: ["/repo/src/main.ts"],
      gitRelated: false,
    };
    await nextTick();
    await vi.advanceTimersByTimeAsync(2000);
    await flush();

    expect(native.gitStatus).not.toHaveBeenCalled();

    state.busyAction.value = null;
    await nextTick();
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    expect(native.gitStatus).toHaveBeenCalledWith("/repo");
  });

  it("coalesces overlapping status refreshes and keeps the latest result", async () => {
    const rootPath = ref<string | null>("/repo");
    const fsEvent = ref<WorkspaceFsChangedEvent | null>(null);
    const native = createNative();
    const deferred: Array<(status: GitStatusSnapshot) => void> = [];
    native.gitStatus.mockImplementation(
      () =>
        new Promise<GitStatusSnapshot>((resolve) => {
          deferred.push(resolve);
        }),
    );

    const state = useSourceControlState({
      rootPath,
      repoRoot: ref<string | null>(null),
      fsEvent,
      native,
      t: (key) => key,
    });
    await flush();
    native.gitStatus.mockClear();

    const first = state.refreshStatus();
    const second = state.refreshStatus();

    expect(native.gitStatus).toHaveBeenCalledTimes(1);

    deferred[0]({
      ...readyStatus,
      branch: "first",
      changedFiles: [],
    });
    await second;

    await vi.waitFor(() => {
      expect(native.gitStatus).toHaveBeenCalledTimes(2);
    });
    deferred[1]({
      ...readyStatus,
      branch: "second",
      changedFiles: [],
    });
    await first;
    await flush();

    expect(state.branchLabel.value).toBe("second");
  });

  it("loads the selected repository and ignores an older workspace snapshot", async () => {
    const rootPath = ref<string | null>("/workspace");
    const repoRoot = ref<string | null>(null);
    const fsEvent = ref<WorkspaceFsChangedEvent | null>(null);
    const native = createNative();
    const resolvers = new Map<string, (snapshot: GitPanelSnapshot) => void>();
    native.gitPanelSnapshot.mockImplementation(
      (root) =>
        new Promise<GitPanelSnapshot>((resolve) => {
          resolvers.set(root, resolve);
        }),
    );

    const state = useSourceControlState({
      rootPath,
      repoRoot,
      fsEvent,
      native,
      t: (key) => key,
    });
    await flush();
    expect(native.gitPanelSnapshot).toHaveBeenCalledWith("/workspace");

    repoRoot.value = "/workspace/apps/web";
    await flush();
    expect(native.gitPanelSnapshot).toHaveBeenCalledWith("/workspace/apps/web");

    const selectedStatus = {
      ...readyStatus,
      repoRoot: "/workspace/apps/web",
      branch: "web-main",
    };
    resolvers.get("/workspace/apps/web")?.({
      repo: {
        repoRoot: "/workspace/apps/web",
        branch: "web-main",
        upstream: null,
        isDetached: false,
      },
      status: selectedStatus,
    });
    await flush();
    expect(state.repoRoot.value).toBe("/workspace/apps/web");
    expect(state.branchLabel.value).toBe("web-main");

    resolvers.get("/workspace")?.(readySnapshot);
    await flush();
    expect(state.repoRoot.value).toBe("/workspace/apps/web");
  });

  it("invalidates delayed status work immediately when the selected repository changes", async () => {
    vi.useFakeTimers();
    const rootPath = ref<string | null>("/workspace");
    const selectedRepoRoot = ref<string | null>("/repo-a");
    const fsEvent = ref<WorkspaceFsChangedEvent | null>(null);
    const native = createNative();
    const statusA: GitStatusSnapshot = {
      ...readyStatus,
      repoRoot: "/repo-a",
      branch: "repo-a",
      changedFiles: [
        {
          path: "src/a.ts",
          originalPath: null,
          indexStatus: " ",
          worktreeStatus: "M",
          staged: false,
          unstaged: true,
          untracked: false,
          statusLabel: "Modified",
        },
      ],
    };
    const snapshotA: GitPanelSnapshot = {
      repo: {
        repoRoot: "/repo-a",
        branch: "repo-a",
        upstream: null,
        isDetached: false,
      },
      status: statusA,
    };
    const statusB: GitStatusSnapshot = {
      ...readyStatus,
      repoRoot: "/repo-b",
      branch: "repo-b",
    };
    const snapshotB: GitPanelSnapshot = {
      repo: {
        repoRoot: "/repo-b",
        branch: "repo-b",
        upstream: null,
        isDetached: false,
      },
      status: statusB,
    };
    let resolveSnapshotB!: (snapshot: GitPanelSnapshot) => void;
    native.gitPanelSnapshot.mockImplementation((root) => {
      if (root === "/repo-a") return Promise.resolve(snapshotA);
      return new Promise<GitPanelSnapshot>((resolve) => {
        resolveSnapshotB = resolve;
      });
    });
    let resolveStatusA!: (status: GitStatusSnapshot) => void;
    let statusACallCount = 0;
    native.gitStatus.mockImplementation((root) => {
      if (root === "/repo-a") {
        statusACallCount += 1;
        if (statusACallCount === 1) {
          return new Promise<GitStatusSnapshot>((resolve) => {
            resolveStatusA = resolve;
          });
        }
        return Promise.resolve({ ...statusA, branch: "stale-repo-a" });
      }
      return Promise.resolve(statusB);
    });

    const state = useSourceControlState({
      rootPath,
      repoRoot: selectedRepoRoot,
      fsEvent,
      native,
      t: (key) => key,
    });
    await flush();
    expect(state.repoRoot.value).toBe("/repo-a");
    expect(state.gitDecorations.value.size).toBeGreaterThan(0);

    state.scheduleAutoRefresh(20);
    const refreshA = state.refreshStatus();
    expect(native.gitStatus).toHaveBeenCalledWith("/repo-a");

    selectedRepoRoot.value = "/repo-b";

    expect(state.repo.value).toBeNull();
    expect(state.status.value).toBeNull();
    expect(state.gitDecorations.value.size).toBe(0);
    expect(state.panelState.value).toBe("loading");

    await flush();
    await vi.advanceTimersByTimeAsync(20);
    resolveStatusA({ ...statusA, branch: "late-repo-a" });
    await refreshA;
    await flush();

    expect(
      native.gitStatus.mock.calls.filter(([root]) => root === "/repo-a"),
    ).toHaveLength(1);
    expect(state.status.value).toBeNull();
    expect(state.panelState.value).toBe("loading");

    resolveSnapshotB(snapshotB);
    await flush();

    expect(state.repoRoot.value).toBe("/repo-b");
    expect(state.branchLabel.value).toBe("repo-b");
    expect(state.panelState.value).toBe("ready");
  });

  it("dispose invalidates a delayed snapshot and its scheduled refresh", async () => {
    vi.useFakeTimers();
    const rootPath = ref<string | null>("/repo");
    const fsEvent = ref<WorkspaceFsChangedEvent | null>(null);
    const native = createNative();
    let resolveSnapshot!: (snapshot: GitPanelSnapshot) => void;
    native.gitPanelSnapshot.mockImplementation(
      () =>
        new Promise<GitPanelSnapshot>((resolve) => {
          resolveSnapshot = resolve;
        }),
    );

    const state = useSourceControlState({
      rootPath,
      repoRoot: ref<string | null>(null),
      fsEvent,
      native,
      t: (key) => key,
    });
    await flush();
    expect(state.panelState.value).toBe("loading");

    state.scheduleAutoRefresh(20);
    state.dispose();
    resolveSnapshot(readySnapshot);
    await flush();
    await vi.advanceTimersByTimeAsync(20);
    await flush();

    expect(state.status.value).toBeNull();
    expect(state.panelState.value).toBe("loading");
    expect(native.gitPanelSnapshot).toHaveBeenCalledTimes(1);
    expect(native.gitStatus).not.toHaveBeenCalled();
  });

  it("dispose invalidates delayed status and cancels its pending refresh", async () => {
    const rootPath = ref<string | null>("/repo");
    const fsEvent = ref<WorkspaceFsChangedEvent | null>(null);
    const native = createNative();
    let resolveStatus!: (status: GitStatusSnapshot) => void;

    const state = useSourceControlState({
      rootPath,
      repoRoot: ref<string | null>(null),
      fsEvent,
      native,
      t: (key) => key,
    });
    await flush();
    native.gitStatus.mockClear();
    native.gitStatus
      .mockImplementationOnce(
        () =>
          new Promise<GitStatusSnapshot>((resolve) => {
            resolveStatus = resolve;
          }),
      )
      .mockResolvedValueOnce({ ...readyStatus, branch: "after-dispose" });

    const firstRefresh = state.refreshStatus();
    const pendingRefresh = state.refreshStatus();
    expect(native.gitStatus).toHaveBeenCalledTimes(1);

    state.dispose();
    resolveStatus({ ...readyStatus, branch: "late-status" });
    await Promise.all([firstRefresh, pendingRefresh]);
    await flush();

    expect(native.gitStatus).toHaveBeenCalledTimes(1);
    expect(state.branchLabel.value).toBe("main");
    expect(state.panelState.value).toBe("ready");
  });
});
