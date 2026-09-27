import { basename } from "@/lib/path";
import { defineStore } from "pinia";
import { computed, ref, toRaw } from "vue";
import { useWorkspacesPiniaStore } from "@/modules/workspace/workspacesPinia";
import {
  findLeafCwd,
  findLeafTitle,
  hasLeaf,
  leafIds,
  type PaneLeaf,
  type PaneNode,
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
import {
  deserializeTerminals,
  isWorthPersisting,
  serializeTerminal,
  type PersistedTerminalLayout,
} from "@/modules/terminal/lib/sessionRestore";
import { setTerminalLayout, loadTerminalLayout } from "@/modules/settings/store";
import { isDirtyEditorTab } from "./closeGuards";
import { reorderTabs, type TabDropPlacement } from "./tabsReorder";
import {
  MAX_PANES_PER_TAB,
  type EditorTab,
  type FilePreviewTab,
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
 * 关闭栈快照的深拷贝。必须走 JSON 往返，不能用 structuredClone：
 * pinia 深层响应式下，focusPane / updateTab 这类 spread 更新会把响应式
 * Proxy 原样存回 raw tab 的嵌套字段（paneTree），toRaw 只剥顶层代理；
 * structuredClone 遇到 Proxy 抛 DataCloneError，且抛在 tab 从列表移除
 * 之前，导致终端 tab 永远关不掉（editor tab 无嵌套对象字段所以幸免）。
 * Tab 是纯 JSON 数据（string/number/boolean/null/数组/普通对象），
 * JSON 序列化读写均穿透 Proxy，得到的是无代理纯净快照。
 */
function cloneTabSnapshot(tab: Tab): Tab {
  return JSON.parse(JSON.stringify(toRaw(tab))) as Tab;
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
    schedulePersistLayout(workspaceId);
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
  /**
   * 布局持久化。
   *
   * 写盘是防抖的：终端标题（OSC）高频变化，每次都写偏好会把 store 打满。
   * 读盘只在 initWorkspace 的首次进入时做一次。
   */
  const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const LAYOUT_PERSIST_DEBOUNCE_MS = 500;

  /**
   * 已 hydrate 的布局快照。
   *
   * tabs store **不**依赖 preferencesPinia —— 标签恢复发生在 WorkspaceHost
   * 挂载早期，那一刻偏好可能还没 hydrate，耦合它会带来初始化顺序问题。
   * 快照由应用入口在 hydrate 之后注入，读不到时走磁盘的异步路径。
   */
  let terminalLayoutSnapshot: Record<string, PersistedTerminalLayout> = {};

  function schedulePersistLayout(wsId: string): void {
    const existing = persistTimers.get(wsId);
    if (existing) clearTimeout(existing);
    persistTimers.set(
      wsId,
      setTimeout(() => {
        persistTimers.delete(wsId);
        void persistLayoutNow(wsId);
      }, LAYOUT_PERSIST_DEBOUNCE_MS),
    );
  }

  async function persistLayoutNow(wsId: string): Promise<void> {
    const list = (tabsByWorkspace.value[wsId] ?? []).filter(
      (tab): tab is TerminalTab => tab.kind === "terminal",
    );
    if (!isWorthPersisting(list)) {
      // 退化回"只有一个裸 shell"时不留痕：否则每次启动都会恢复出一个
      // 看起来多余的空终端。
      void setTerminalLayout(wsId, null);
      return;
    }
    const terminals = list
      .map((tab) => serializeTerminal(tab))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    if (terminals.length === 0) return;
    const activeIndex = list.findIndex(
      (tab) => tab.id === activeIdByWorkspace.value[wsId],
    );
    const layout: PersistedTerminalLayout = {
      terminals,
      activeTerminalIndex: activeIndex < 0 ? 0 : activeIndex,
    };
    void setTerminalLayout(wsId, layout);
  }

  /** 按持久化的布局重建终端标签。返回是否真的恢复了。 */
  /**
   * 按持久化的布局重建终端标签。
   *
   * 同步版本先看内存里的偏好（已 hydrate 时的快路径），没有则返回 false，
   * 由 `restoreLayoutAsync` 走磁盘。
   */
  function restoreLayout(wsId: string, fallbackCwd?: string): boolean {
    const stored = terminalLayoutSnapshot[wsId];
    if (!stored) return false;
    return applyRestoredLayout(wsId, stored, fallbackCwd);
  }

  function applyRestoredLayout(
    wsId: string,
    stored: PersistedTerminalLayout,
    fallbackCwd?: string,
  ): boolean {
    const { terminals, activeIndex } = deserializeTerminals(stored);
    if (terminals.length === 0) return false;
    const restored = terminals.map((entry) => {
      const tabId = nextId.value++;
      const leafIds = entry.leaves.map(() => nextId.value++);
      // leaf 归属登记：漏掉的话后续 OSC 的 cwd/title 找不到 owner 会静默失效。
      const root = buildTreeFromLeaves(entry.leaves, leafIds);
      const activeLeafId =
        leafIds[Math.min(entry.activeLeafIndex, leafIds.length - 1)]!;
      for (const leafId of leafIds) registerLeaf(wsId, tabId, leafId);
      const tab: TerminalTab = {
        id: tabId,
        workspaceId: wsId,
        kind: "terminal",
        title: entry.title,
        ...(entry.leaves[0]?.cwd || fallbackCwd
          ? { cwd: entry.leaves[0]?.cwd ?? fallbackCwd }
          : {}),
        paneTree: root,
        activeLeafId,
      };
      return tab;
    });
    setWorkspaceTabs(wsId, restored);
    setActiveIdRaw(wsId, restored[activeIndex]?.id ?? restored[0]!.id);
    return true;
  }

  /**
   * 重建一棵与 `leaves` 等长的左嵌套 split 树。
   *
   * 用左嵌套而不是恢复原始的左右/上下结构：分屏方向的"原样还原"对用户
   * 几乎没有价值（他记得的是"我开过三个终端"），而左右结构在窄面板里更好读。
   */
  function buildTreeFromLeaves(
    leaves: ReadonlyArray<{ cwd?: string; startupInput?: string }>,
    leafIds: readonly number[],
  ): PaneNode {
    const leafAt = (index: number): PaneLeaf => ({
      kind: "leaf",
      id: leafIds[index]!,
      ...(leaves[index]?.cwd ? { cwd: leaves[index]!.cwd } : {}),
      ...(leaves[index]?.startupInput
        ? { startupInput: leaves[index]!.startupInput }
        : {}),
    });
    let node: PaneNode = leafAt(0);
    for (let i = 1; i < leafIds.length; i += 1) {
      node = {
        kind: "split",
        id: nextId.value++,
        dir: "col",
        children: [node, leafAt(i)],
      };
    }
    return node;
  }

  function initWorkspace(workspaceId: string, cwd?: string): void {
    if ((tabsByWorkspace.value[workspaceId]?.length ?? 0) > 0) return;
    if (restoreLayout(workspaceId, cwd)) return;
    const tab = createInitialTab(workspaceId, cwd);
    setWorkspaceTabs(workspaceId, [tab]);
    setActiveIdRaw(workspaceId, tab.id);
    // 内存里没有（偏好尚未 hydrate）时异步补一次：只有当这期间用户还没
    // 自己开过标签才应用，否则会把用户刚建好的终端替换掉。
    void loadTerminalLayout(workspaceId).then((stored) => {
      if (!stored) return;
      if ((tabsByWorkspace.value[workspaceId]?.length ?? 0) > 1) return;
      applyRestoredLayout(workspaceId, stored, cwd);
    }).catch(() => undefined);
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

  /**
   * 「查找已存在 → 激活/可选更新，否则新建并激活」的公共实现。
   * 5 个 open/new tab 函数共用这一骨架，仅注入匹配器与工厂。
   */
  function findOrAddTab(
    wsId: string,
    match: (tab: Tab) => boolean,
    create: (id: number) => Tab,
    updateExisting?: (tab: Tab) => Tab,
  ): number {
    const list = workspaceTabs(wsId);
    const existing = list.find(match);
    if (existing) {
      if (updateExisting) {
        setWorkspaceTabs(
          wsId,
          list.map((tab) =>
            tab.id === existing.id ? updateExisting(tab) : tab,
          ),
        );
      }
      setActiveIdRaw(wsId, existing.id);
      return existing.id;
    }
    const id = nextId.value++;
    setWorkspaceTabs(wsId, [...list, create(id)]);
    setActiveIdRaw(wsId, id);
    return id;
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
    return findOrAddTab(
      wsId,
      (tab) => tab.kind === "markdown" && tab.path === path,
      (id) => ({
        id,
        workspaceId: wsId,
        kind: "markdown" as const,
        title: basename(path),
        path,
      }),
    );
  }

  function newFilePreviewTab(path: string, workspaceId?: string): number {
    const wsId = resolveWorkspaceId(workspaceId);
    initWorkspace(wsId);
    return findOrAddTab(
      wsId,
      (tab) => tab.kind === "file-preview" && tab.path === path,
      (id): FilePreviewTab => ({
        id,
        workspaceId: wsId,
        kind: "file-preview",
        title: basename(path),
        path,
      }),
    );
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
    return findOrAddTab(
      wsId,
      (tab) =>
        tab.kind === "git-diff" &&
        tab.repoRoot === input.repoRoot &&
        tab.path === input.path &&
        tab.mode === input.mode,
      (id): GitDiffTab => ({
        id,
        workspaceId: wsId,
        kind: "git-diff",
        title,
        repoRoot: input.repoRoot,
        path: input.path,
        mode: input.mode,
        originalPath: input.originalPath,
      }),
      (tab) =>
        tab.kind === "git-diff"
          ? { ...tab, title, originalPath: input.originalPath }
          : tab,
    );
  }

  function openCommitHistoryTab(
    input: {
      repoRoot: string;
      refName?: string | null;
      allRefs?: boolean;
    },
    workspaceId?: string,
  ): number {
    const wsId = resolveWorkspaceId(workspaceId);
    initWorkspace(wsId);
    const allRefs = input.allRefs ?? false;
    const refName = allRefs ? null : (input.refName ?? null);
    const title = gitHistoryTitle(refName, allRefs);
    return findOrAddTab(
      wsId,
      (tab) =>
        tab.kind === "git-history" &&
        tab.repoRoot === input.repoRoot &&
        tab.refName === refName &&
        tab.allRefs === allRefs,
      (id): GitHistoryTab => ({
        id,
        workspaceId: wsId,
        kind: "git-history",
        title,
        repoRoot: input.repoRoot,
        refName,
        allRefs,
      }),
      (tab) => (tab.kind === "git-history" ? { ...tab, title } : tab),
    );
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
    return findOrAddTab(
      wsId,
      (tab) =>
        tab.kind === "git-commit-file" &&
        tab.repoRoot === input.repoRoot &&
        tab.sha === input.sha &&
        tab.path === input.path,
      (id): GitCommitFileDiffTab => ({
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
      }),
      (tab) =>
        tab.kind === "git-commit-file"
          ? {
              ...tab,
              title,
              subject: input.subject,
              originalPath: input.originalPath,
            }
          : tab,
    );
  }

  function closeTab(id: number, workspaceId?: string): void {
    const wsId = resolveWorkspaceId(workspaceId);
    const list = workspaceTabs(wsId);
    if (list.length <= 1) return;
    const idx = list.findIndex((tab) => tab.id === id);
    if (idx < 0) return;
    const target = list[idx];
    const stack = closedStackByWorkspace.value[wsId] ?? [];
    const snapshot = cloneTabSnapshot(target);
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

  /**
   * 文件 / 目录被重命名或移动（explorer 内联重命名、拖拽搬运、OS 内 mv）后，
   * 让所有指向旧路径的 tab 跟随到新路径。
   *
   * 为什么必须跟：编辑器 tab 的身份就是 `path`，脏缓冲只活在内存里。不跟随
   * 的话用户下一次保存会把内容写回已经不存在的旧路径 —— 静默丢改动。
   *
   * **按前缀匹配**（`to` 是目录时，其内部的 tab 一并搬到新位置下的对应路径），
   * 与 `dropPath` 的匹配规则对称。拖拽把整个 `src/` 搬走是常用操作，只做
   * 精确匹配会让 `src/main.ts` 的标签留在旧路径，脏缓冲保存到那里就把文件
   * 在原位置重建了出来 —— 数据放错位置且全程无提示。
   *
   * 覆盖范围：editor / markdown / file-preview 的 `path`；git-diff 与
   * git-commit-file 额外把 `originalPath` 命中旧路径的也算进来（git 视角的
   * "重命名"），此时工作区侧的新路径就是 `to`。标题一律按新 basename 重算。
   *
   * 返回被更新的 tab 数量，供调用方判断是否需要额外编排。
   */
  function followPath(from: string, to: string, workspaceId?: string): number {
    const wsId = resolveWorkspaceId(workspaceId);
    const list = workspaceTabs(wsId);
    if (list.length === 0) return 0;
    const fromPrefix = `${from}/`;
    /** `path` 命中 `from` 本身，或位于 `from` 之内（`from` 是目录）。 */
    const remap = (path: string): string | null => {
      if (path === from) return to;
      if (path.startsWith(fromPrefix)) return `${to}/${path.slice(fromPrefix.length)}`;
      return null;
    };
    let changed = 0;
    const next = list.map((tab): Tab => {
      switch (tab.kind) {
        case "editor":
        case "markdown":
        case "file-preview": {
          const moved = remap(tab.path);
          if (!moved) return tab;
          changed += 1;
          // 脏缓冲与 preview 标记都原样保留 —— 只换身份，不改内容状态。
          return { ...tab, path: moved, title: basename(moved) };
        }
        case "git-diff": {
          const moved = remap(tab.path);
          const originalMoved = tab.originalPath ? remap(tab.originalPath) : null;
          if (!moved && !originalMoved) return tab;
          changed += 1;
          return {
            ...tab,
            path: moved ?? tab.path,
            title: basename(moved ?? tab.path),
            // 跟着 from 一起搬走的 originalPath 映射到新位置；留在原地的保留
            // 原值 —— 那正是"HEAD 侧旧名 vs 工作区侧新名"的重命名 diff，不该
            // 被抹成 null（null 表示"没有历史版本"，即新增文件）。
            originalPath: originalMoved ?? tab.originalPath,
          };
        }
        case "git-commit-file": {
          const moved = remap(tab.path);
          const originalMoved = tab.originalPath ? remap(tab.originalPath) : null;
          if (!moved && !originalMoved) return tab;
          changed += 1;
          const nextPath = moved ?? tab.path;
          return {
            ...tab,
            path: nextPath,
            title: `${basename(nextPath)} @ ${tab.shortSha}`,
            originalPath: originalMoved ?? tab.originalPath,
          };
        }
        default:
          return tab;
      }
    });
    if (changed === 0) return 0;
    setWorkspaceTabs(wsId, next);
    return changed;
  }

  /**
   * 文件 / 目录被删除后关闭指向它的 tab。
   *
   * 与 `closeTab` 的三点差异：
   * 1. 不受"至少留一个 tab"约束 —— 删到 0 个是合法结果（画布回到空态）。
   * 2. 不进关闭栈 —— 恢复一个已删除的文件只会拿到 ENOENT。
   * 3. **脏编辑器保留不关**：缓冲只存在内存里，静默关掉等于丢用户没保存的
   *    内容。保留的 tab 之后保存会由 `fs_write_file` 把文件重新写出来。
   *
   * 目录删除按 `path + "/"` 前缀匹配，目录内的文件 tab 一并关闭。
   */
  function dropPath(
    path: string,
    workspaceId?: string,
  ): { closed: number; keptDirty: number } {
    const wsId = resolveWorkspaceId(workspaceId);
    const list = workspaceTabs(wsId);
    if (list.length === 0) return { closed: 0, keptDirty: 0 };
    const isGone = (candidate: string): boolean =>
      candidate === path || candidate.startsWith(`${path}/`);
    const next: Tab[] = [];
    let closed = 0;
    let keptDirty = 0;
    let firstDroppedIndex = -1;
    for (let i = 0; i < list.length; i += 1) {
      const tab = list[i]!;
      if (!tabPathMatches(tab, isGone)) {
        next.push(tab);
        continue;
      }
      if (isDirtyEditorTab(tab)) {
        next.push(tab);
        keptDirty += 1;
        continue;
      }
      if (firstDroppedIndex < 0) firstDroppedIndex = i;
      closed += 1;
    }
    if (closed === 0) return { closed: 0, keptDirty };
    setWorkspaceTabs(wsId, next);
    const activeId = activeIdByWorkspace.value[wsId];
    if (next.length === 0) {
      setActiveIdRaw(wsId, 0);
    } else if (!next.some((tab) => tab.id === activeId)) {
      // 与 closeTab 同一取位逻辑：落到「第一个被删项的前一个」，
      // 而不是列表首位，避免活动标签在多选删除后无端跳回最左。
      const fallback = next[Math.min(firstDroppedIndex, next.length - 1)];
      if (fallback) setActiveIdRaw(wsId, fallback.id);
    }
    return { closed, keptDirty };
  }

  function tabPathMatches(
    tab: Tab,
    isGone: (candidate: string) => boolean,
  ): boolean {
    switch (tab.kind) {
      case "editor":
      case "markdown":
      case "file-preview":
        return isGone(tab.path);
      case "git-diff":
      case "git-commit-file":
        return (
          isGone(tab.path) ||
          (tab.originalPath !== null && isGone(tab.originalPath))
        );
      default:
        return false;
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

  /**
   * 从终端 tab 中移除一个 leaf 的公共实现：
   * 返回 true 表示整棵 pane 树被移除（tab 本身已关闭）。
   */
  function removeLeafFromTab(
    wsId: string,
    tabId: number,
    leafId: number,
    tabIndex: number,
  ): boolean {
    const list = workspaceTabs(wsId);
    const tab = list[tabIndex];
    if (!tab || tab.kind !== "terminal") return false;
    const nextTree = removeLeaf(tab.paneTree, leafId);
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
      disposeTerminalSession(wsId, String(leafId));
      return true;
    }
    const remaining: number[] = leafIds(nextTree) as number[];
    const sibling = siblingLeafOf(tab.paneTree, leafId);
    const activeLeafId: number | undefined =
      sibling !== null && remaining.includes(sibling as number)
        ? (sibling as number)
        : (remaining[0] ?? leafId);
    const cwd = findLeafCwd(nextTree, activeLeafId);
    unregisterLeaf(wsId, Number(leafId));
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
    return false;
  }

  function closeActivePane(tabId: number, workspaceId?: string): boolean {
    const wsId = resolveWorkspaceId(workspaceId);
    const list = workspaceTabs(wsId);
    const tabIndex = list.findIndex((tab) => tab.id === tabId);
    const tab = list[tabIndex];
    if (!tab || tab.kind !== "terminal") return false;
    return removeLeafFromTab(wsId, tabId, tab.activeLeafId, tabIndex);
  }

  function closeLeafInTab(tabId: number, leafId: number, workspaceId?: string): void {
    const wsId = resolveWorkspaceId(workspaceId);
    const list = workspaceTabs(wsId);
    const tabIndex = list.findIndex((tab) => tab.id === tabId);
    const tab = list[tabIndex];
    if (!tab || tab.kind !== "terminal") return;
    removeLeafFromTab(wsId, tabId, leafId, tabIndex);
  }

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
    persistLayoutNow,
    /** 注入已 hydrate 的布局快照（应用入口在偏好加载完成后调用）。 */
    setTerminalLayoutSnapshot: (layouts: Record<string, PersistedTerminalLayout>) => {
      terminalLayoutSnapshot = layouts ?? {};
    },
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
    newFilePreviewTab,
    openGitDiffTab,
    openCommitHistoryTab,
    updateGitHistoryTabRef,
    openCommitFileDiffTab,
    closeTab,
    followPath,
    dropPath,
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
