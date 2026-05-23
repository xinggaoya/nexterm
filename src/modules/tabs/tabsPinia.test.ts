import { readFileSync } from "node:fs";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabsPiniaStore } from "./tabsPinia";
import { disposeTerminalSession } from "./terminalDisposal";

vi.mock("./terminalDisposal", () => ({
  disposeTerminalSession: vi.fn(),
}));

describe("tabs pinia store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("initializes with one terminal tab and launch cwd", () => {
    const tabs = useTabsPiniaStore();
    tabs.init("/repo");

    expect(tabs.activeId).toBe(1);
    expect(tabs.tabs).toEqual([
      {
        id: 1,
        kind: "terminal",
        title: "shell",
        cwd: "/repo",
        paneTree: { kind: "leaf", id: 2, cwd: "/repo" },
        activeLeafId: 2,
      },
    ]);
  });

  it("keeps terminal core out of the tab store import graph", () => {
    const source = readFileSync(new URL("./tabsPinia.ts", import.meta.url), "utf8");

    expect(source).not.toContain("terminalSessionCore");
  });

  it("creates terminal tabs with stable increasing ids", () => {
    const tabs = useTabsPiniaStore();
    tabs.init();

    const id = tabs.newTab("/tmp");

    expect(id).toBe(3);
    expect(tabs.activeId).toBe(3);
    expect(tabs.tabs[1]).toMatchObject({
      id: 3,
      kind: "terminal",
      cwd: "/tmp",
      activeLeafId: 4,
    });
  });

  it("creates task terminal tabs with queued startup input", () => {
    const tabs = useTabsPiniaStore();
    tabs.init("/repo");

    const id = tabs.newTaskTerminal({
      cwd: "/repo",
      command: "pnpm run dev",
    });

    expect(id).toBe(3);
    expect(tabs.activeId).toBe(3);
    expect(tabs.tabs[1]).toMatchObject({
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

  it("reorders tabs without changing the active tab identity", () => {
    const tabs = useTabsPiniaStore();
    tabs.init();
    const secondId = tabs.newTab("/tmp");
    const editorId = tabs.openFileTab("/repo/src/main.ts");

    tabs.setActiveId(secondId);
    tabs.moveTab(editorId!, 1, "before");

    expect(tabs.tabs.map((tab) => tab.id)).toEqual([editorId, 1, secondId]);
    expect(tabs.activeId).toBe(secondId);

    tabs.moveTab(editorId!, secondId, "after");

    expect(tabs.tabs.map((tab) => tab.id)).toEqual([1, secondId, editorId]);
    expect(tabs.activeId).toBe(secondId);
  });

  it("ignores invalid tab reorder requests", () => {
    const tabs = useTabsPiniaStore();
    tabs.init();
    const secondId = tabs.newTab("/tmp");
    const original = tabs.tabs;

    tabs.moveTab(1, 1, "before");
    tabs.moveTab(999, secondId, "before");
    tabs.moveTab(1, 999, "after");

    expect(tabs.tabs).toBe(original);
    expect(tabs.tabs.map((tab) => tab.id)).toEqual([1, secondId]);
  });

  it("opens editor preview tabs in a reusable slot and pins them", () => {
    const tabs = useTabsPiniaStore();
    tabs.init();

    const first = tabs.openFileTab("/repo/src/a.ts", false);
    const second = tabs.openFileTab("/repo/src/b.ts", false);

    expect(first).toBe(3);
    expect(second).toBe(4);
    expect(tabs.tabs).toHaveLength(2);
    expect(tabs.tabs[1]).toMatchObject({
      id: 4,
      kind: "editor",
      title: "b.ts",
      path: "/repo/src/b.ts",
      preview: true,
      dirty: false,
    });

    tabs.pinTab(4);
    const third = tabs.openFileTab("/repo/src/c.ts", false);

    expect(third).toBe(5);
    expect(tabs.tabs.map((tab) => tab.id)).toEqual([1, 4, 5]);
    expect(tabs.tabs[1]).toMatchObject({ id: 4, preview: false });
    expect(tabs.tabs[2]).toMatchObject({ id: 5, path: "/repo/src/c.ts", preview: true });
  });

  it("reuses existing persistent editor tabs and auto-pins dirty previews", () => {
    const tabs = useTabsPiniaStore();
    tabs.init();

    const id = tabs.openFileTab("/repo/src/a.ts");
    const same = tabs.openFileTab("/repo/src/a.ts");

    expect(id).toBe(3);
    expect(same).toBe(3);
    expect(tabs.tabs).toHaveLength(2);

    const previewId = tabs.openFileTab("/repo/src/b.ts", false);
    tabs.updateTab(previewId!, { dirty: true });

    expect(tabs.tabs.find((tab) => tab.id === previewId)).toMatchObject({
      kind: "editor",
      preview: false,
      dirty: true,
    });
  });

  it("opens preview, markdown, and git history tabs with deduplication where expected", () => {
    const tabs = useTabsPiniaStore();
    tabs.init();

    const previewId = tabs.newPreviewTab("https://example.com/path");
    const markdownId = tabs.newMarkdownTab("/repo/readme.md");
    const sameMarkdownId = tabs.newMarkdownTab("/repo/readme.md");
    const historyId = tabs.openCommitHistoryTab({ repoRoot: "/repo", branch: "main" });
    const sameHistoryId = tabs.openCommitHistoryTab({ repoRoot: "/repo", branch: "dev" });

    expect(previewId).toBe(3);
    expect(tabs.tabs.find((tab) => tab.id === previewId)).toMatchObject({
      kind: "preview",
      title: "example.com",
      url: "https://example.com/path",
    });
    expect(markdownId).toBe(4);
    expect(sameMarkdownId).toBe(4);
    expect(historyId).toBe(5);
    expect(sameHistoryId).toBe(5);
    expect(tabs.tabs.find((tab) => tab.id === historyId)).toMatchObject({
      kind: "git-history",
      title: "History · dev",
      repoRoot: "/repo",
    });
  });

  it("opens commit file diff tabs with deduplication", () => {
    const tabs = useTabsPiniaStore();
    tabs.init();

    const id = tabs.openCommitFileDiffTab({
      repoRoot: "/repo",
      sha: "abcdef123456",
      shortSha: "abcdef1",
      subject: "Change main",
      path: "src/main.ts",
      originalPath: null,
    });
    const same = tabs.openCommitFileDiffTab({
      repoRoot: "/repo",
      sha: "abcdef123456",
      shortSha: "abcdef1",
      subject: "Change main again",
      path: "src/main.ts",
      originalPath: "src/old-main.ts",
    });

    expect(id).toBe(3);
    expect(same).toBe(3);
    expect(tabs.activeId).toBe(3);
    expect(tabs.tabs[1]).toMatchObject({
      id: 3,
      kind: "git-commit-file",
      title: "main.ts @ abcdef1",
      repoRoot: "/repo",
      sha: "abcdef123456",
      shortSha: "abcdef1",
      subject: "Change main again",
      path: "src/main.ts",
      originalPath: "src/old-main.ts",
    });
  });

  it("opens working tree git diff tabs with deduplication", () => {
    const tabs = useTabsPiniaStore();
    tabs.init();

    const id = tabs.openGitDiffTab({
      repoRoot: "/repo",
      path: "src/main.ts",
      mode: "-",
      originalPath: null,
      title: "main.ts",
    });
    const same = tabs.openGitDiffTab({
      repoRoot: "/repo",
      path: "src/main.ts",
      mode: "-",
      originalPath: null,
      title: "main.ts updated",
    });

    expect(id).toBe(3);
    expect(same).toBe(3);
    expect(tabs.activeId).toBe(3);
    expect(tabs.tabs[1]).toMatchObject({
      id: 3,
      kind: "git-diff",
      title: "main.ts updated",
      repoRoot: "/repo",
      path: "src/main.ts",
      mode: "-",
      originalPath: null,
    });
  });

  it("closes terminal tabs and activates the previous tab", () => {
    const tabs = useTabsPiniaStore();
    tabs.init();
    const id = tabs.newTab("/tmp");

    tabs.closeTab(id);

    expect(tabs.tabs.map((tab) => tab.id)).toEqual([1]);
    expect(tabs.activeId).toBe(1);
    expect(disposeTerminalSession).toHaveBeenCalledWith(4);
  });

  it("resets the workspace to one terminal tab and disposes old terminal leaves", () => {
    const tabs = useTabsPiniaStore();
    tabs.init("/repo");
    const secondTabId = tabs.newTab("/tmp");
    tabs.splitActivePane(secondTabId, "col");
    tabs.openFileTab("/repo/src/main.ts");

    tabs.resetWorkspace("/home/dev");

    expect(tabs.tabs).toEqual([
      {
        id: 8,
        kind: "terminal",
        title: "shell",
        cwd: "/home/dev",
        paneTree: { kind: "leaf", id: 9, cwd: "/home/dev" },
        activeLeafId: 9,
      },
    ]);
    expect(tabs.activeId).toBe(8);
    expect(disposeTerminalSession).toHaveBeenCalledWith(2);
    expect(disposeTerminalSession).toHaveBeenCalledWith(4);
    expect(disposeTerminalSession).toHaveBeenCalledWith(6);
  });

  it("keeps the final tab open when close is requested", () => {
    const tabs = useTabsPiniaStore();
    tabs.init();

    tabs.closeTab(1);

    expect(tabs.tabs.map((tab) => tab.id)).toEqual([1]);
    expect(tabs.activeId).toBe(1);
    expect(disposeTerminalSession).not.toHaveBeenCalled();
  });

  it("splits and closes terminal panes inside the active tab", () => {
    const tabs = useTabsPiniaStore();
    tabs.init("/repo");

    const leafId = tabs.splitActivePane(1, "row");

    expect(leafId).toBe(4);
    expect(tabs.tabs[0]).toMatchObject({
      activeLeafId: 4,
      paneTree: {
        kind: "split",
        id: 3,
        dir: "row",
        children: [
          { kind: "leaf", id: 2, cwd: "/repo" },
          { kind: "leaf", id: 4, cwd: "/repo" },
        ],
      },
    });

    const closedTab = tabs.closeActivePane(1);

    expect(closedTab).toBe(false);
    expect(tabs.tabs[0]).toMatchObject({
      activeLeafId: 2,
      paneTree: { kind: "leaf", id: 2, cwd: "/repo" },
    });
    expect(disposeTerminalSession).toHaveBeenCalledWith(4);
  });

  it("updates active leaf and cwd inside a terminal pane tree", () => {
    const tabs = useTabsPiniaStore();
    tabs.init();

    tabs.focusPane(1, 2);
    tabs.setLeafCwd(2, "/next");

    expect(tabs.tabs[0]).toMatchObject({
      activeLeafId: 2,
      cwd: "/next",
      paneTree: { kind: "leaf", id: 2, cwd: "/next" },
    });
  });

  it("tracks terminal titles per leaf and syncs the active leaf title", () => {
    const tabs = useTabsPiniaStore();
    tabs.init("/repo");
    tabs.splitActivePane(1, "row");

    tabs.setLeafTitle(2, "left cli");

    expect(tabs.tabs[0]).toMatchObject({
      activeLeafId: 4,
      terminalTitle: undefined,
      paneTree: {
        kind: "split",
        children: [
          { kind: "leaf", id: 2, terminalTitle: "left cli" },
          { kind: "leaf", id: 4 },
        ],
      },
    });

    tabs.setLeafTitle(4, "right cli");

    expect(tabs.tabs[0]).toMatchObject({
      activeLeafId: 4,
      terminalTitle: "right cli",
      paneTree: {
        kind: "split",
        children: [
          { kind: "leaf", id: 2, terminalTitle: "left cli" },
          { kind: "leaf", id: 4, terminalTitle: "right cli" },
        ],
      },
    });

    tabs.focusPane(1, 2);

    expect(tabs.tabs[0]).toMatchObject({
      activeLeafId: 2,
      terminalTitle: "left cli",
    });
  });
});
