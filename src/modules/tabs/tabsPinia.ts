import { defineStore } from "pinia";
import {
  findLeafCwd,
  hasLeaf,
  leafIds,
  removeLeaf,
  setLeafCwd as setLeafCwdInTree,
  siblingLeafOf,
  splitLeaf,
  type SplitDir,
} from "@/modules/terminal/lib/panes";
import { disposeTerminalSession } from "./terminalDisposal";
import {
  MAX_PANES_PER_TAB,
  type AiDiffStatus,
  type EditorTab,
  type GitDiffTab,
  type GitCommitFileDiffTab,
  type GitHistoryTab,
  type Tab,
  type TerminalTab,
} from "./tabsTypes";

export type TabPatch = Partial<{
  title: string;
  cwd: string;
  path: string;
  dirty: boolean;
  url: string;
  status: AiDiffStatus;
}>;

type State = {
  initialized: boolean;
  tabs: Tab[];
  activeId: number;
  nextId: number;
};

function createInitialTab(cwd?: string): TerminalTab {
  return {
    id: 1,
    kind: "terminal",
    title: "shell",
    cwd,
    paneTree: { kind: "leaf", id: 2, cwd },
    activeLeafId: 2,
  };
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host || url;
  } catch {
    return url || "preview";
  }
}

export const useTabsPiniaStore = defineStore("tabs", {
  state: (): State => ({
    initialized: false,
    tabs: [],
    activeId: 1,
    nextId: 3,
  }),
  actions: {
    init(cwd?: string) {
      if (this.initialized) return;
      this.tabs = [createInitialTab(cwd)];
      this.activeId = 1;
      this.nextId = 3;
      this.initialized = true;
    },
    setActiveId(id: number) {
      if (this.tabs.some((tab) => tab.id === id)) this.activeId = id;
    },
    newTab(cwd?: string): number {
      if (!this.initialized) this.init();
      const tabId = this.nextId++;
      const leafId = this.nextId++;
      this.tabs.push({
        id: tabId,
        kind: "terminal",
        title: "shell",
        cwd,
        paneTree: { kind: "leaf", id: leafId, cwd },
        activeLeafId: leafId,
      });
      this.activeId = tabId;
      return tabId;
    },
    newPrivateTab(cwd?: string): number {
      if (!this.initialized) this.init();
      const tabId = this.nextId++;
      const leafId = this.nextId++;
      this.tabs.push({
        id: tabId,
        kind: "terminal",
        title: "private",
        cwd,
        paneTree: { kind: "leaf", id: leafId, cwd },
        activeLeafId: leafId,
        private: true,
      });
      this.activeId = tabId;
      return tabId;
    },
    openFileTab(path: string, pin = true): number | null {
      if (!this.initialized) this.init();
      if (pin) {
        const existing = this.tabs.find(
          (tab) => tab.kind === "editor" && tab.path === path,
        );
        if (existing) {
          if (existing.kind === "editor" && existing.preview) {
            this.tabs = this.tabs.map((tab) =>
              tab.id === existing.id ? { ...tab, preview: false } : tab,
            );
          }
          this.activeId = existing.id;
          return existing.id;
        }
        const id = this.nextId++;
        this.tabs.push({
          id,
          kind: "editor",
          title: basename(path),
          path,
          dirty: false,
          preview: false,
        });
        this.activeId = id;
        return id;
      }

      const persistent = this.tabs.find(
        (tab) => tab.kind === "editor" && tab.path === path && !tab.preview,
      );
      if (persistent) {
        this.activeId = persistent.id;
        return persistent.id;
      }

      const existingPreview = this.tabs.find(
        (tab) => tab.kind === "editor" && tab.path === path && tab.preview,
      );
      if (existingPreview) {
        this.activeId = existingPreview.id;
        return existingPreview.id;
      }

      const id = this.nextId++;
      const tab: EditorTab = {
        id,
        kind: "editor",
        title: basename(path),
        path,
        dirty: false,
        preview: true,
      };
      const previewIndex = this.tabs.findIndex(
        (item) => item.kind === "editor" && item.preview,
      );
      if (previewIndex === -1) this.tabs.push(tab);
      else this.tabs.splice(previewIndex, 1, tab);
      this.activeId = id;
      return id;
    },
    pinTab(id: number) {
      this.tabs = this.tabs.map((tab) =>
        tab.id === id && tab.kind === "editor"
          ? { ...tab, preview: false }
          : tab,
      );
    },
    newPreviewTab(url: string): number {
      if (!this.initialized) this.init();
      const id = this.nextId++;
      this.tabs.push({ id, kind: "preview", title: titleFromUrl(url), url });
      this.activeId = id;
      return id;
    },
    newMarkdownTab(path: string): number {
      if (!this.initialized) this.init();
      const existing = this.tabs.find(
        (tab) => tab.kind === "markdown" && tab.path === path,
      );
      if (existing) {
        this.activeId = existing.id;
        return existing.id;
      }
      const id = this.nextId++;
      this.tabs.push({ id, kind: "markdown", title: basename(path), path });
      this.activeId = id;
      return id;
    },
    openGitDiffTab(input: {
      repoRoot: string;
      path: string;
      mode: "-" | "+";
      originalPath: string | null;
      title?: string;
    }): number {
      if (!this.initialized) this.init();
      const title = input.title ?? basename(input.path);
      const existing = this.tabs.find(
        (tab) =>
          tab.kind === "git-diff" &&
          tab.repoRoot === input.repoRoot &&
          tab.path === input.path &&
          tab.mode === input.mode,
      );
      if (existing) {
        this.tabs = this.tabs.map((tab) =>
          tab.id === existing.id
            ? { ...tab, title, originalPath: input.originalPath }
            : tab,
        );
        this.activeId = existing.id;
        return existing.id;
      }
      const id = this.nextId++;
      const tab: GitDiffTab = {
        id,
        kind: "git-diff",
        title,
        repoRoot: input.repoRoot,
        path: input.path,
        mode: input.mode,
        originalPath: input.originalPath,
      };
      this.tabs.push(tab);
      this.activeId = id;
      return id;
    },
    openCommitHistoryTab(input: { repoRoot: string; branch?: string | null }): number {
      if (!this.initialized) this.init();
      const title = input.branch ? `History · ${input.branch}` : "Git History";
      const existing = this.tabs.find(
        (tab) => tab.kind === "git-history" && tab.repoRoot === input.repoRoot,
      );
      if (existing) {
        this.tabs = this.tabs.map((tab) =>
          tab.id === existing.id ? { ...tab, title } : tab,
        );
        this.activeId = existing.id;
        return existing.id;
      }
      const id = this.nextId++;
      const tab: GitHistoryTab = {
        id,
        kind: "git-history",
        title,
        repoRoot: input.repoRoot,
      };
      this.tabs.push(tab);
      this.activeId = id;
      return id;
    },
    openCommitFileDiffTab(input: {
      repoRoot: string;
      sha: string;
      shortSha: string;
      subject: string;
      path: string;
      originalPath: string | null;
    }): number {
      if (!this.initialized) this.init();
      const title = `${basename(input.path)} @ ${input.shortSha}`;
      const existing = this.tabs.find(
        (tab) =>
          tab.kind === "git-commit-file" &&
          tab.repoRoot === input.repoRoot &&
          tab.sha === input.sha &&
          tab.path === input.path,
      );
      if (existing) {
        this.tabs = this.tabs.map((tab) =>
          tab.id === existing.id
            ? {
                ...tab,
                title,
                subject: input.subject,
                originalPath: input.originalPath,
              }
            : tab,
        );
        this.activeId = existing.id;
        return existing.id;
      }
      const id = this.nextId++;
      const tab: GitCommitFileDiffTab = {
        id,
        kind: "git-commit-file",
        title,
        repoRoot: input.repoRoot,
        sha: input.sha,
        shortSha: input.shortSha,
        subject: input.subject,
        path: input.path,
        originalPath: input.originalPath,
      };
      this.tabs.push(tab);
      this.activeId = id;
      return id;
    },
    closeTab(id: number) {
      if (this.tabs.length <= 1) return;
      const idx = this.tabs.findIndex((tab) => tab.id === id);
      if (idx < 0) return;
      const target = this.tabs[idx];
      const toDispose =
        target.kind === "terminal" ? leafIds(target.paneTree) : [];
      const next = this.tabs.filter((tab) => tab.id !== id);
      this.tabs = next;
      if (this.activeId === id) {
        this.activeId = next[Math.max(0, idx - 1)]?.id ?? next[0]?.id ?? id;
      }
      for (const leafId of toDispose) disposeTerminalSession(leafId);
    },
    focusPane(tabId: number, leafId: number) {
      this.tabs = this.tabs.map((tab) =>
        tab.id === tabId && tab.kind === "terminal" && hasLeaf(tab.paneTree, leafId)
          ? {
              ...tab,
              activeLeafId: leafId,
              ...(findLeafCwd(tab.paneTree, leafId) !== undefined
                ? { cwd: findLeafCwd(tab.paneTree, leafId) }
                : {}),
            }
          : tab,
      );
    },
    setLeafCwd(leafId: number, cwd: string) {
      this.tabs = this.tabs.map((tab) => {
        if (tab.kind !== "terminal") return tab;
        const nextTree = setLeafCwdInTree(tab.paneTree, leafId, cwd);
        const patch =
          tab.activeLeafId === leafId ? { cwd } : {};
        return { ...tab, ...patch, paneTree: nextTree };
      });
    },
    updateTab(id: number, patch: TabPatch) {
      this.tabs = this.tabs.map((tab) => {
        if (tab.id !== id) return tab;
        if (tab.kind === "terminal") {
          return {
            ...tab,
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.cwd !== undefined ? { cwd: patch.cwd } : {}),
          };
        }
        if (tab.kind === "preview") {
          return {
            ...tab,
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.url !== undefined
              ? { url: patch.url, title: patch.title ?? titleFromUrl(patch.url) }
              : {}),
          };
        }
        if (tab.kind === "markdown" || tab.kind === "git-history") {
          return {
            ...tab,
            ...(patch.title !== undefined ? { title: patch.title } : {}),
          };
        }
        if (tab.kind === "ai-diff") {
          return {
            ...tab,
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.status !== undefined ? { status: patch.status } : {}),
          };
        }
        if (tab.kind === "editor") {
          return {
            ...tab,
            ...(patch.dirty === true && tab.preview ? { preview: false } : {}),
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.dirty !== undefined ? { dirty: patch.dirty } : {}),
            ...(patch.path !== undefined ? { path: patch.path } : {}),
          };
        }
        return {
          ...tab,
          ...(patch.title !== undefined ? { title: patch.title } : {}),
        };
      });
    },
    splitActivePane(tabId: number, dir: SplitDir): number | null {
      let newLeafId: number | null = null;
      this.tabs = this.tabs.map((tab) => {
        if (tab.id !== tabId || tab.kind !== "terminal") return tab;
        if (leafIds(tab.paneTree).length >= MAX_PANES_PER_TAB) return tab;
        const splitId = this.nextId++;
        const leafId = this.nextId++;
        newLeafId = leafId;
        return {
          ...tab,
          paneTree: splitLeaf(
            tab.paneTree,
            tab.activeLeafId,
            splitId,
            leafId,
            dir,
            tab.cwd,
          ),
          activeLeafId: leafId,
        };
      });
      return newLeafId;
    },
    closeActivePane(tabId: number): boolean {
      const tabIndex = this.tabs.findIndex((tab) => tab.id === tabId);
      const tab = this.tabs[tabIndex];
      if (!tab || tab.kind !== "terminal") return false;

      const targetLeafId = tab.activeLeafId;
      const nextTree = removeLeaf(tab.paneTree, targetLeafId);
      if (nextTree === null) {
        if (this.tabs.length <= 1) return false;
        const nextTabs = this.tabs.filter((item) => item.id !== tabId);
        this.tabs = nextTabs;
        if (this.activeId === tabId) {
          this.activeId =
            nextTabs[Math.max(0, tabIndex - 1)]?.id ?? nextTabs[0]?.id ?? tabId;
        }
        disposeTerminalSession(targetLeafId);
        return true;
      }

      const remaining = leafIds(nextTree);
      const sibling = siblingLeafOf(tab.paneTree, targetLeafId);
      const activeLeafId =
        sibling && remaining.includes(sibling) ? sibling : remaining[0];
      const cwd = findLeafCwd(nextTree, activeLeafId);
      this.tabs = this.tabs.map((item) =>
        item.id === tabId && item.kind === "terminal"
          ? {
              ...item,
              paneTree: nextTree,
              activeLeafId,
              ...(cwd !== undefined ? { cwd } : {}),
            }
          : item,
      );
      disposeTerminalSession(targetLeafId);
      return false;
    },
  },
});
