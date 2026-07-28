import { defineStore } from "pinia";
import { computed, ref, toRaw } from "vue";
import { useWorkspacesPiniaStore } from "@/modules/workspace/workspacesPinia";
import {
  findLeafCwd,
  findLeafTitle,
  hasLeaf,
  leafIds,
  nextLeafInDir,
  removeLeaf,
  setLeafCwd as setLeafCwdInTree,
  setLeafTitle as setLeafTitleInTree,
  siblingLeafOf,
  splitLeaf,
  type SplitDir,
} from "@/modules/terminal/lib/layout";
import {
  disposeSession as disposeTerminalSession,
  disposeWorkspaceSessions,
} from "@/modules/terminal/lib/sessions";
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

function gitHistoryTitle(refName: string | null, allRefs: boolean): string {
  if (allRefs) return "All branches";
  if (refName) return `History · ${refName}`;
  return "Git History";
}

/**
 * Tabs store, partitioned by workspace.
 *
 * Each workspace owns an independent tab list + active id + closed-tab undo
 * stack. Switching the active workspace only flips which slice is exposed
 * via the `tabs`/`activeId` computed views — no terminal sessions are
 * destroyed, so background workspaces keep running.
 *
 * `workspaceId` is required on every mutation. Callers that already know
 * which workspace they operate in (WorkspaceHost-scoped components) pass it
 * explicitly; legacy callers can omit it to target the currently active
 * workspace via `useWorkspacesPiniaStore().activeWorkspaceId`.
 */
