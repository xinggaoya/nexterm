import { defineStore } from "pinia";
import { ref } from "vue";
import {
  findLeafCwd,
  findLeafTitle,
  hasLeaf,
  leafIds,
  removeLeaf,
  setLeafCwd as setLeafCwdInTree,
  setLeafTitle as setLeafTitleInTree,
  siblingLeafOf,
  splitLeaf,
  type SplitDir,
} from "@/modules/terminal/lib/panes";
import { disposeTerminalSession } from "./terminalDisposal";
import { reorderTabs, type TabDropPlacement } from "./tabsReorder";
import {
  MAX_PANES_PER_TAB,
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
}>;

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

function inputForCommand(command: string): string {
  return /[\r\n]$/.test(command) ? command : `${command}\r`;
}

function taskTitle(command: string): string {
  const normalized = command.trim().replace(/\s+/g, " ");
  const title = normalized.length > 48 ? `${normalized.slice(0, 45)}...` : normalized;
  return `task: ${title}`;
}

export const useTabsPiniaStore = defineStore("tabs", () => {
  const initialized = ref(false);
  const tabs = ref<Tab[]>([]);
  const activeId = ref(1);
  const nextId = ref(3);

  function init(cwd?: string): void {
    if (initialized.value) return;
    tabs.value = [createInitialTab(cwd)];
    activeId.value = 1;
    nextId.value = 3;
    initialized.value = true;
  }

  function resetWorkspace(cwd?: string): void {
    if (!initialized.value) {
      init(cwd);
      return;
    }
    for (const tab of tabs.value) {
      if (tab.kind !== "terminal") continue;
      for (const leafId of leafIds(tab.paneTree)) {
        disposeTerminalSession(leafId);
      }
    }
    const tabId = nextId.value++;
    const leafId = nextId.value++;
    tabs.value = [
      {
        id: tabId,
        kind: "terminal",
        title: "shell",
        cwd,
        paneTree: { kind: "leaf", id: leafId, cwd },
        activeLeafId: leafId,
      },
    ];
    activeId.value = tabId;
  }

  function setActiveId(id: number): void {
    if (tabs.value.some((tab) => tab.id === id)) activeId.value = id;
  }

  function newTab(cwd?: string): number {
    if (!initialized.value) init();
    const tabId = nextId.value++;
    const leafId = nextId.value++;
    tabs.value.push({
      id: tabId,
      kind: "terminal",
      title: "shell",
      cwd,
      paneTree: { kind: "leaf", id: leafId, cwd },
      activeLeafId: leafId,
    });
    activeId.value = tabId;
    return tabId;
  }

  function newTaskTerminal(input: { cwd?: string; command: string }): number {
    if (!initialized.value) init(input.cwd);
    const tabId = nextId.value++;
    const leafId = nextId.value++;
    const startupInput = inputForCommand(input.command);
    tabs.value.push({
      id: tabId,
      kind: "terminal",
      title: taskTitle(input.command),
      cwd: input.cwd,
      paneTree: {
        kind: "leaf",
        id: leafId,
        cwd: input.cwd,
        startupInput,
      },
      activeLeafId: leafId,
    });
    activeId.value = tabId;
    return tabId;
  }

  function openFileTab(path: string, pin = true): number | null {
    if (!initialized.value) init();
    if (pin) {
      const existing = tabs.value.find(
        (tab) => tab.kind === "editor" && tab.path === path,
      );
      if (existing) {
        if (existing.kind === "editor" && existing.preview) {
          tabs.value = tabs.value.map((tab) =>
            tab.id === existing.id ? { ...tab, preview: false } : tab,
          );
        }
        activeId.value = existing.id;
        return existing.id;
      }
      const id = nextId.value++;
      tabs.value.push({
        id,
        kind: "editor",
        title: basename(path),
        path,
        dirty: false,
        preview: false,
      });
      activeId.value = id;
      return id;
    }

    const persistent = tabs.value.find(
      (tab) => tab.kind === "editor" && tab.path === path && !tab.preview,
    );
    if (persistent) {
      activeId.value = persistent.id;
      return persistent.id;
    }

    const existingPreview = tabs.value.find(
      (tab) => tab.kind === "editor" && tab.path === path && tab.preview,
    );
    if (existingPreview) {
      activeId.value = existingPreview.id;
      return existingPreview.id;
    }

    const id = nextId.value++;
    const tab: EditorTab = {
      id,
      kind: "editor",
      title: basename(path),
      path,
      dirty: false,
      preview: true,
    };
    const previewIndex = tabs.value.findIndex(
      (item) => item.kind === "editor" && item.preview,
    );
    if (previewIndex === -1) tabs.value.push(tab);
    else tabs.value.splice(previewIndex, 1, tab);
    activeId.value = id;
    return id;
  }

  function pinTab(id: number): void {
    tabs.value = tabs.value.map((tab) =>
      tab.id === id && tab.kind === "editor"
        ? { ...tab, preview: false }
        : tab,
    );
  }

  function moveTab(
    sourceId: number,
    targetId: number,
    placement: TabDropPlacement,
  ): void {
    tabs.value = reorderTabs(tabs.value, sourceId, targetId, placement);
  }

  function newPreviewTab(url: string): number {
    if (!initialized.value) init();
    const id = nextId.value++;
    tabs.value.push({ id, kind: "preview", title: titleFromUrl(url), url });
    activeId.value = id;
    return id;
  }

  function newMarkdownTab(path: string): number {
    if (!initialized.value) init();
    const existing = tabs.value.find(
      (tab) => tab.kind === "markdown" && tab.path === path,
    );
    if (existing) {
      activeId.value = existing.id;
      return existing.id;
    }
    const id = nextId.value++;
    tabs.value.push({ id, kind: "markdown", title: basename(path), path });
    activeId.value = id;
    return id;
  }

  function openGitDiffTab(input: {
    repoRoot: string;
    path: string;
    mode: "-" | "+";
    originalPath: string | null;
    title?: string;
  }): number {
    if (!initialized.value) init();
    const title = input.title ?? basename(input.path);
    const existing = tabs.value.find(
      (tab) =>
        tab.kind === "git-diff" &&
        tab.repoRoot === input.repoRoot &&
        tab.path === input.path &&
        tab.mode === input.mode,
    );
    if (existing) {
      tabs.value = tabs.value.map((tab) =>
        tab.id === existing.id
          ? { ...tab, title, originalPath: input.originalPath }
          : tab,
      );
      activeId.value = existing.id;
      return existing.id;
    }
    const id = nextId.value++;
    const tab: GitDiffTab = {
      id,
      kind: "git-diff",
      title,
      repoRoot: input.repoRoot,
      path: input.path,
      mode: input.mode,
      originalPath: input.originalPath,
    };
    tabs.value.push(tab);
    activeId.value = id;
    return id;
  }

  function openCommitHistoryTab(input: {
    repoRoot: string;
    branch?: string | null;
  }): number {
    if (!initialized.value) init();
    const title = input.branch ? `History · ${input.branch}` : "Git History";
    const existing = tabs.value.find(
      (tab) => tab.kind === "git-history" && tab.repoRoot === input.repoRoot,
    );
    if (existing) {
      tabs.value = tabs.value.map((tab) =>
        tab.id === existing.id ? { ...tab, title } : tab,
      );
      activeId.value = existing.id;
      return existing.id;
    }
    const id = nextId.value++;
    const tab: GitHistoryTab = {
      id,
      kind: "git-history",
      title,
      repoRoot: input.repoRoot,
    };
    tabs.value.push(tab);
    activeId.value = id;
    return id;
  }

  function openCommitFileDiffTab(input: {
    repoRoot: string;
    sha: string;
    shortSha: string;
    subject: string;
    path: string;
    originalPath: string | null;
  }): number {
    if (!initialized.value) init();
    const title = `${basename(input.path)} @ ${input.shortSha}`;
    const existing = tabs.value.find(
      (tab) =>
        tab.kind === "git-commit-file" &&
        tab.repoRoot === input.repoRoot &&
        tab.sha === input.sha &&
        tab.path === input.path,
    );
    if (existing) {
      tabs.value = tabs.value.map((tab) =>
        tab.id === existing.id
          ? {
              ...tab,
              title,
              subject: input.subject,
              originalPath: input.originalPath,
            }
          : tab,
      );
      activeId.value = existing.id;
      return existing.id;
    }
    const id = nextId.value++;
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
    tabs.value.push(tab);
    activeId.value = id;
    return id;
  }

  function closeTab(id: number): void {
    if (tabs.value.length <= 1) return;
    const idx = tabs.value.findIndex((tab) => tab.id === id);
    if (idx < 0) return;
    const target = tabs.value[idx];
    const toDispose =
      target.kind === "terminal" ? leafIds(target.paneTree) : [];
    const next = tabs.value.filter((tab) => tab.id !== id);
    tabs.value = next;
    if (activeId.value === id) {
      activeId.value = next[Math.max(0, idx - 1)]?.id ?? next[0]?.id ?? id;
    }
    for (const leafId of toDispose) disposeTerminalSession(leafId);
  }

  function focusPane(tabId: number, leafId: number): void {
    tabs.value = tabs.value.map((tab) =>
      tab.id === tabId && tab.kind === "terminal" && hasLeaf(tab.paneTree, leafId)
        ? {
            ...tab,
            activeLeafId: leafId,
            terminalTitle: findLeafTitle(tab.paneTree, leafId),
            ...(findLeafCwd(tab.paneTree, leafId) !== undefined
              ? { cwd: findLeafCwd(tab.paneTree, leafId) }
              : {}),
          }
        : tab,
    );
  }

  function setLeafCwd(leafId: number, cwd: string): void {
    tabs.value = tabs.value.map((tab) => {
      if (tab.kind !== "terminal") return tab;
      const nextTree = setLeafCwdInTree(tab.paneTree, leafId, cwd);
      const patch =
        tab.activeLeafId === leafId ? { cwd } : {};
      return { ...tab, ...patch, paneTree: nextTree };
    });
  }

  function setLeafTitle(leafId: number, terminalTitle: string): void {
    tabs.value = tabs.value.map((tab) => {
      if (tab.kind !== "terminal") return tab;
      const nextTree = setLeafTitleInTree(tab.paneTree, leafId, terminalTitle);
      return {
        ...tab,
        terminalTitle: findLeafTitle(nextTree, tab.activeLeafId),
        paneTree: nextTree,
      };
    });
  }

  function updateTab(id: number, patch: TabPatch): void {
    tabs.value = tabs.value.map((tab) => {
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
  }

  function splitActivePane(tabId: number, dir: SplitDir): number | null {
    let newLeafId: number | null = null;
    tabs.value = tabs.value.map((tab) => {
      if (tab.id !== tabId || tab.kind !== "terminal") return tab;
      if (leafIds(tab.paneTree).length >= MAX_PANES_PER_TAB) return tab;
      const splitId = nextId.value++;
      const leafId = nextId.value++;
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
  }

  function closeActivePane(tabId: number): boolean {
    const tabIndex = tabs.value.findIndex((tab) => tab.id === tabId);
    const tab = tabs.value[tabIndex];
    if (!tab || tab.kind !== "terminal") return false;

    const targetLeafId = tab.activeLeafId;
    const nextTree = removeLeaf(tab.paneTree, targetLeafId);
    if (nextTree === null) {
      if (tabs.value.length <= 1) return false;
      const nextTabs = tabs.value.filter((item) => item.id !== tabId);
      tabs.value = nextTabs;
      if (activeId.value === tabId) {
        activeId.value =
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
    tabs.value = tabs.value.map((item) =>
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
  }

  return {
    initialized,
    tabs,
    activeId,
    nextId,
    init,
    resetWorkspace,
    setActiveId,
    newTab,
    newTaskTerminal,
    openFileTab,
    pinTab,
    moveTab,
    newPreviewTab,
    newMarkdownTab,
    openGitDiffTab,
    openCommitHistoryTab,
    openCommitFileDiffTab,
    closeTab,
    focusPane,
    setLeafCwd,
    setLeafTitle,
    updateTab,
    splitActivePane,
    closeActivePane,
  };
});
