// @vitest-environment jsdom
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SourceControlPanel from "./SourceControlPanel.vue";
import { native, type GitChangedFile } from "@/lib/native";

const dialogConfirmMock = vi.hoisted(() => vi.fn());

vi.mock("naive-ui", async () => {
  const actual = await vi.importActual<typeof import("naive-ui")>("naive-ui");
  return {
    ...actual,
    useDialog: () => ({
      warning: dialogConfirmMock,
    }),
  };
});

vi.mock("@/lib/native", () => ({
  native: {
    workspaceAuthorize: vi.fn(),
    gitPanelSnapshot: vi.fn(),
    gitStatus: vi.fn(),
    gitStage: vi.fn(),
    gitUnstage: vi.fn(),
    gitDiscard: vi.fn(),
    gitCommit: vi.fn(),
    gitFetch: vi.fn(),
    gitPullFfOnly: vi.fn(),
    gitPush: vi.fn(),
    gitBranchList: vi.fn(),
    gitCheckoutBranch: vi.fn(),
    gitCreateBranch: vi.fn(),
    gitStashList: vi.fn(),
    gitStashPush: vi.fn(),
    gitStashPop: vi.fn(),
    gitStashDrop: vi.fn(),
  },
}));

async function flush() {
  for (let i = 0; i < 3; i += 1) {
    await Promise.resolve();
    await nextTick();
  }
}

async function selectGitAction(wrapper: VueWrapper, key: string) {
  const dropdown = wrapper
    .findAllComponents({ name: "Dropdown" })
    .find((item) => item.props("options")?.some?.((option: { key?: string }) => option.key === key));
  if (!dropdown) throw new Error(`Git action dropdown not found for ${key}`);
  dropdown.vm.$emit("select", key);
  await flush();
}

function file(overrides: Partial<GitChangedFile> & Pick<GitChangedFile, "path">): GitChangedFile {
  return {
    originalPath: null,
    indexStatus: " ",
    worktreeStatus: " ",
    staged: false,
    unstaged: false,
    untracked: false,
    statusLabel: "Modified",
    ...overrides,
  };
}

function mockSnapshotFiles(changedFiles: GitChangedFile[]) {
  vi.mocked(native.gitPanelSnapshot).mockResolvedValue({
    repo: {
      repoRoot: "/repo",
      branch: "main",
      upstream: "origin/main",
      isDetached: false,
    },
    status: {
      repoRoot: "/repo",
      branch: "main",
      upstream: "origin/main",
      ahead: 1,
      behind: 0,
      isDetached: false,
      truncated: false,
      changedFiles,
    },
  });
}

