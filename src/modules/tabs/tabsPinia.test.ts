import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabsPiniaStore } from "./tabsPinia";
import type { TerminalTab } from "./tabsTypes";
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

  it("closes a terminal tab whose paneTree was reactively updated (DataCloneError 回归)", () => {
    const tabs = useTabsPiniaStore();
    tabs.initWorkspace(WORKSPACE_ID);
    const id = tabs.newTab("/repo", WORKSPACE_ID);
    const leafId = (
      tabs.workspaceTabs(WORKSPACE_ID).find((tab) => tab.id === id) as TerminalTab
    ).activeLeafId;

    // 模拟真实使用中必然发生的更新：OSC title/cwd 事件（setLeaf*）与
    // 点击 pane 聚焦（focusPane）。focusPane 这类用 spread 拷贝 tab 的
    // 路径会把响应式 Proxy 原样存进 raw tab 的 paneTree 字段，
    // structuredClone 无法克隆 Proxy，曾在 closeTab 里抛 DataCloneError
    // 导致终端 tab 关不掉（editor tab 无嵌套对象字段所以不受影响）。
    tabs.setLeafTitle(leafId, "gwmi", WORKSPACE_ID);
    tabs.setLeafCwd(leafId, "/repo/sub", WORKSPACE_ID);
    tabs.focusPane(id, leafId, WORKSPACE_ID);

    expect(() => tabs.closeTab(id, WORKSPACE_ID)).not.toThrow();
    expect(tabs.workspaceTabs(WORKSPACE_ID).some((tab) => tab.id === id)).toBe(
      false,
    );
    // 关闭栈快照必须是纯净数据，恢复关闭要能正常工作。
    const restored = tabs.restoreClosed(WORKSPACE_ID);
    expect(restored).toMatchObject({ id: restored?.id, kind: "terminal" });
  });

  it("tears down a workspace's tabs and sessions on dispose", () => {
    const tabs = useTabsPiniaStore();
    tabs.initWorkspace(WORKSPACE_ID);
    tabs.newTab("/repo", WORKSPACE_ID);

    tabs.disposeWorkspaceTabs(WORKSPACE_ID);

    expect(sessionFns.disposeWorkspaceSessions).toHaveBeenCalledWith(WORKSPACE_ID);
    expect(tabs.workspaceTabs(WORKSPACE_ID)).toEqual([]);
  });

  // ── followPath: 重命名/搬运后让已打开的 tab 跟着走 ────────────────────
  it("follows editor / markdown / file-preview tabs through a rename", () => {
    const tabs = useTabsPiniaStore();
    tabs.initWorkspace(WORKSPACE_ID);
    const editorId = tabs.openFileTab("/repo/a.ts", WORKSPACE_ID, true)!;
    tabs.newMarkdownTab("/repo/a.ts", WORKSPACE_ID);
    tabs.newFilePreviewTab("/repo/a.png", WORKSPACE_ID);

    const changed = tabs.followPath("/repo/a.ts", "/repo/lib/a.ts", WORKSPACE_ID);
    tabs.followPath("/repo/a.png", "/repo/assets/a.png", WORKSPACE_ID);

    expect(changed).toBe(2);
    const byId = new Map(tabs.workspaceTabs(WORKSPACE_ID).map((t) => [t.id, t]));
    expect(byId.get(editorId)).toMatchObject({
      kind: "editor",
      path: "/repo/lib/a.ts",
      title: "a.ts",
    });
    expect(tabs.workspaceTabs(WORKSPACE_ID).find((t) => t.kind === "markdown")).toMatchObject({
      path: "/repo/lib/a.ts",
      title: "a.ts",
    });
    expect(tabs.workspaceTabs(WORKSPACE_ID).find((t) => t.kind === "file-preview")).toMatchObject({
      path: "/repo/assets/a.png",
      title: "a.png",
    });
  });

  it("keeps the dirty flag and preview marker while following a rename", () => {
    const tabs = useTabsPiniaStore();
    tabs.initWorkspace(WORKSPACE_ID);
    const id = tabs.openFileTab("/repo/dirty.ts", WORKSPACE_ID, true)!;
    tabs.updateTab(id, { dirty: true }, WORKSPACE_ID);

    tabs.followPath("/repo/dirty.ts", "/repo/renamed.ts", WORKSPACE_ID);

    const tab = tabs.workspaceTabs(WORKSPACE_ID).find((t) => t.id === id);
    expect(tab).toMatchObject({
      kind: "editor",
      path: "/repo/renamed.ts",
      dirty: true,
    });
  });

  it("repoints a git diff tab whose originalPath was renamed, keeping other originals", () => {
    const tabs = useTabsPiniaStore();
    tabs.initWorkspace(WORKSPACE_ID);
    tabs.openGitDiffTab(
      { repoRoot: "/repo", path: "/repo/a.ts", mode: "-", originalPath: null },
      WORKSPACE_ID,
    );
    tabs.openGitDiffTab(
      {
        repoRoot: "/repo",
        path: "/repo/b.ts",
        mode: "-",
        originalPath: "/repo/b.ts",
      },
      WORKSPACE_ID,
    );

    // 第一个 tab 的 originalPath 为 null，只有 path 命中 → 走 path 分支
    expect(tabs.followPath("/repo/a.ts", "/repo/lib/a.ts", WORKSPACE_ID)).toBe(1);
    // 第二个 tab 的 originalPath 命中 → 工作区侧新路径是 to
    expect(tabs.followPath("/repo/b.ts", "/repo/lib/b.ts", WORKSPACE_ID)).toBe(1);

    const diffs = tabs
      .workspaceTabs(WORKSPACE_ID)
      .filter((t) => t.kind === "git-diff");
    expect(diffs[0]).toMatchObject({
      path: "/repo/lib/a.ts",
      title: "a.ts",
      originalPath: null,
    });
    // originalPath 与 from 相同时随重命名失效 → 置 null
    expect(diffs[1]).toMatchObject({
      path: "/repo/lib/b.ts",
      originalPath: null,
    });
  });

  it("reports zero when no tab references the renamed path", () => {
    const tabs = useTabsPiniaStore();
    tabs.initWorkspace(WORKSPACE_ID);
    tabs.openFileTab("/repo/a.ts", WORKSPACE_ID, true);

    expect(tabs.followPath("/repo/other.ts", "/repo/x.ts", WORKSPACE_ID)).toBe(0);
    expect(tabs.workspaceTabs(WORKSPACE_ID)).toHaveLength(2);
  });

  // ── dropPath: 删除后关掉指向它的 tab ─────────────────────────────────
  it("closes tabs referencing a deleted file and re-points active id", () => {
    const tabs = useTabsPiniaStore();
    tabs.initWorkspace(WORKSPACE_ID);
    const keptId = tabs.openFileTab("/repo/keep.ts", WORKSPACE_ID, true)!;
    const goneId = tabs.openFileTab("/repo/gone.ts", WORKSPACE_ID, true)!;
    expect(tabs.activeIdByWorkspace[WORKSPACE_ID]).toBe(goneId);

    const result = tabs.dropPath("/repo/gone.ts", WORKSPACE_ID);

    expect(result).toEqual({ closed: 1, keptDirty: 0 });
    const remaining = tabs.workspaceTabs(WORKSPACE_ID);
    expect(remaining.some((t) => t.id === keptId)).toBe(true);
    expect(remaining.some((t) => t.id === goneId)).toBe(false);
    expect(tabs.activeIdByWorkspace[WORKSPACE_ID]).toBe(keptId);
  });

  it("closes every tab under a deleted directory by path prefix", () => {
    const tabs = useTabsPiniaStore();
    tabs.initWorkspace(WORKSPACE_ID);
    tabs.openFileTab("/repo/src/a.ts", WORKSPACE_ID, true);
    tabs.newFilePreviewTab("/repo/src/img/logo.png", WORKSPACE_ID);
    // 前缀相似但不同目录 —— 不能被误伤
    tabs.openFileTab("/repo/src2/b.ts", WORKSPACE_ID, true);

    const result = tabs.dropPath("/repo/src", WORKSPACE_ID);

    expect(result.closed).toBe(2);
    const paths = tabs
      .workspaceTabs(WORKSPACE_ID)
      .flatMap((t) => ("path" in t ? [t.path] : []));
    expect(paths).toContain("/repo/src2/b.ts");
    expect(paths.some((p) => p.startsWith("/repo/src/"))).toBe(false);
  });

  it("keeps unsaved editor tabs when the file is deleted", () => {
    const tabs = useTabsPiniaStore();
    tabs.initWorkspace(WORKSPACE_ID);
    const dirtyId = tabs.openFileTab("/repo/dirty.ts", WORKSPACE_ID, true)!;
    tabs.updateTab(dirtyId, { dirty: true }, WORKSPACE_ID);
    const cleanId = tabs.openFileTab("/repo/clean.ts", WORKSPACE_ID, true)!;

    const result = tabs.dropPath("/repo/dirty.ts", WORKSPACE_ID);

    expect(result).toEqual({ closed: 0, keptDirty: 1 });
    const kept = tabs.workspaceTabs(WORKSPACE_ID);
    expect(kept.some((t) => t.id === dirtyId)).toBe(true);
    expect(kept.some((t) => t.id === cleanId)).toBe(true);
  });

  it("drops without polluting the closed-tab undo stack", () => {
    const tabs = useTabsPiniaStore();
    tabs.initWorkspace(WORKSPACE_ID);
    tabs.openFileTab("/repo/a.ts", WORKSPACE_ID, true);
    tabs.newFilePreviewTab("/repo/a.png", WORKSPACE_ID);

    // 文件已经不在磁盘上，放回关闭栈只会让「恢复关闭的标签」拿到 ENOENT。
    const result = tabs.dropPath("/repo/a.ts", WORKSPACE_ID);
    expect(result.closed).toBe(1);
    expect(tabs.restoreClosed(WORKSPACE_ID)).toBeNull();

    // 未被删除的 tab 不受影响
    expect(tabs.dropPath("/repo/none.ts", WORKSPACE_ID)).toEqual({
      closed: 0,
      keptDirty: 0,
    });
    expect(
      tabs.workspaceTabs(WORKSPACE_ID).some((t) => t.kind === "file-preview"),
    ).toBe(true);
  });
});
