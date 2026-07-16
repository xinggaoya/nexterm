// @vitest-environment jsdom
import { computed, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { GitRepoInfo } from "@/lib/native";
import type { useTabsPiniaStore } from "@/modules/tabs/tabsPinia";
import { useWorkbenchCommands } from "./useWorkbenchCommands";

vi.mock("@/modules/terminal", () => ({
  createTerminalSessionHandle: () => ({ write: vi.fn() }),
}));

function repo(repoRoot: string): GitRepoInfo {
  return {
    repoRoot,
    branch: "main",
    upstream: null,
    isDetached: false,
  };
}

function createHarness(activeRepoRoot: string | null) {
  const openCommitHistoryTab = vi.fn();
  const tabs = {
    openCommitHistoryTab,
  } as unknown as ReturnType<typeof useTabsPiniaStore>;
  const resolveGitRepo = vi.fn<(root: string) => Promise<GitRepoInfo | null>>();
  const options = {
    t: (key: string) => key,
    keybindings: computed(() => ({})),
    hasWorkspace: computed(() => true),
    workspaceRoot: computed<string | null>(() => "/workspace"),
    activeRepoRoot: ref<string | null>(activeRepoRoot),
    activeTab: computed(() => null),
    leftPanelOpen: ref(false),
    rightPanelOpen: ref(false),
    workspaceFsEvent: ref(null),
    tabs,
    newTerminalTab: vi.fn(),
    splitActivePane: vi.fn(),
    openFileTab: vi.fn(),
    openSettings: vi.fn(),
    openTaskConsole: vi.fn(),
    requestCloseTab: vi.fn(),
    saveActiveEditor: vi.fn(),
    openGotoLine: vi.fn(),
    openFindInFiles: vi.fn(),
    openCommandPalette: vi.fn(),
    openRenameDialog: vi.fn(),
    killActiveTerminal: vi.fn(),
    resolveGitRepo,
    gitStatus: vi.fn(),
    gitStage: vi.fn(),
    gitUnstage: vi.fn(),
    gitFetch: vi.fn(),
    gitPullFfOnly: vi.fn(),
    gitPush: vi.fn(),
    gitBranchList: vi.fn(),
    gitCheckoutBranch: vi.fn(),
    gitCreateBranch: vi.fn(),
    gitStashList: vi.fn(),
    gitStashPush: vi.fn(),
    gitStashPop: vi.fn(),
  };

  return {
    commands: useWorkbenchCommands(options),
    openCommitHistoryTab,
    resolveGitRepo,
  };
}

describe("useWorkbenchCommands repository resolution", () => {
  it("uses the active repository for Git commands", async () => {
    const harness = createHarness("/workspace/apps/web");
    harness.resolveGitRepo.mockResolvedValue(repo("/workspace/apps/web"));

    await harness.commands.executeCommandFromPalette("git.history.open");

    expect(harness.resolveGitRepo).toHaveBeenCalledWith("/workspace/apps/web");
    expect(harness.openCommitHistoryTab).toHaveBeenCalledWith({
      repoRoot: "/workspace/apps/web",
      branch: "main",
    });
  });

  it("falls back to the workspace root when the active repository is invalid", async () => {
    const harness = createHarness("/workspace/removed");
    harness.resolveGitRepo
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(repo("/workspace"));

    await harness.commands.executeCommandFromPalette("git.history.open");

    expect(harness.resolveGitRepo.mock.calls).toEqual([
      ["/workspace/removed"],
      ["/workspace"],
    ]);
    expect(harness.openCommitHistoryTab).toHaveBeenCalledWith({
      repoRoot: "/workspace",
      branch: "main",
    });
  });

  it("falls back to the workspace root when active repository resolution rejects", async () => {
    const harness = createHarness("/workspace/removed");
    harness.resolveGitRepo
      .mockRejectedValueOnce(new Error("active repository unavailable"))
      .mockResolvedValueOnce(repo("/workspace"));

    await harness.commands.executeCommandFromPalette("git.history.open");

    expect(harness.resolveGitRepo.mock.calls).toEqual([
      ["/workspace/removed"],
      ["/workspace"],
    ]);
    expect(harness.openCommitHistoryTab).toHaveBeenCalledWith({
      repoRoot: "/workspace",
      branch: "main",
    });
  });

  it("rejects repository resolution when active and workspace roots both reject", async () => {
    const harness = createHarness("/workspace/removed");
    harness.resolveGitRepo
      .mockRejectedValueOnce(new Error("active repository unavailable"))
      .mockRejectedValueOnce(new Error("workspace repository unavailable"));

    await expect(harness.commands.resolveCurrentRepo()).rejects.toThrow(
      "workspace repository unavailable",
    );
    expect(harness.resolveGitRepo.mock.calls).toEqual([
      ["/workspace/removed"],
      ["/workspace"],
    ]);
  });
});