describe("SourceControlPanel.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dialogConfirmMock.mockReset();
    vi.mocked(native.workspaceAuthorize).mockResolvedValue("/repo");
    mockSnapshotFiles([
      file({
        path: "src/main.ts",
        worktreeStatus: "M",
        unstaged: true,
      }),
    ]);
    vi.mocked(native.gitStatus).mockResolvedValue({
      repoRoot: "/repo",
      branch: "main",
      upstream: "origin/main",
      ahead: 1,
      behind: 0,
      isDetached: false,
      truncated: false,
      changedFiles: [],
    });
    vi.mocked(native.gitBranchList).mockResolvedValue([
      {
        name: "main",
        upstream: "origin/main",
        isCurrent: true,
        isRemote: false,
      },
      {
        name: "feature/git-ui",
        upstream: null,
        isCurrent: false,
        isRemote: false,
      },
      {
        name: "origin/release",
        upstream: null,
        isCurrent: false,
        isRemote: true,
      },
    ]);
    vi.mocked(native.gitStashList).mockResolvedValue([
      {
        selector: "stash@{0}",
        shortSha: "abcdef1",
        relativeTime: "2 hours ago",
        message: "WIP on main: source control",
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads repository status and opens diffs/history", async () => {
    const wrapper = mount(SourceControlPanel, {
      props: { rootPath: "/repo" },
    });
    await flush();

    expect(native.workspaceAuthorize).toHaveBeenCalledWith("/repo");
    expect(native.gitPanelSnapshot).toHaveBeenCalledWith("/repo");
    expect(wrapper.text()).toContain("main");
    expect(wrapper.text()).toContain("src/main.ts");

    await wrapper.find("[data-source-file='src/main.ts']").trigger("click");
    await selectGitAction(wrapper, "history");

    expect(wrapper.emitted("openDiff")).toEqual([
      [
        {
          repoRoot: "/repo",
          path: "src/main.ts",
          mode: "-",
          originalPath: null,
          title: "src/main.ts",
        },
      ],
    ]);
    expect(wrapper.emitted("openHistory")).toEqual([
      [{ repoRoot: "/repo", branch: "main" }],
    ]);
  });

  it("stages files and commits staged changes", async () => {
    vi.mocked(native.gitStage).mockResolvedValue(undefined);
    vi.mocked(native.gitCommit).mockResolvedValue({
      commitSha: "abcdef",
      summary: "fix: update main",
    });
    vi.mocked(native.gitStatus).mockResolvedValueOnce({
      repoRoot: "/repo",
      branch: "main",
      upstream: "origin/main",
      ahead: 1,
      behind: 0,
      isDetached: false,
      truncated: false,
      changedFiles: [
        {
          path: "src/main.ts",
          originalPath: null,
          indexStatus: "M",
          worktreeStatus: " ",
          staged: true,
          unstaged: false,
          untracked: false,
          statusLabel: "Modified",
        },
      ],
    });

    const wrapper = mount(SourceControlPanel, {
      props: { rootPath: "/repo" },
    });
    await flush();

    await wrapper.find("[data-stage-file='src/main.ts']").trigger("click");
    await flush();

    expect(native.gitStage).toHaveBeenCalledWith("/repo", ["src/main.ts"]);
    expect(wrapper.text()).toContain("Staged");

    await wrapper.find("[data-commit-message]").setValue("fix: update main");
    await wrapper.find("[data-commit]").trigger("click");
    await flush();

    expect(native.gitCommit).toHaveBeenCalledWith("/repo", "fix: update main");
    expect(wrapper.emitted("committed")).toEqual([
      [{ commitSha: "abcdef", summary: "fix: update main" }],
    ]);
  });

  it("stages and unstages all eligible files", async () => {
    vi.mocked(native.gitStage).mockResolvedValue(undefined);
    vi.mocked(native.gitUnstage).mockResolvedValue(undefined);
    mockSnapshotFiles([
      file({
        path: "src/staged.ts",
        indexStatus: "M",
        staged: true,
      }),
      file({
        path: "src/unstaged.ts",
        worktreeStatus: "M",
        unstaged: true,
      }),
      file({
        path: "src/new.ts",
        worktreeStatus: "?",
        unstaged: true,
        untracked: true,
        statusLabel: "Untracked",
      }),
      file({
        path: "src/mixed.ts",
        indexStatus: "M",
        worktreeStatus: "M",
        staged: true,
        unstaged: true,
      }),
    ]);

    const wrapper = mount(SourceControlPanel, {
      props: { rootPath: "/repo" },
    });
    await flush();

    await wrapper.find("[data-stage-all]").trigger("click");
    await flush();

    expect(native.gitStage).toHaveBeenCalledWith("/repo", [
      "src/unstaged.ts",
      "src/new.ts",
      "src/mixed.ts",
    ]);

    mockSnapshotFiles([
      file({
        path: "src/staged.ts",
        indexStatus: "M",
        staged: true,
      }),
      file({
        path: "src/mixed.ts",
        indexStatus: "M",
        worktreeStatus: "M",
        staged: true,
        unstaged: true,
      }),
    ]);

    const second = mount(SourceControlPanel, {
      props: { rootPath: "/repo" },
    });
    await flush();

    await second.find("[data-unstage-all]").trigger("click");
    await flush();

    expect(native.gitUnstage).toHaveBeenCalledWith("/repo", [
      "src/staged.ts",
      "src/mixed.ts",
    ]);
  });

  it("groups changes and supports selected bulk actions", async () => {
    vi.mocked(native.gitStage).mockResolvedValue(undefined);
    vi.mocked(native.gitUnstage).mockResolvedValue(undefined);
    vi.mocked(native.gitDiscard).mockResolvedValue(undefined);
    const changedFiles = [
      file({
        path: "src/staged.ts",
        indexStatus: "M",
        staged: true,
      }),
      file({
        path: "src/unstaged.ts",
        worktreeStatus: "M",
        unstaged: true,
      }),
      file({
        path: "src/new.ts",
        worktreeStatus: "?",
        unstaged: true,
        untracked: true,
        statusLabel: "Untracked",
      }),
      file({
        path: "src/deleted.ts",
        worktreeStatus: "D",
        unstaged: true,
        statusLabel: "Deleted",
      }),
    ];
    mockSnapshotFiles(changedFiles);
    vi.mocked(native.gitStatus).mockResolvedValue({
      repoRoot: "/repo",
      branch: "main",
      upstream: "origin/main",
      ahead: 1,
      behind: 0,
      isDetached: false,
      truncated: false,
      changedFiles,
    });
    dialogConfirmMock.mockImplementation((options) => {
      void options.onPositiveClick();
    });

    const wrapper = mount(SourceControlPanel, {
      props: { rootPath: "/repo" },
    });
    await flush();

    expect(wrapper.find("[data-source-group='modified']").exists()).toBe(true);
    expect(wrapper.find("[data-source-group='added']").exists()).toBe(true);
    expect(wrapper.find("[data-source-group='deleted']").exists()).toBe(true);

    await wrapper
      .find("[data-source-select='src/unstaged.ts']")
      .trigger("click");
    await wrapper.find("[data-stage-all]").trigger("click");
    await flush();

    expect(native.gitStage).toHaveBeenCalledWith("/repo", ["src/unstaged.ts"]);

    await wrapper.find("[data-clear-selection]").trigger("click");
    await wrapper
      .find("[data-source-select='src/staged.ts']")
      .trigger("click");
    await wrapper.find("[data-unstage-all]").trigger("click");
    await flush();

    expect(native.gitUnstage).toHaveBeenCalledWith("/repo", ["src/staged.ts"]);

    await wrapper.find("[data-clear-selection]").trigger("click");
    await wrapper
      .find("[data-source-select='src/new.ts']")
      .trigger("click");
    await wrapper.find("[data-discard-all]").trigger("click");
    await flush();

    expect(native.gitDiscard).toHaveBeenCalledWith("/repo", [
      { path: "src/new.ts", untracked: true },
    ]);
  });

  it("confirms before discarding single files and all unstaged changes", async () => {
    vi.mocked(native.gitDiscard).mockResolvedValue(undefined);
    const discardFiles = [
      file({
        path: "src/unstaged.ts",
        worktreeStatus: "M",
        unstaged: true,
      }),
      file({
        path: "src/new.ts",
        worktreeStatus: "?",
        unstaged: true,
        untracked: true,
        statusLabel: "Untracked",
      }),
      file({
        path: "src/staged.ts",
        indexStatus: "M",
        staged: true,
      }),
    ];
    mockSnapshotFiles(discardFiles);
    vi.mocked(native.gitStatus).mockResolvedValue({
      repoRoot: "/repo",
      branch: "main",
      upstream: "origin/main",
      ahead: 1,
      behind: 0,
      isDetached: false,
      truncated: false,
      changedFiles: discardFiles,
    });
    dialogConfirmMock.mockImplementation((options) => {
      void options.onPositiveClick();
    });

    const wrapper = mount(SourceControlPanel, {
      props: { rootPath: "/repo" },
    });
    await flush();

    await wrapper.find("[data-discard-file='src/unstaged.ts']").trigger("click");
    await flush();

    expect(dialogConfirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Discard changes?",
        positiveText: "Discard",
      }),
    );
    expect(native.gitDiscard).toHaveBeenCalledWith("/repo", [
      { path: "src/unstaged.ts", untracked: false },
    ]);

    await wrapper.find("[data-discard-all]").trigger("click");
    await flush();

    expect(native.gitDiscard).toHaveBeenLastCalledWith("/repo", [
      { path: "src/unstaged.ts", untracked: false },
      { path: "src/new.ts", untracked: true },
    ]);
  });

  it("runs fetch pull and push operations then refreshes status", async () => {
    vi.mocked(native.gitFetch).mockResolvedValue({
      updatedRefs: 1,
      prunedRefs: 0,
      summary: "1 ref updated",
    });
    vi.mocked(native.gitPullFfOnly).mockResolvedValue({
      filesChanged: 3,
      insertions: 24,
      deletions: 6,
      alreadyUpToDate: false,
      summary: "3 files changed, +24 -6",
    });
    vi.mocked(native.gitPush).mockResolvedValue({
      remote: "origin",
      branch: "main",
      pushed: true,
    });

    const wrapper = mount(SourceControlPanel, {
      props: { rootPath: "/repo" },
    });
    await flush();

    await selectGitAction(wrapper, "fetch");
    await selectGitAction(wrapper, "pull");
    await selectGitAction(wrapper, "push");

    expect(native.gitFetch).toHaveBeenCalledWith("/repo");
    expect(native.gitPullFfOnly).toHaveBeenCalledWith("/repo");
    expect(native.gitPush).toHaveBeenCalledWith("/repo");
    expect(native.gitStatus).toHaveBeenCalledTimes(3);
  });

  it("renders branch and stash workflows and runs selected actions", async () => {
    vi.mocked(native.gitCheckoutBranch).mockResolvedValue({ branch: "feature/git-ui" });
    vi.mocked(native.gitCreateBranch).mockResolvedValue({ branch: "feature/new" });
    vi.mocked(native.gitStashPush).mockResolvedValue({
      stashed: true,
      message: "Saved working directory",
    });
    vi.mocked(native.gitStashPop).mockResolvedValue({
      stashed: true,
      message: "Applied stash@{0}",
    });
    vi.mocked(native.gitStashDrop).mockResolvedValue({
      stashed: true,
      message: "Dropped stash@{0}",
    });

    const wrapper = mount(SourceControlPanel, {
      props: { rootPath: "/repo" },
    });
    await flush();

    expect(native.gitBranchList).toHaveBeenCalledWith("/repo");
    expect(native.gitStashList).toHaveBeenCalledWith("/repo");
    expect(wrapper.text()).toContain("feature/git-ui");
    expect(wrapper.text()).toContain("WIP on main: source control");

    await wrapper.find("[data-git-stash-save]").trigger("click");
    await flush();
    expect(native.gitStashPush).toHaveBeenCalledWith("/repo", {
      message: null,
      includeUntracked: true,
    });

    await wrapper.find("[data-git-branch='feature/git-ui']").trigger("click");
    await flush();
    expect(native.gitCheckoutBranch).toHaveBeenCalledWith(
      "/repo",
      "feature/git-ui",
      false,
    );

    await wrapper.find("[data-git-create-branch-toggle]").trigger("click");
    await flush();
    const input = wrapper.find("[data-git-create-branch-input]");
    await input.setValue("feature/new");
    await wrapper.find("[data-git-create-branch-submit]").trigger("click");
    await flush();
    expect(native.gitCreateBranch).toHaveBeenCalledWith("/repo", "feature/new");

    await wrapper.find("[data-git-stash-pop='stash@{0}']").trigger("click");
    await flush();
    expect(native.gitStashPop).toHaveBeenCalledWith("/repo", "stash@{0}");

    await wrapper.find("[data-git-stash-drop='stash@{0}']").trigger("click");
    await flush();
    expect(native.gitStashDrop).toHaveBeenCalledWith("/repo", "stash@{0}");
  });

  it("refreshes status for workspace file events", async () => {
    vi.useFakeTimers();
    const wrapper = mount(SourceControlPanel, {
      props: { rootPath: "/repo", fsEvent: null },
    });
    await flush();
    vi.mocked(native.gitStatus).mockClear();

    await wrapper.setProps({
      fsEvent: {
        rootPath: "/repo",
        paths: ["/repo/src/new.ts"],
        gitRelated: false,
      },
    });
    await vi.advanceTimersByTimeAsync(650);
    await flush();

    expect(native.gitStatus).toHaveBeenCalledTimes(1);
    expect(native.gitStatus).toHaveBeenCalledWith("/repo");
    vi.useRealTimers();
  });

  it("refreshes status for git-related filesystem events", async () => {
    vi.useFakeTimers();
    const wrapper = mount(SourceControlPanel, {
      props: { rootPath: "/repo", fsEvent: null },
    });
    await flush();
    vi.mocked(native.gitStatus).mockClear();

    await wrapper.setProps({
      fsEvent: {
        rootPath: "/repo",
        paths: ["/repo/.git/index"],
        gitRelated: true,
      },
    });
    await vi.advanceTimersByTimeAsync(650);
    await flush();

    expect(native.gitStatus).toHaveBeenCalledTimes(1);
    expect(native.gitStatus).toHaveBeenCalledWith("/repo");
    vi.useRealTimers();
  });

  it("runs a pending auto refresh after a busy source control action finishes", async () => {
    vi.useFakeTimers();
    const deferredStage: { resolve?: () => void } = {};
    vi.mocked(native.gitStage).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          deferredStage.resolve = resolve;
        }),
    );

    const wrapper = mount(SourceControlPanel, {
      props: { rootPath: "/repo", fsEvent: null },
    });
    await flush();
    vi.mocked(native.gitStatus).mockClear();

    await wrapper.find("[data-stage-file='src/main.ts']").trigger("click");
    await wrapper.setProps({
      fsEvent: {
        rootPath: "/repo",
        paths: ["/repo/src/main.ts"],
        gitRelated: false,
      },
    });
    await vi.advanceTimersByTimeAsync(650);
    await flush();

    expect(native.gitStatus).not.toHaveBeenCalled();

    if (!deferredStage.resolve) throw new Error("stage action did not start");
    deferredStage.resolve();
    await flush();
    expect(native.gitStatus).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(650);
    await flush();

    expect(native.gitStatus).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("shows a hint when git status results are truncated", async () => {
    mockSnapshotFiles([
      file({
        path: "src/main.ts",
        worktreeStatus: "M",
        unstaged: true,
      }),
    ]);
    vi.mocked(native.gitPanelSnapshot).mockResolvedValueOnce({
      repo: {
        repoRoot: "/repo",
        branch: "main",
        upstream: "origin/main",
        isDetached: false,
      },
      status: {
        repoRoot: "/repo",
        branch: "main",
        upstream: "origin/main",
        ahead: 0,
        behind: 0,
        isDetached: false,
        truncated: true,
        changedFiles: [
          file({
            path: "src/main.ts",
            worktreeStatus: "M",
            unstaged: true,
          }),
        ],
      },
    });

    const wrapper = mount(SourceControlPanel, {
      props: { rootPath: "/repo" },
    });
    await flush();

    expect(wrapper.text()).toContain("Status results were truncated");
  });
});
