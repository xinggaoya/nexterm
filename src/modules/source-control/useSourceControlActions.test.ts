// @vitest-environment jsdom
import { computed, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSourceControlActions } from "./useSourceControlActions";
import type { SourceControlRuntimeState } from "./useSourceControlState";
import type { SourceControlFileEntry } from "./sourceControlModel";

function entry(overrides: Partial<SourceControlFileEntry>): SourceControlFileEntry {
  return {
    key: "src/main.ts",
    path: "src/main.ts",
    originalPath: null,
    statusCode: "M",
    statusLabel: "Modified",
    checkState: "unchecked",
    staged: false,
    unstaged: true,
    untracked: false,
    ...overrides,
  };
}

function createState(): SourceControlRuntimeState {
  const entries = ref([
    entry({ path: "src/unstaged.ts", unstaged: true }),
    entry({ path: "src/staged.ts", staged: true, unstaged: false, checkState: "checked" }),
  ]);
  return {
    busyAction: ref(null),
    repoRoot: ref("/repo"),
    entries,
    stagedCount: computed(() => entries.value.filter((item) => item.staged).length),
    stageAllPaths: computed(() =>
      entries.value.filter((item) => item.unstaged).map((item) => item.path),
    ),
    unstageAllPaths: computed(() =>
      entries.value.filter((item) => item.staged).map((item) => item.path),
    ),
    discardAllEntries: computed(() =>
      entries.value
        .filter((item) => item.unstaged)
        .map((item) => ({ path: item.path, untracked: item.untracked })),
    ),
    refreshStatus: vi.fn().mockResolvedValue(undefined),
    loadSnapshot: vi.fn().mockResolvedValue(undefined),
  };
}

describe("useSourceControlActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs staged actions through shared busy and refresh handling", async () => {
    const state = createState();
    const native = {
      gitStage: vi.fn().mockResolvedValue(undefined),
      gitUnstage: vi.fn().mockResolvedValue(undefined),
      gitDiscard: vi.fn().mockResolvedValue(undefined),
      gitCommit: vi.fn().mockResolvedValue({ commitSha: "abc", summary: "fix: test" }),
      gitFetch: vi.fn().mockResolvedValue(undefined),
      gitPullFfOnly: vi.fn().mockResolvedValue(undefined),
      gitPush: vi.fn().mockResolvedValue({ remote: "origin", branch: "main", pushed: true }),
    };
    const committed = vi.fn();
    const actions = useSourceControlActions({
      state,
      native,
      dialog: { warning: vi.fn() },
      t: (key, params) => (params?.target ? `${key}:${params.target}` : key),
      emitCommitted: committed,
    });

    await actions.stageAll();

    expect(native.gitStage).toHaveBeenCalledWith("/repo", ["src/unstaged.ts"]);
    expect(state.refreshStatus).toHaveBeenCalledTimes(1);
    expect(state.busyAction.value).toBe(null);

    actions.commitMessage.value = "fix: test";
    await actions.commit();

    expect(native.gitCommit).toHaveBeenCalledWith("/repo", "fix: test");
    expect(committed).toHaveBeenCalledWith({ commitSha: "abc", summary: "fix: test" });
    expect(actions.commitMessage.value).toBe("");
  });

  it("guards concurrent actions and reports errors", async () => {
    const state = createState();
    state.busyAction.value = "pull";
    const native = {
      gitStage: vi.fn().mockResolvedValue(undefined),
      gitUnstage: vi.fn().mockResolvedValue(undefined),
      gitDiscard: vi.fn().mockResolvedValue(undefined),
      gitCommit: vi.fn().mockResolvedValue({ commitSha: "abc", summary: "fix: test" }),
      gitFetch: vi.fn().mockRejectedValue("fetch failed"),
      gitPullFfOnly: vi.fn().mockResolvedValue(undefined),
      gitPush: vi.fn().mockResolvedValue({ remote: null, branch: null, pushed: true }),
    };
    const actions = useSourceControlActions({
      state,
      native,
      dialog: { warning: vi.fn() },
      t: (key) => key,
      emitCommitted: vi.fn(),
    });

    await actions.stageAll();
    expect(native.gitStage).not.toHaveBeenCalled();

    state.busyAction.value = null;
    await actions.fetchRemote();

    expect(actions.actionError.value).toBe("fetch failed");
    expect(state.busyAction.value).toBe(null);
  });
});
