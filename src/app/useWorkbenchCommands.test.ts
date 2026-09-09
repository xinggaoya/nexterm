// @vitest-environment jsdom
import { computed, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { GitRepoInfo } from "@/lib/native";
import type { useTabsPiniaStore } from "@/modules/tabs/tabsPinia";
import { useWorkbenchCommands } from "./useWorkbenchCommands";
import { notifyInfo } from "@/modules/notifications/notificationCenter";

vi.mock("@/modules/terminal", () => ({
  createTerminalSessionHandle: () => ({ write: vi.fn() }),
}));

vi.mock("@/modules/notifications/notificationCenter", () => ({
  notifyError: vi.fn(),
  notifyInfo: vi.fn(),
  notifySuccess: vi.fn(),
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
  const leftPanelOpen = ref(false);
  const openBranchesModal = ref(false);
  const options = {
    t: (key: string) => key,
    keybindings: computed(() => ({})),
    hasWorkspace: computed(() => true),
    workspaceRoot: computed<string | null>(() => "/workspace"),
    activeRepoRoot: ref<string | null>(activeRepoRoot),
    activeTab: computed(() => null),
    leftPanelOpen,
    rightPanelOpen: ref(false),
    workspaceFsEvent: ref(null),
    openBranchesModal,
    tabs,
    newTerminalTab: vi.fn(),
    splitActivePane: vi.fn(),
    openFileTab: vi.fn(),
    openSettings: vi.fn(),
    requestCloseTab: vi.fn(),
    saveActiveEditor: vi.fn(),
    openGotoLine: vi.fn(),
    openFindInFiles: vi.fn(),
    openCommandPalette: vi.fn(),
    openRenameDialog: vi.fn(),
    openUrlPreview: vi.fn(),
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
    leftPanelOpen,
    openBranchesModal,
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
      refName: "main",
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
      refName: "main",
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
      refName: "main",
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

describe("useWorkbenchCommands branch workflow commands", () => {
  it("opens the branches modal for git.branch.checkout without a sourceControl.branches info notification", async () => {
    const harness = createHarness("/workspace/apps/web");
    harness.resolveGitRepo.mockResolvedValue(repo("/workspace/apps/web"));

    await harness.commands.executeCommandFromPalette("git.branch.checkout");

    expect(harness.resolveGitRepo).toHaveBeenCalledWith("/workspace/apps/web");
    expect(harness.leftPanelOpen.value).toBe(true);
    expect(harness.openBranchesModal.value).toBe(true);
    expect(notifyInfo).not.toHaveBeenCalledWith(
      "sourceControl.branches",
      expect.anything(),
    );
  });

  it("opens the branches modal for git.branch.create without a sourceControl.branches info notification", async () => {
    const harness = createHarness("/workspace/apps/web");
    harness.resolveGitRepo.mockResolvedValue(repo("/workspace/apps/web"));

    await harness.commands.executeCommandFromPalette("git.branch.create");

    expect(harness.resolveGitRepo).toHaveBeenCalledWith("/workspace/apps/web");
    expect(harness.leftPanelOpen.value).toBe(true);
    expect(harness.openBranchesModal.value).toBe(true);
    expect(notifyInfo).not.toHaveBeenCalledWith(
      "sourceControl.branches",
      expect.anything(),
    );
  });
});