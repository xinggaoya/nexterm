// @vitest-environment jsdom
import { computed, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSourceControlActions } from "./useSourceControlActions";
import type { SourceControlRuntimeState } from "./useSourceControlState";
import type { SourceControlFileEntry } from "./sourceControlModel";
import { notifyError, notifyInfo, notifySuccess } from "@/modules/notifications/notificationCenter";

vi.mock("@/modules/notifications/notificationCenter", () => ({
  notifyError: vi.fn(),
  notifyInfo: vi.fn(),
  notifySuccess: vi.fn(),
}));

function entry(overrides: Partial<SourceControlFileEntry>): SourceControlFileEntry {
  return {
    key: "src/main.ts",
    group: "changes",
    path: "src/main.ts",
    originalPath: null,
    statusCode: "M",
    statusLabel: "Modified",
    statusKind: "modified",
    diffMode: "-",
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
    gitDecorations: computed(() => new Map()),
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
      gitStashApply: vi.fn().mockResolvedValue({ stashed: true, message: "Applied stash@{0}" }),
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
      gitStashApply: vi.fn().mockResolvedValue({ stashed: true, message: "Applied stash@{0}" }),
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
      gitStashApply: vi.fn().mockResolvedValue({ stashed: true, message: "Applied stash@{0}" }),
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
      gitStashApply: vi.fn().mockResolvedValue({ stashed: true, message: "Applied stash@{0}" }),
    };
    const confirmDrop = vi.fn(
      ({ onPositiveClick }: { onPositiveClick: () => void | Promise<void> }) =>
        onPositiveClick(),
    );
    const actions = useSourceControlActions({
      state,
      native,
      dialog: { warning: confirmDrop },
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

  it("omits optional fields and forwards stable selectors for stash workflows", async () => {
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
      gitCheckoutBranch: vi.fn().mockResolvedValue({ branch: "origin/feature" }),
      gitCreateBranch: vi.fn().mockResolvedValue({ branch: "feature/new" }),
      gitStashPush: vi.fn().mockResolvedValue({ stashed: true, message: "Saved working directory" }),
      gitStashPop: vi.fn().mockResolvedValue({ stashed: true, message: "Applied stash@{0}" }),
      gitStashDrop: vi.fn().mockResolvedValue({ stashed: true, message: "Dropped stash@{0}" }),
      gitStashApply: vi.fn().mockResolvedValue({ stashed: true, message: "Applied stash@{0}" }),
    };
    const confirmDrop = vi.fn(
      ({ onPositiveClick }: { onPositiveClick: () => void | Promise<void> }) =>
        onPositiveClick(),
    );
    const actions = useSourceControlActions({
      state,
      native,
      dialog: { warning: confirmDrop },
      t: (key) => key,
      emitCommitted: vi.fn(),
      refreshGitMetadata,
    });

    // Default push keeps the prior payload: only `message` + `includeUntracked`.
    await actions.stashChanges();
    expect(native.gitStashPush).toHaveBeenLastCalledWith("/repo", {
      message: null,
      includeUntracked: true,
    });

    // keepIndex flips on `keepIndex: true` and stays otherwise absent.
    await actions.stashChanges("keep staged", true);
    expect(native.gitStashPush).toHaveBeenLastCalledWith("/repo", {
      message: "keep staged",
      includeUntracked: true,
      keepIndex: true,
    });

    // Remote checkout propagates the upstream ref name so the backend can
    // decide between local switch and `switch --track`.
    await actions.checkoutBranch({ name: "origin/feature", isRemote: true });
    expect(native.gitCheckoutBranch).toHaveBeenLastCalledWith(
      "/repo",
      "origin/feature",
      true,
    );

    // Apply / drop / pop forward the selector alone when no sha guard is set.
    await actions.applyStash("stash@{0}");
    expect(native.gitStashApply).toHaveBeenLastCalledWith("/repo", "stash@{0}");

    // When an expected SHA is supplied, it travels to the backend so the
    // selector stability check can reject a moved stash.
    await actions.popStash("stash@{0}", "0123456789abcdef0123456789abcdef01234567");
    expect(native.gitStashPop).toHaveBeenLastCalledWith(
      "/repo",
      "stash@{0}",
      "0123456789abcdef0123456789abcdef01234567",
    );

    await actions.dropStash("stash@{1}", "ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00");
    expect(native.gitStashDrop).toHaveBeenLastCalledWith(
      "/repo",
      "stash@{1}",
      "ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00",
    );

    await actions.applyStash("stash@{2}", "abcdef");
    expect(native.gitStashApply).toHaveBeenLastCalledWith(
      "/repo",
      "stash@{2}",
      "abcdef",
    );
    expect(refreshGitMetadata).toHaveBeenCalled();
  });

  it("surfaces a stash selector-mismatch error and reports the stash apply failure title", async () => {
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
      gitCreateBranch: vi.fn().mockResolvedValue({ branch: "feature/new" }),
      gitStashPush: vi.fn().mockResolvedValue({ stashed: true, message: "Saved" }),
      gitStashPop: vi.fn().mockResolvedValue({ stashed: true, message: "Applied" }),
      gitStashDrop: vi.fn().mockResolvedValue({ stashed: true, message: "Dropped" }),
      gitStashApply: vi
        .fn()
        .mockRejectedValue("stash selector no longer matches expected commit"),
    };
    const actions = useSourceControlActions({
      state,
      native,
      dialog: { warning: vi.fn() },
      t: (key) => key,
      emitCommitted: vi.fn(),
      refreshGitMetadata: vi.fn().mockResolvedValue(undefined),
    });

    await actions.applyStash("stash@{0}", "deadbeef");

    expect(actions.actionError.value).toBe(
      "stash selector no longer matches expected commit",
    );
    expect(notifyError).toHaveBeenCalledWith(
      "sourceControl.stashApplyFailed",
      "stash selector no longer matches expected commit",
    );
    expect(state.busyAction.value).toBe(null);
  });

  it("forwards all stash save options and does not report stashed=false as success", async () => {
    const state = createState();
    const native = {
      gitStage: vi.fn(),
      gitUnstage: vi.fn(),
      gitDiscard: vi.fn(),
      gitCommit: vi.fn(),
      gitFetch: vi.fn(),
      gitPullFfOnly: vi.fn(),
      gitPush: vi.fn(),
      gitCheckoutBranch: vi.fn(),
      gitCreateBranch: vi.fn(),
      gitStashPush: vi.fn().mockResolvedValue({
        stashed: false,
        message: "No local changes to save",
      }),
      gitStashPop: vi.fn(),
      gitStashDrop: vi.fn(),
      gitStashApply: vi.fn(),
    };
    const actions = useSourceControlActions({
      state,
      native,
      dialog: { warning: vi.fn() },
      t: (key) => key,
      emitCommitted: vi.fn(),
    });

    await actions.stashChanges({
      message: "checkpoint",
      includeUntracked: false,
      keepIndex: false,
    });

    expect(native.gitStashPush).toHaveBeenCalledWith("/repo", {
      message: "checkpoint",
      includeUntracked: false,
      keepIndex: false,
    });
    expect(notifySuccess).not.toHaveBeenCalledWith(
      "sourceControl.stashSaveSuccess",
      "No local changes to save",
    );
    expect(notifyInfo).toHaveBeenCalledWith(
      "sourceControl.stashNoChanges",
      "No local changes to save",
    );
  });

  it("passes expected SHA to apply and refreshes status after an apply failure", async () => {
    const state = createState();
    const native = {
      gitStage: vi.fn(),
      gitUnstage: vi.fn(),
      gitDiscard: vi.fn(),
      gitCommit: vi.fn(),
      gitFetch: vi.fn(),
      gitPullFfOnly: vi.fn(),
      gitPush: vi.fn(),
      gitCheckoutBranch: vi.fn(),
      gitCreateBranch: vi.fn(),
      gitStashPush: vi.fn(),
      gitStashPop: vi.fn(),
      gitStashDrop: vi.fn(),
      gitStashApply: vi.fn().mockRejectedValue("apply conflict"),
    };
    const actions = useSourceControlActions({
      state,
      native,
      dialog: { warning: vi.fn() },
      t: (key) => key,
      emitCommitted: vi.fn(),
    });

    await actions.applyStash("stash@{0}", "deadbeef");

    expect(native.gitStashApply).toHaveBeenCalledWith("/repo", "stash@{0}", "deadbeef");
    expect(state.refreshStatus).toHaveBeenCalled();
  });

  it("does not report stashed=false as a successful apply", async () => {
    const state = createState();
    const native = {
      gitStage: vi.fn(),
      gitUnstage: vi.fn(),
      gitDiscard: vi.fn(),
      gitCommit: vi.fn(),
      gitFetch: vi.fn(),
      gitPullFfOnly: vi.fn(),
      gitPush: vi.fn(),
      gitCheckoutBranch: vi.fn(),
      gitCreateBranch: vi.fn(),
      gitStashPush: vi.fn(),
      gitStashPop: vi.fn(),
      gitStashDrop: vi.fn(),
      gitStashApply: vi.fn().mockResolvedValue({
        stashed: false,
        message: "Stash was not applied",
      }),
    };
    const actions = useSourceControlActions({
      state,
      native,
      dialog: { warning: vi.fn() },
      t: (key) => key,
      emitCommitted: vi.fn(),
    });

    await actions.applyStash("stash@{0}", "deadbeef");

    expect(notifySuccess).not.toHaveBeenCalledWith(
      "sourceControl.stashApplySuccess",
      "Stash was not applied",
    );
    expect(notifyInfo).toHaveBeenCalledWith(
      "sourceControl.stashNoChanges",
      "Stash was not applied",
    );
  });
});
