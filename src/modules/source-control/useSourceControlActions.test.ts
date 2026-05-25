// @vitest-environment jsdom
import { computed, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSourceControlActions } from "./useSourceControlActions";
import type { SourceControlRuntimeState } from "./useSourceControlState";
import type { SourceControlFileEntry } from "./sourceControlModel";
import { notifyError, notifySuccess } from "@/modules/notifications/notificationCenter";

vi.mock("@/modules/notifications/notificationCenter", () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

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
      gitFetch: vi.fn().mockResolvedValue({ updatedRefs: 0, prunedRefs: 0, summary: "Fetched latest refs" }),
      gitPullFfOnly: vi.fn().mockResolvedValue({
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
        alreadyUpToDate: true,
        summary: "Already up to date",
      }),
      gitPush: vi.fn().mockResolvedValue({ remote: "origin", branch: "main", pushed: true }),
      gitCheckoutBranch: vi.fn().mockResolvedValue({ branch: "feature" }),
      gitCreateBranch: vi.fn().mockResolvedValue({ branch: "feature" }),
      gitStashPush: vi.fn().mockResolvedValue({ stashed: true, message: "Saved working directory" }),
      gitStashPop: vi.fn().mockResolvedValue({ stashed: true, message: "Applied stash@{0}" }),
      gitStashDrop: vi.fn().mockResolvedValue({ stashed: true, message: "Dropped stash@{0}" }),
    };
    const committed = vi.fn();
    const refreshGitMetadata = vi.fn().mockResolvedValue(undefined);
    const actions = useSourceControlActions({
      state,
      native,
      dialog: { warning: vi.fn() },
      t: (key, params) => (params?.target ? `${key}:${params.target}` : key),
      emitCommitted: committed,
      refreshGitMetadata,
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
    expect(notifySuccess).toHaveBeenCalledWith("sourceControl.commitSuccess", "fix: test");
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
      gitPullFfOnly: vi.fn().mockResolvedValue({
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
        alreadyUpToDate: true,
        summary: "Already up to date",
      }),
      gitPush: vi.fn().mockResolvedValue({ remote: null, branch: null, pushed: true }),
      gitCheckoutBranch: vi.fn().mockResolvedValue({ branch: "feature" }),
      gitCreateBranch: vi.fn().mockResolvedValue({ branch: "feature" }),
      gitStashPush: vi.fn().mockResolvedValue({ stashed: true, message: "Saved working directory" }),
      gitStashPop: vi.fn().mockResolvedValue({ stashed: true, message: "Applied stash@{0}" }),
      gitStashDrop: vi.fn().mockResolvedValue({ stashed: true, message: "Dropped stash@{0}" }),
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
    expect(notifyError).toHaveBeenCalledWith("sourceControl.fetchFailed", "fetch failed");
    expect(state.busyAction.value).toBe(null);
  });

  it("notifies remote sync results with detailed pull statistics", async () => {
    const state = createState();
    const native = {
      gitStage: vi.fn().mockResolvedValue(undefined),
      gitUnstage: vi.fn().mockResolvedValue(undefined),
      gitDiscard: vi.fn().mockResolvedValue(undefined),
      gitCommit: vi.fn().mockResolvedValue({ commitSha: "abc", summary: "fix: test" }),
      gitFetch: vi.fn().mockResolvedValue({ updatedRefs: 2, prunedRefs: 1, summary: "2 refs updated, 1 pruned" }),
      gitPullFfOnly: vi.fn().mockResolvedValue({
        filesChanged: 3,
        insertions: 24,
        deletions: 6,
        alreadyUpToDate: false,
        summary: "3 files changed, +24 -6",
      }),
      gitPush: vi.fn().mockResolvedValue({ remote: "origin", branch: "main", pushed: true }),
      gitCheckoutBranch: vi.fn().mockResolvedValue({ branch: "feature" }),
      gitCreateBranch: vi.fn().mockResolvedValue({ branch: "feature" }),
      gitStashPush: vi.fn().mockResolvedValue({ stashed: true, message: "Saved working directory" }),
      gitStashPop: vi.fn().mockResolvedValue({ stashed: true, message: "Applied stash@{0}" }),
      gitStashDrop: vi.fn().mockResolvedValue({ stashed: true, message: "Dropped stash@{0}" }),
    };
    const actions = useSourceControlActions({
      state,
      native,
      dialog: { warning: vi.fn() },
      t: (key, params) => (params?.target ? `${key}:${params.target}` : key),
      emitCommitted: vi.fn(),
      refreshGitMetadata: vi.fn().mockResolvedValue(undefined),
    });

    await actions.fetchRemote();
    await actions.pullRemote();
    await actions.pushRemote();

    expect(notifySuccess).toHaveBeenCalledWith(
      "sourceControl.fetchSuccess",
      "2 refs updated, 1 pruned",
    );
    expect(notifySuccess).toHaveBeenCalledWith(
      "sourceControl.pullSuccess",
      "3 files changed, +24 -6",
    );
    expect(notifySuccess).toHaveBeenCalledWith(
      "sourceControl.pushSuccess",
      "sourceControl.pushedTo:origin/main",
    );
  });

  it("runs branch and stash workflows with refresh and notifications", async () => {
    const state = createState();
    const refreshGitMetadata = vi.fn().mockResolvedValue(undefined);
    const native = {
      gitStage: vi.fn().mockResolvedValue(undefined),
      gitUnstage: vi.fn().mockResolvedValue(undefined),
      gitDiscard: vi.fn().mockResolvedValue(undefined),
      gitCommit: vi.fn().mockResolvedValue({ commitSha: "abc", summary: "fix: test" }),
      gitFetch: vi.fn().mockResolvedValue({ updatedRefs: 0, prunedRefs: 0, summary: "Fetched latest refs" }),
      gitPullFfOnly: vi.fn().mockResolvedValue({
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
        alreadyUpToDate: true,
        summary: "Already up to date",
      }),
      gitPush: vi.fn().mockResolvedValue({ remote: "origin", branch: "main", pushed: true }),
      gitCheckoutBranch: vi.fn().mockResolvedValue({ branch: "feature" }),
      gitCreateBranch: vi.fn().mockResolvedValue({ branch: "feature/new" }),
      gitStashPush: vi.fn().mockResolvedValue({ stashed: true, message: "Saved working directory" }),
      gitStashPop: vi.fn().mockResolvedValue({ stashed: true, message: "Applied stash@{0}" }),
      gitStashDrop: vi.fn().mockResolvedValue({ stashed: true, message: "Dropped stash@{0}" }),
    };
    const actions = useSourceControlActions({
      state,
      native,
      dialog: { warning: vi.fn() },
      t: (key, params) => (params?.branch ? `${key}:${params.branch}` : key),
      emitCommitted: vi.fn(),
      refreshGitMetadata,
    });

    await actions.checkoutBranch({ name: "feature", isRemote: false });
    await actions.createBranch("feature/new");
    await actions.stashChanges("workspace checkpoint");
    await actions.popStash("stash@{0}");
    await actions.dropStash("stash@{0}");

    expect(native.gitCheckoutBranch).toHaveBeenCalledWith("/repo", "feature", false);
    expect(native.gitCreateBranch).toHaveBeenCalledWith("/repo", "feature/new");
    expect(native.gitStashPush).toHaveBeenCalledWith("/repo", {
      message: "workspace checkpoint",
      includeUntracked: true,
    });
    expect(native.gitStashPop).toHaveBeenCalledWith("/repo", "stash@{0}");
    expect(native.gitStashDrop).toHaveBeenCalledWith("/repo", "stash@{0}");
    expect(refreshGitMetadata).toHaveBeenCalled();
    expect(notifySuccess).toHaveBeenCalledWith(
      "sourceControl.branchCheckoutSuccess",
      "sourceControl.branchCheckoutDetail:feature",
    );
  });
});
