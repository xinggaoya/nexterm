import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabsPiniaStore } from "./tabsPinia";
import { useWorkspacesPiniaStore } from "@/modules/workspace/workspacesPinia";

// The tabs store delegates to the workspaces store for the active workspace
// id. Tests mock authorizeWorkspace so addWorkspace resolves synchronously.
vi.mock("@/modules/workspace/workspaceNative", () => ({
  getWslHome: vi.fn(),
  authorizeWorkspace: vi.fn(async (path: string) => path),
}));

// Spy on the workspace-aware session registry without breaking the real module.
const sessionFns = vi.hoisted(() => ({
  disposeSession: vi.fn(),
  disposeWorkspaceSessions: vi.fn(),
}));
vi.mock("@/modules/terminal/lib/sessions", () => ({
  disposeSession: (...args: unknown[]) => sessionFns.disposeSession(...args),
  disposeWorkspaceSessions: (...args: unknown[]) =>
    sessionFns.disposeWorkspaceSessions(...args),
  getSessionForLeaf: vi.fn(() => undefined),
  trackSession: vi.fn(),
  createSession: vi.fn(),
  disposeAllSessions: vi.fn(),
}));

const WORKSPACE_ID = "local:/repo";

describe("tabs pinia store (workspace-scoped)", () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    sessionFns.disposeSession.mockClear();
    sessionFns.disposeWorkspaceSessions.mockClear();
    const workspaces = useWorkspacesPiniaStore();
    await workspaces.addWorkspace("/repo", { kind: "local" });
  });

  it("initializes a workspace with one terminal tab and its cwd", () => {
    const tabs = useTabsPiniaStore();
    tabs.initWorkspace(WORKSPACE_ID, "/repo");

    expect(tabs.activeId).toBe(1);
    expect(tabs.workspaceTabs(WORKSPACE_ID)).toEqual([
      {
        id: 1,
        workspaceId: WORKSPACE_ID,
        kind: "terminal",
        title: "shell",
        cwd: "/repo",
        paneTree: { kind: "leaf", id: 2, cwd: "/repo" },
        activeLeafId: 2,
      },
    ]);
  });

  it("creates terminal tabs with stable increasing ids for the workspace", () => {
    const tabs = useTabsPiniaStore();
    tabs.initWorkspace(WORKSPACE_ID);

    const id = tabs.newTab("/tmp", WORKSPACE_ID);

    expect(id).toBe(3);
    expect(tabs.activeId).toBe(3);
    expect(tabs.workspaceTabs(WORKSPACE_ID)[1]).toMatchObject({
      id: 3,
      kind: "terminal",
      cwd: "/tmp",
      activeLeafId: 4,
    });
  });

  it("coalesces file preview tabs by path", () => {
    const tabs = useTabsPiniaStore();
    tabs.initWorkspace(WORKSPACE_ID);

    const first = tabs.newFilePreviewTab("/repo/assets/logo.png", WORKSPACE_ID);
    const second = tabs.newFilePreviewTab("/repo/assets/logo.png", WORKSPACE_ID);
    const other = tabs.newFilePreviewTab("/repo/assets/icon.svg", WORKSPACE_ID);

    expect(first).toBe(second);
    expect(other).not.toBe(first);
    const previewTabs = tabs
      .workspaceTabs(WORKSPACE_ID)
      .filter((tab) => tab.kind === "file-preview");
    expect(previewTabs).toHaveLength(2);
    expect(previewTabs[0]).toMatchObject({
      kind: "file-preview",
      title: "logo.png",
      path: "/repo/assets/logo.png",
    });
  });

  it("creates task terminal tabs with queued startup input", () => {
    const tabs = useTabsPiniaStore();
    tabs.initWorkspace(WORKSPACE_ID, "/repo");

    const id = tabs.newTaskTerminal(
      { cwd: "/repo", command: "pnpm run dev" },
      WORKSPACE_ID,
    );

    expect(id).toBe(3);
    expect(tabs.activeId).toBe(3);
    expect(tabs.workspaceTabs(WORKSPACE_ID)[1]).toMatchObject({
      id: 3,
      kind: "terminal",
      title: "task: pnpm run dev",
      cwd: "/repo",
      activeLeafId: 4,
      paneTree: {
        kind: "leaf",
        id: 4,
        cwd: "/repo",
        startupInput: "pnpm run dev\r",
      },
    });
  });

  it("isolates tabs between workspaces", async () => {
    const workspaces = useWorkspacesPiniaStore();
    const otherResult = await workspaces.addWorkspace("/other", { kind: "local" });
    const otherId = otherResult.instance.id;
    const tabs = useTabsPiniaStore();
    tabs.initWorkspace(WORKSPACE_ID);
    tabs.initWorkspace(otherId);

    const repoTabCount = tabs.workspaceTabs(WORKSPACE_ID).length;
    tabs.newTab("/repo/sub", WORKSPACE_ID);
    tabs.newTab("/other/sub", otherId);

    // Adding a tab to /repo only grows /repo's list, not /other's.
    expect(tabs.workspaceTabs(WORKSPACE_ID)).toHaveLength(repoTabCount + 1);
    expect(tabs.workspaceTabs(otherId).length).toBeGreaterThanOrEqual(1);
    // Active workspace is the most recently added one.
    expect(tabs.activeWorkspaceId).toBe(otherId);
  });

  it("disposes terminal sessions when closing a tab", () => {
    const tabs = useTabsPiniaStore();
    tabs.initWorkspace(WORKSPACE_ID);
    tabs.newTab("/repo", WORKSPACE_ID);
    tabs.newTab("/repo", WORKSPACE_ID);

    tabs.closeTab(1, WORKSPACE_ID);

    expect(sessionFns.disposeSession).toHaveBeenCalled();
  });

  it("tears down a workspace's tabs and sessions on dispose", () => {
    const tabs = useTabsPiniaStore();
    tabs.initWorkspace(WORKSPACE_ID);
    tabs.newTab("/repo", WORKSPACE_ID);

    tabs.disposeWorkspaceTabs(WORKSPACE_ID);

    expect(sessionFns.disposeWorkspaceSessions).toHaveBeenCalledWith(WORKSPACE_ID);
    expect(tabs.workspaceTabs(WORKSPACE_ID)).toEqual([]);
  });
});
