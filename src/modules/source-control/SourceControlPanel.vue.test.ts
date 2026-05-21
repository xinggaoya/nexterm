// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SourceControlPanel from "./SourceControlPanel.vue";
import { native } from "@/modules/ai/lib/native";

vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    gitPanelSnapshot: vi.fn(),
    gitStatus: vi.fn(),
    gitStage: vi.fn(),
    gitUnstage: vi.fn(),
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

describe("SourceControlPanel.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        changedFiles: [
          {
            path: "src/main.ts",
            originalPath: null,
            indexStatus: " ",
            worktreeStatus: "M",
            staged: false,
            unstaged: true,
            untracked: false,
            statusLabel: "Modified",
          },
        ],
      },
    });
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

  it("loads repository status and opens diffs/history", async () => {
    const wrapper = mount(SourceControlPanel, {
      props: { rootPath: "/repo" },
    });
    await flush();

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
});
