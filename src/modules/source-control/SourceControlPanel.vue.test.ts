// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
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
  },
}));

async function flush() {
  await Promise.resolve();
  await nextTick();
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
    await wrapper.find("[data-open-history]").trigger("click");

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
    vi.mocked(native.gitFetch).mockResolvedValue(undefined);
    vi.mocked(native.gitPullFfOnly).mockResolvedValue(undefined);
    vi.mocked(native.gitPush).mockResolvedValue({
      remote: "origin",
      branch: "main",
      pushed: true,
    });

    const wrapper = mount(SourceControlPanel, {
      props: { rootPath: "/repo" },
    });
    await flush();

    await wrapper.find("[data-git-fetch]").trigger("click");
    await flush();
    await wrapper.find("[data-git-pull]").trigger("click");
    await flush();
    await wrapper.find("[data-git-push]").trigger("click");
    await flush();

    expect(native.gitFetch).toHaveBeenCalledWith("/repo");
    expect(native.gitPullFfOnly).toHaveBeenCalledWith("/repo");
    expect(native.gitPush).toHaveBeenCalledWith("/repo");
    expect(native.gitStatus).toHaveBeenCalledTimes(3);
    expect(wrapper.text()).toContain("Pushed to origin/main");
  });

  it("ignores non-git filesystem events for automatic status refresh", async () => {
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
    await vi.advanceTimersByTimeAsync(300);
    await flush();

    expect(native.gitStatus).not.toHaveBeenCalled();
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
    await vi.advanceTimersByTimeAsync(300);
    await flush();

    expect(native.gitStatus).toHaveBeenCalledTimes(1);
    expect(native.gitStatus).toHaveBeenCalledWith("/repo");
    vi.useRealTimers();
  });
});