export const useTabsPiniaStore = defineStore("tabs", () => {
  // workspaceId → ordered tab list.
  const tabsByWorkspace = ref<Record<string, Tab[]>>({});
  // workspaceId → active tab id.
  const activeIdByWorkspace = ref<Record<string, number>>({});
  // Global monotonic id counter — guarantees tab/leaf ids are unique across
  // all workspaces (important for the terminal session registry).
  const nextId = ref(1);
  // workspaceId → closed-tab undo stack (most recent last).
  const closedStackByWorkspace = ref<Record<string, Tab[]>>({});
  const CLOSED_STACK_MAX = 20;
  // workspaceId → leafId → owning tabId. Lets `setLeafCwd` / `setLeafTitle`
  // find the owning tab in O(1) instead of walking every terminal pane tree
  // in the workspace. Critical because OSC emits cwd/title at potentially
  // high frequency, and the previous `.map()` over all tabs in the workspace
  // produced O(Tab 数) new tab objects per tick.
  const leafOwnerByWorkspace = ref<Record<string, Record<number, number>>>({});

  function registerLeaf(wsId: string, tabId: number, leafId: number): void {
    const bucket = leafOwnerByWorkspace.value[wsId] ?? {};
    bucket[leafId] = tabId;
    leafOwnerByWorkspace.value = { ...leafOwnerByWorkspace.value, [wsId]: bucket };
  }

  function unregisterLeaf(wsId: string, leafId: number): void {
    const bucket = leafOwnerByWorkspace.value[wsId];
    if (!bucket || !(leafId in bucket)) return;
    delete bucket[leafId];
    leafOwnerByWorkspace.value = { ...leafOwnerByWorkspace.value, [wsId]: { ...bucket } };
  }

  function clearLeafOwnersForTab(wsId: string, tabId: number): void {
    const bucket = leafOwnerByWorkspace.value[wsId];
    if (!bucket) return;
    let changed = false;
    const next: Record<number, number> = {};
    for (const [leafId, ownerId] of Object.entries(bucket)) {
      const numLeaf = Number(leafId);
      if (ownerId === tabId) {
        changed = true;
        continue;
      }
      next[numLeaf] = ownerId;
    }
    if (changed) {
      leafOwnerByWorkspace.value = { ...leafOwnerByWorkspace.value, [wsId]: next };
    }
  }

  const activeWorkspaceId = computed<string | null>(
    () => useWorkspacesPiniaStore().activeWorkspaceId,
  );

  /** Tabs of the currently active workspace (empty when none active). */
  const tabs = computed<Tab[]>(() => {
    const id = activeWorkspaceId.value;
    return id ? (tabsByWorkspace.value[id] ?? []) : [];
  });

  /** Active tab id of the currently active workspace. */
  const activeId = computed<number>(() => {
    const id = activeWorkspaceId.value;
    return id ? (activeIdByWorkspace.value[id] ?? 0) : 0;
  });

  /** Backwards-compat flag: true once the active workspace has any tabs. */
  const initialized = computed(() => {
    const id = activeWorkspaceId.value;
    return !!id && (tabsByWorkspace.value[id]?.length ?? 0) > 0;
  });

  function resolveWorkspaceId(workspaceId?: string): string {
    if (workspaceId) return workspaceId;
    const id = activeWorkspaceId.value;
    if (!id) {
      throw new Error(
        "tabs: no workspaceId given and no active workspace available",
      );
    }
    return id;
  }

  function workspaceTabs(workspaceId?: string): Tab[] {
    return tabsByWorkspace.value[resolveWorkspaceId(workspaceId)] ?? [];
  }

  function setWorkspaceTabs(workspaceId: string, next: Tab[]): void {
    tabsByWorkspace.value = { ...tabsByWorkspace.value, [workspaceId]: next };
  }

  function setActiveIdRaw(workspaceId: string, id: number): void {
    activeIdByWorkspace.value = {
      ...activeIdByWorkspace.value,
      [workspaceId]: id,
    };
  }

  function createInitialTab(workspaceId: string, cwd?: string): TerminalTab {
    const tabId = nextId.value++;
    const leafId = nextId.value++;
    registerLeaf(workspaceId, tabId, leafId);
    return {
      id: tabId,
      workspaceId,
      kind: "terminal",
      title: "shell",
      cwd,
      paneTree: { kind: "leaf", id: leafId, cwd },
      activeLeafId: leafId,
    };
  }

  /** Initialize a workspace's tab list if it doesn't already have one. */
  function initWorkspace(workspaceId: string, cwd?: string): void {
    if ((tabsByWorkspace.value[workspaceId]?.length ?? 0) > 0) return;
    const tab = createInitialTab(workspaceId, cwd);
    setWorkspaceTabs(workspaceId, [tab]);
    setActiveIdRaw(workspaceId, tab.id);
  }

  /**
   * Legacy alias used by callers that wanted "ensure tabs exist for the
   * active workspace". Prefer `initWorkspace(workspaceId, cwd)`.
   */
  function init(cwd?: string, workspaceId?: string): void {
    initWorkspace(resolveWorkspaceId(workspaceId), cwd);
  }

  function setActiveId(id: number, workspaceId?: string): void {
    const wsId = resolveWorkspaceId(workspaceId);
    if (workspaceTabs(wsId).some((tab) => tab.id === id)) {
      setActiveIdRaw(wsId, id);
    }
  }

  function newTab(cwd?: string, workspaceId?: string): number {
    const wsId = resolveWorkspaceId(workspaceId);
    const tab = createInitialTab(wsId, cwd);
    setWorkspaceTabs(wsId, [...workspaceTabs(wsId), tab]);
    setActiveIdRaw(wsId, tab.id);
    return tab.id;
  }

  function newTaskTerminal(
    input: { cwd?: string; command: string },
    workspaceId?: string,
  ): number {
    const wsId = resolveWorkspaceId(workspaceId);
    initWorkspace(wsId, input.cwd);
    const tabId = nextId.value++;
    const leafId = nextId.value++;
    const startupInput = inputForCommand(input.command);
    const tab: TerminalTab = {
      id: tabId,
      workspaceId: wsId,
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
    };
    registerLeaf(wsId, tabId, leafId);
    setWorkspaceTabs(wsId, [...workspaceTabs(wsId), tab]);
    setActiveIdRaw(wsId, tab.id);
    return tab.id;
  }

  function openFileTab(
    path: string,
    workspaceId?: string,
    pin = true,
  ): number | null {
    const wsId = resolveWorkspaceId(workspaceId);
    initWorkspace(wsId);
    const list = workspaceTabs(wsId);
    if (pin) {
      const existing = list.find(
        (tab) => tab.kind === "editor" && tab.path === path,
      );
      if (existing) {
        if (existing.kind === "editor" && existing.preview) {
          setWorkspaceTabs(
            wsId,
            list.map((tab) =>
              tab.id === existing.id ? { ...tab, preview: false } : tab,
            ),
          );
        }
        setActiveIdRaw(wsId, existing.id);
        return existing.id;
      }
      const id = nextId.value++;
      const tab: EditorTab = {
        id,
        workspaceId: wsId,
        kind: "editor",
        title: basename(path),
        path,
        dirty: false,
        preview: false,
      };
      setWorkspaceTabs(wsId, [...list, tab]);
      setActiveIdRaw(wsId, id);
      return id;
    }

    const persistent = list.find(
      (tab) => tab.kind === "editor" && tab.path === path && !tab.preview,
    );
    if (persistent) {
      setActiveIdRaw(wsId, persistent.id);
      return persistent.id;
    }

    const existingPreview = list.find(
      (tab) => tab.kind === "editor" && tab.path === path && tab.preview,
    );
    if (existingPreview) {
      setActiveIdRaw(wsId, existingPreview.id);
      return existingPreview.id;
    }

    const id = nextId.value++;
    const tab: EditorTab = {
      id,
      workspaceId: wsId,
      kind: "editor",
      title: basename(path),
      path,
      dirty: false,
      preview: true,
    };
    const previewIndex = list.findIndex(
      (item) => item.kind === "editor" && item.preview,
    );
    if (previewIndex === -1) setWorkspaceTabs(wsId, [...list, tab]);
    else {
      const next = [...list];
      next.splice(previewIndex, 1, tab);
      setWorkspaceTabs(wsId, next);
    }
    setActiveIdRaw(wsId, id);
    return id;
  }

  function pinTab(id: number, workspaceId?: string): void {
    const wsId = resolveWorkspaceId(workspaceId);
    setWorkspaceTabs(
      wsId,
      workspaceTabs(wsId).map((tab) =>
        tab.id === id && tab.kind === "editor"
          ? { ...tab, preview: false }
          : tab,
      ),
    );
  }

  function moveTab(
    sourceId: number,
    targetId: number,
    placement: TabDropPlacement,
    workspaceId?: string,
  ): void {
    const wsId = resolveWorkspaceId(workspaceId);
    setWorkspaceTabs(
      wsId,
      reorderTabs(workspaceTabs(wsId), sourceId, targetId, placement),
    );
  }

  function newPreviewTab(url: string, workspaceId?: string): number {
    const wsId = resolveWorkspaceId(workspaceId);
    initWorkspace(wsId);
    const id = nextId.value++;
    const tab = {
      id,
      workspaceId: wsId,
      kind: "preview" as const,
      title: titleFromUrl(url),
      url,
    };
    setWorkspaceTabs(wsId, [...workspaceTabs(wsId), tab]);
    setActiveIdRaw(wsId, id);
    return id;
  }

  function newMarkdownTab(path: string, workspaceId?: string): number {
    const wsId = resolveWorkspaceId(workspaceId);
    initWorkspace(wsId);
    const list = workspaceTabs(wsId);
    const existing = list.find(
      (tab) => tab.kind === "markdown" && tab.path === path,
    );
    if (existing) {
      setActiveIdRaw(wsId, existing.id);
      return existing.id;
    }
    const id = nextId.value++;
    const tab = {
      id,
      workspaceId: wsId,
      kind: "markdown" as const,
      title: basename(path),
      path,
    };
    setWorkspaceTabs(wsId, [...list, tab]);
    setActiveIdRaw(wsId, id);
    return id;
  }

  function openGitDiffTab(
    input: {
      repoRoot: string;
      path: string;
      mode: "-" | "+";
      originalPath: string | null;
      title?: string;
    },
    workspaceId?: string,
  ): number {
    const wsId = resolveWorkspaceId(workspaceId);
    initWorkspace(wsId);
    const title = input.title ?? basename(input.path);
    const list = workspaceTabs(wsId);
    const existing = list.find(
      (tab) =>
        tab.kind === "git-diff" &&
        tab.repoRoot === input.repoRoot &&
        tab.path === input.path &&
        tab.mode === input.mode,
    );
    if (existing) {
      setWorkspaceTabs(
        wsId,
        list.map((tab) =>
          tab.id === existing.id
            ? { ...tab, title, originalPath: input.originalPath }
            : tab,
        ),
      );
      setActiveIdRaw(wsId, existing.id);
      return existing.id;
    }
    const id = nextId.value++;
    const tab: GitDiffTab = {
      id,
      workspaceId: wsId,
      kind: "git-diff",
      title,
      repoRoot: input.repoRoot,
      path: input.path,
      mode: input.mode,
      originalPath: input.originalPath,
    };
    setWorkspaceTabs(wsId, [...list, tab]);
    setActiveIdRaw(wsId, id);
    return id;
  }

  function openCommitHistoryTab(
    input: {
      repoRoot: string;
      /** @deprecated Use `refName` + `allRefs` instead. */
      branch?: string | null;
      refName?: string | null;
      allRefs?: boolean;
    },
    workspaceId?: string,
  ): number {
    const wsId = resolveWorkspaceId(workspaceId);
    initWorkspace(wsId);
    const allRefs = input.allRefs ?? false;
    const refName = allRefs
      ? null
      : input.refName !== undefined
        ? input.refName
        : input.branch ?? null;
    const title = gitHistoryTitle(refName, allRefs);
    const list = workspaceTabs(wsId);
    const existing = list.find(
      (tab) =>
        tab.kind === "git-history" &&
        tab.repoRoot === input.repoRoot &&
        tab.refName === refName &&
        tab.allRefs === allRefs,
    );
    if (existing) {
      setWorkspaceTabs(
        wsId,
        list.map((tab) => (tab.id === existing.id ? { ...tab, title } : tab)),
      );
      setActiveIdRaw(wsId, existing.id);
      return existing.id;
    }
    const id = nextId.value++;
    const tab: GitHistoryTab = {
      id,
      workspaceId: wsId,
      kind: "git-history",
      title,
      repoRoot: input.repoRoot,
      refName,
      allRefs,
    };
    setWorkspaceTabs(wsId, [...list, tab]);
    setActiveIdRaw(wsId, id);
    return id;
  }

  function updateGitHistoryTabRef(
    id: number,
    fields: { refName?: string | null; allRefs?: boolean },
    workspaceId?: string,
  ): boolean {
    const wsId = resolveWorkspaceId(workspaceId);
    let updated = false;
    setWorkspaceTabs(
      wsId,
      workspaceTabs(wsId).map((tab) => {
        if (tab.id !== id || tab.kind !== "git-history") return tab;
        const refName =
          fields.refName !== undefined ? fields.refName : tab.refName;
        const allRefs =
          fields.allRefs !== undefined ? fields.allRefs : tab.allRefs;
        updated = true;
        return {
          ...tab,
          refName,
          allRefs,
          title: gitHistoryTitle(refName, allRefs),
        };
      }),
    );
    return updated;
  }

  function openCommitFileDiffTab(
    input: {
      repoRoot: string;
      sha: string;
      shortSha: string;
      subject: string;
      path: string;
      originalPath: string | null;
    },
    workspaceId?: string,
  ): number {
    const wsId = resolveWorkspaceId(workspaceId);
    initWorkspace(wsId);
    const title = `${basename(input.path)} @ ${input.shortSha}`;
    const list = workspaceTabs(wsId);
    const existing = list.find(
      (tab) =>
        tab.kind === "git-commit-file" &&
        tab.repoRoot === input.repoRoot &&
        tab.sha === input.sha &&
        tab.path === input.path,
    );
    if (existing) {
      setWorkspaceTabs(
        wsId,
        list.map((tab) =>
          tab.id === existing.id
            ? {
                ...tab,
                title,
                subject: input.subject,
                originalPath: input.originalPath,
              }
            : tab,
        ),
      );
      setActiveIdRaw(wsId, existing.id);
      return existing.id;
    }
    const id = nextId.value++;
    const tab: GitCommitFileDiffTab = {
      id,
      workspaceId: wsId,
      kind: "git-commit-file",
      title,
      repoRoot: input.repoRoot,
      sha: input.sha,
      shortSha: input.shortSha,
      subject: input.subject,
      path: input.path,
      originalPath: input.originalPath,
    };
    setWorkspaceTabs(wsId, [...list, tab]);
    setActiveIdRaw(wsId, id);
    return id;
  }

  function closeTab(id: number, workspaceId?: string): void {
    const wsId = resolveWorkspaceId(workspaceId);
    const list = workspaceTabs(wsId);
    if (list.length <= 1) return;
    const idx = list.findIndex((tab) => tab.id === id);
    if (idx < 0) return;
    const target = list[idx];
    const stack = closedStackByWorkspace.value[wsId] ?? [];
    const snapshot = JSON.parse(JSON.stringify(toRaw(target))) as Tab;
    closedStackByWorkspace.value = {
      ...closedStackByWorkspace.value,
      [wsId]: [...stack, snapshot].slice(-CLOSED_STACK_MAX),
    };
    const toDispose =
      target.kind === "terminal" ? leafIds(target.paneTree) : [];
    // 清掉被关闭 tab 拥有的所有 leaf 归属，让 GC 释放 ownership map。
    if (target.kind === "terminal") clearLeafOwnersForTab(wsId, target.id);
    const next = list.filter((tab) => tab.id !== id);
    setWorkspaceTabs(wsId, next);
    if (activeIdByWorkspace.value[wsId] === id) {
      setActiveIdRaw(wsId, next[Math.max(0, idx - 1)]?.id ?? next[0]?.id ?? id);
    }
    for (const leafId of toDispose) {
      disposeTerminalSession(wsId, String(leafId));
    }
  }

  function closeOthers(id: number, workspaceId?: string): void {
    const wsId = resolveWorkspaceId(workspaceId);
    const list = workspaceTabs(wsId);
    if (list.length <= 1) return;
    const keep = list.find((tab) => tab.id === id);
    if (!keep) return;
    for (const tab of list) {
      if (tab.id === id) continue;
      if (tab.kind === "terminal") {
        for (const leafId of leafIds(tab.paneTree)) {
          disposeTerminalSession(wsId, String(leafId));
        }
        clearLeafOwnersForTab(wsId, tab.id);
      }
    }
    setWorkspaceTabs(wsId, [keep]);
    setActiveIdRaw(wsId, id);
  }

  function closeToRight(id: number, workspaceId?: string): void {
    const wsId = resolveWorkspaceId(workspaceId);
    const list = workspaceTabs(wsId);
    const idx = list.findIndex((tab) => tab.id === id);
    if (idx < 0 || idx >= list.length - 1) return;
    const toClose = list.slice(idx + 1);
    for (const tab of toClose) {
      if (tab.kind === "terminal") {
        for (const leafId of leafIds(tab.paneTree)) {
          disposeTerminalSession(wsId, String(leafId));
        }
        clearLeafOwnersForTab(wsId, tab.id);
      }
    }
    setWorkspaceTabs(wsId, list.slice(0, idx + 1));
    if (!workspaceTabs(wsId).some((tab) => tab.id === activeIdByWorkspace.value[wsId])) {
      setActiveIdRaw(wsId, id);
    }
  }

  function closeAll(workspaceId?: string): void {
    const wsId = resolveWorkspaceId(workspaceId);
    const list = workspaceTabs(wsId);
    if (list.length === 0) return;
    for (const tab of list) {
      if (tab.kind === "terminal") {
        for (const leafId of leafIds(tab.paneTree)) {
          disposeTerminalSession(wsId, String(leafId));
        }
        clearLeafOwnersForTab(wsId, tab.id);
      }
    }
    const tab = createInitialTab(wsId);
    setWorkspaceTabs(wsId, [tab]);
    setActiveIdRaw(wsId, tab.id);
  }

  function cycleActive(direction: 1 | -1, workspaceId?: string): void {
    const wsId = resolveWorkspaceId(workspaceId);
    const list = workspaceTabs(wsId);
    if (list.length <= 1) return;
    const idx = list.findIndex((tab) => tab.id === activeIdByWorkspace.value[wsId]);
    if (idx < 0) {
      setActiveIdRaw(wsId, list[0].id);
      return;
    }
    const next = (idx + direction + list.length) % list.length;
    setActiveIdRaw(wsId, list[next].id);
  }

  function restoreClosed(workspaceId?: string): Tab | null {
    const wsId = resolveWorkspaceId(workspaceId);
    const stack = closedStackByWorkspace.value[wsId] ?? [];
    const restored = stack[stack.length - 1];
    if (!restored) return null;
    const nextStack = stack.slice(0, -1);
    closedStackByWorkspace.value = {
      ...closedStackByWorkspace.value,
      [wsId]: nextStack,
    };
    const list = workspaceTabs(wsId);
    const reId = (oldId: number): number => {
      if (list.some((t) => t.id === oldId)) return nextId.value++;
      return oldId;
    };
    const clone = JSON.parse(JSON.stringify(restored)) as Tab;
    clone.id = reId(clone.id);
    if (clone.kind === "terminal") {
      const visit = (node: typeof clone.paneTree) => {
        if (node.kind === "leaf") {
          node.id = reId(node.id as number);
          // restore 时把每一个 leaf 重新登记到 ownership 表，否则后续 OSC
          // cwd/title 会因为找不到 owner 而被新 setLeafCwd 直接 return。
          registerLeaf(wsId, clone.id, node.id as number);
        } else {
          node.id = reId(node.id as number);
          for (const child of node.children) visit(child);
        }
      };
      visit(clone.paneTree);
      clone.activeLeafId = reId(clone.activeLeafId);
    }
    setWorkspaceTabs(wsId, [...list, clone]);
    setActiveIdRaw(wsId, clone.id);
    return clone;
  }

  function focusPane(tabId: number, leafId: number, workspaceId?: string): void {
    const wsId = resolveWorkspaceId(workspaceId);
    setWorkspaceTabs(
      wsId,
      workspaceTabs(wsId).map((tab) =>
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
      ),
    );
  }

  function focusDirection(
    tabId: number,
    leafId: number,
    dir: "left" | "right" | "up" | "down",
    workspaceId?: string,
  ): number | null {
    const wsId = resolveWorkspaceId(workspaceId);
    const tab = workspaceTabs(wsId).find((t) => t.id === tabId);
    if (!tab || tab.kind !== "terminal") return null;
    const target = nextLeafInDir(tab.paneTree, leafId, dir);
    if (target === null) return null;
    const targetId = target as number;
    focusPane(tabId, targetId, wsId);
    return targetId;
  }

  function setLeafCwd(leafId: number, cwd: string, workspaceId?: string): void {
    const wsId = resolveWorkspaceId(workspaceId);
    // OSC 7 cwd 更新可能来自任意 pane，且每个 pane 频率不低。原先走
    // workspaceTabs(wsId).map() 会给本工作区内每个 terminal tab 都生成
    // 新对象（哪怕 leafId 不在它的 paneTree 里），把整个 TabBar 都打到。
    // 这里用 ownership 表把所有权查找收敛到 O(1)，只在命中 tab 上做
    // 单点 spread；非命中 tab 完全不参与，背景工作区的 cwd 抖动对前台
    // TabBar 零影响。
    const ownerTabId = leafOwnerByWorkspace.value[wsId]?.[leafId];
    if (ownerTabId === undefined) return;
    const list = workspaceTabs(wsId);
    const tabIndex = list.findIndex((t) => t.id === ownerTabId);
    if (tabIndex < 0) return;
    const tab = list[tabIndex];
    if (tab.kind !== "terminal") return;
    const nextTree = setLeafCwdInTree(tab.paneTree, leafId, cwd);
    const patch = tab.activeLeafId === leafId ? { cwd } : {};
    const next = list.slice();
    next[tabIndex] = { ...tab, ...patch, paneTree: nextTree };
    setWorkspaceTabs(wsId, next);
  }

  function setLeafTitle(
    leafId: number,
    terminalTitle: string,
    workspaceId?: string,
  ): void {
    const wsId = resolveWorkspaceId(workspaceId);
    // 同 setLeafCwd：靠 ownership 表 O(1) 找到 owner tab，单点 spread。
    const ownerTabId = leafOwnerByWorkspace.value[wsId]?.[leafId];
    if (ownerTabId === undefined) return;
    const list = workspaceTabs(wsId);
    const tabIndex = list.findIndex((t) => t.id === ownerTabId);
    if (tabIndex < 0) return;
    const tab = list[tabIndex];
    if (tab.kind !== "terminal") return;
    const nextTree = setLeafTitleInTree(tab.paneTree, leafId, terminalTitle);
    // terminalTitle 字段在 TabBar 上用作标签标题，仅 active leaf 的 title
    // 暴露在 tab.terminalTitle，非 active leaf 的变更不需要触发 TabBar 重渲。
    const next = list.slice();
    next[tabIndex] = {
      ...tab,
      ...(tab.activeLeafId === leafId ? { terminalTitle } : {}),
      paneTree: nextTree,
    };
    setWorkspaceTabs(wsId, next);
  }

  function updateTab(id: number, patch: TabPatch, workspaceId?: string): void {
    const wsId = resolveWorkspaceId(workspaceId);
    setWorkspaceTabs(
      wsId,
      workspaceTabs(wsId).map((tab) => {
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
      }),
    );
  }

  function splitActivePane(
    tabId: number,
    dir: SplitDir,
    workspaceId?: string,
  ): number | null {
    const wsId = resolveWorkspaceId(workspaceId);
    let newLeafId: number | null = null;
    setWorkspaceTabs(
      wsId,
      workspaceTabs(wsId).map((tab) => {
        if (tab.id !== tabId || tab.kind !== "terminal") return tab;
        if (leafIds(tab.paneTree).length >= MAX_PANES_PER_TAB) return tab;
        const splitId = nextId.value++;
        const leafId = nextId.value++;
        newLeafId = leafId;
        const { tree } = splitLeaf(
          tab.paneTree,
          tab.activeLeafId,
          dir,
          leafId,
          tab.cwd,
          splitId,
        );
        registerLeaf(wsId, tabId, leafId);
        return { ...tab, paneTree: tree, activeLeafId: leafId };
      }),
    );
    return newLeafId;
  }

  function closeActivePane(tabId: number, workspaceId?: string): boolean {
    const wsId = resolveWorkspaceId(workspaceId);
    const list = workspaceTabs(wsId);
    const tabIndex = list.findIndex((tab) => tab.id === tabId);
    const tab = list[tabIndex];
    if (!tab || tab.kind !== "terminal") return false;

    const targetLeafId = tab.activeLeafId;
    const nextTree = removeLeaf(tab.paneTree, targetLeafId);
    if (nextTree === null) {
      if (list.length <= 1) return false;
      clearLeafOwnersForTab(wsId, tabId);
      const nextTabs = list.filter((item) => item.id !== tabId);
      setWorkspaceTabs(wsId, nextTabs);
      if (activeIdByWorkspace.value[wsId] === tabId) {
        setActiveIdRaw(
          wsId,
          nextTabs[Math.max(0, tabIndex - 1)]?.id ?? nextTabs[0]?.id ?? tabId,
        );
      }
      disposeTerminalSession(wsId, String(targetLeafId));
      return true;
    }

    const remaining: number[] = leafIds(nextTree) as number[];
    const sibling = siblingLeafOf(tab.paneTree, targetLeafId);
    const activeLeafId: number | undefined =
      sibling !== null && remaining.includes(sibling as number)
        ? (sibling as number)
        : (remaining[0] ?? targetLeafId);
    const cwd = findLeafCwd(nextTree, activeLeafId);
    unregisterLeaf(wsId, Number(targetLeafId));
    setWorkspaceTabs(
      wsId,
      list.map((item) =>
        item.id === tabId && item.kind === "terminal"
          ? {
              ...item,
              paneTree: nextTree,
              activeLeafId,
              ...(cwd !== undefined ? { cwd } : {}),
            }
          : item,
      ),
    );
    disposeTerminalSession(wsId, String(targetLeafId));
    return false;
  }

  function closeLeafInTab(tabId: number, leafId: number, workspaceId?: string): void {
    const wsId = resolveWorkspaceId(workspaceId);
    const list = workspaceTabs(wsId);
    const tabIndex = list.findIndex((tab) => tab.id === tabId);
    const tab = list[tabIndex];
    if (!tab || tab.kind !== "terminal") return;
    const nextTree = removeLeaf(tab.paneTree, leafId);
    if (nextTree === null) {
      if (list.length <= 1) return;
      clearLeafOwnersForTab(wsId, tabId);
      const nextTabs = list.filter((item) => item.id !== tabId);
      setWorkspaceTabs(wsId, nextTabs);
      if (activeIdByWorkspace.value[wsId] === tabId) {
        setActiveIdRaw(
          wsId,
          nextTabs[Math.max(0, tabIndex - 1)]?.id ?? nextTabs[0]?.id ?? tabId,
        );
      }
      disposeTerminalSession(wsId, String(leafId));
      return;
    }
    const remaining: number[] = leafIds(nextTree) as number[];
    const sibling = siblingLeafOf(tab.paneTree, leafId);
    const activeLeafId: number | undefined =
      sibling !== null && remaining.includes(sibling as number)
        ? (sibling as number)
        : (remaining[0] ?? leafId);
    const cwd = findLeafCwd(nextTree, activeLeafId);
    unregisterLeaf(wsId, leafId);
    setWorkspaceTabs(
      wsId,
      list.map((item) =>
        item.id === tabId && item.kind === "terminal"
          ? {
              ...item,
              paneTree: nextTree,
              activeLeafId,
              ...(cwd !== undefined ? { cwd } : {}),
            }
          : item,
      ),
    );
    disposeTerminalSession(wsId, String(leafId));
  }

  /**
   * Tear down a workspace's entire tab set + all its terminal sessions.
   * Called when a workspace is removed. The entry is deleted from every
   * per-workspace map so memory is reclaimed.
   */
  function disposeWorkspaceTabs(workspaceId: string): void {
    disposeWorkspaceSessions(workspaceId);
    const nextTabs = { ...tabsByWorkspace.value };
    delete nextTabs[workspaceId];
    tabsByWorkspace.value = nextTabs;
    const nextActive = { ...activeIdByWorkspace.value };
    delete nextActive[workspaceId];
    activeIdByWorkspace.value = nextActive;
    const nextStack = { ...closedStackByWorkspace.value };
    delete nextStack[workspaceId];
    closedStackByWorkspace.value = nextStack;
    // ownership map 也得清理，否则会被 pinia 长期持有造成内存泄漏。
    const nextOwners = { ...leafOwnerByWorkspace.value };
    delete nextOwners[workspaceId];
    leafOwnerByWorkspace.value = nextOwners;
  }

  return {
    // state
    tabsByWorkspace,
    activeIdByWorkspace,
    closedStackByWorkspace,
    nextId,
    // derived (active-workspace view)
    initialized,
    tabs,
    activeId,
    activeWorkspaceId,
    // workspace init / teardown
    initWorkspace,
    disposeWorkspaceTabs,
    workspaceTabs,
    // mutations (workspaceId optional → active workspace)
    init,
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
    updateGitHistoryTabRef,
    openCommitFileDiffTab,
    closeTab,
    closeOthers,
    closeToRight,
    closeAll,
    cycleActive,
    restoreClosed,
    focusPane,
    focusDirection,
    setLeafCwd,
    setLeafTitle,
    updateTab,
    splitActivePane,
    closeActivePane,
    closeLeafInTab,
  };
});
