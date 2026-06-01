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
});
