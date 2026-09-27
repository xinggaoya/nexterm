import { basename } from "@/lib/path";
import { normalizeErrorMessage } from "@/lib/error";
import { useVirtualWindow } from "@/lib/useVirtualWindow";
import type { WorkspaceNative, WorkspaceFsChangedEvent } from "@/lib/native";
import type { GitDecorationMap } from "@/modules/source-control";
import { isSameWorkspaceRoot, normalizeWorkspacePath } from "@/modules/workspace";
import { computed, reactive, ref, shallowRef, watch, type Ref } from "vue";
import {
  buildFileTreeRows,
  filterFileTreeRows,
  updateFileTreeRows,
  type FileTreeRow as VisibleTreeRow,
  type FileTreeSnapshot,
  type FileTreeState,
  type PendingCreate,
} from "../lib/fileTreeRows";
import {
  createFileTreeEntry,
  joinPath,
  readFileTreeDir,
  renameFileTreePath,
  type DirEntry,
} from "../lib/fileTreeService";

/**
 * 文件树的**数据层**：目录内容的加载与缓存、展开态、行集计算、虚拟滚动
 * 窗口、watcher 事件到树刷新的编排、内联新建/重命名的状态机。
 *
 * 为什么不留在组件里：这一层占了组件近 500 行，且它与渲染、选择、搬运
 * 三件事都无关。拆出来后（1）组件只做组装；（2）刷新/防抖这类时序逻辑可以
 * 单独推理与测试；（3）将来加"多根工作区"或"虚拟懒加载"时只改这一处。
 *
 * 不碰的边界：这一层**不做**任何搬运、不改选择集、不发组件事件 ——
 * 那分别是 useTreeTransfer / useTreeSelection / 组件自己的事。
 */

export type FileTreeDataOptions = {
  rootPath: Ref<string | null>;
  fsEvent: Ref<WorkspaceFsChangedEvent | null | undefined>;
  gitDecorations: Ref<GitDecorationMap | undefined>;
  showHidden: Ref<boolean>;
  wsNative: WorkspaceNative;
  /** 树滚动时的副作用（当前用于关闭右键菜单）。 */
  onScroll?: (event: Event) => void;
};

type LoadChildrenOptions = {
  silent?: boolean;
};

type InFlightLoad = {
  rerun: boolean;
  silent: boolean;
};

/** FileTreeRow 定高 24px（template h-6）。pending / rename 含内联输入框，
 * 仍全量渲染以保留焦点。 */
const ROW_HEIGHT = 24;
const VIRTUAL_THRESHOLD = 200;
/** watcher 事件到重读之间的防抖：一次批量事件只触发一次 loadChildren。 */
const FS_REFRESH_DEBOUNCE_MS = 180;

export function useFileTreeData(options: FileTreeDataOptions) {
  const { rootPath, fsEvent, gitDecorations, showHidden, wsNative } = options;

  const nodes = reactive<FileTreeState>({});
  const expanded = reactive(new Set<string>());
  const pendingCreate = ref<PendingCreate | null>(null);
  const renaming = ref<string | null>(null);
  /** 树过滤词（子串匹配，只作用在已加载的行上）。 */
  const treeFilter = ref("");

  let fsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingFsEventPaths = new Set<string>();
  const inFlightLoads = new Map<string, InFlightLoad>();

  const emptySnapshot: FileTreeSnapshot = {
    rows: [] as VisibleTreeRow[],
    entryIndexByPath: new Map<string, number>(),
  };
  const treeSnapshot = shallowRef<FileTreeSnapshot>(emptySnapshot);

  const rootName = computed(() => {
    const root = rootPath.value;
    return root ? basename(root) : "";
  });

  const rootState = computed(() => {
    const root = rootPath.value;
    return root ? nodes[root] : undefined;
  });

  function rebuildTreeSnapshot() {
    if (!rootPath.value) {
      treeSnapshot.value = emptySnapshot;
      return;
    }
    treeSnapshot.value = buildFileTreeRows({
      rootPath: rootPath.value,
      nodes,
      expanded,
      pendingCreate: pendingCreate.value,
      renaming: renaming.value,
      gitDecorations: gitDecorations.value,
    });
  }

  function patchTreeSnapshot(changedPaths: string[]) {
    if (!rootPath.value) {
      treeSnapshot.value = emptySnapshot;
      return;
    }
    const result = updateFileTreeRows(treeSnapshot.value, changedPaths, {
      rootPath: rootPath.value,
      nodes,
      expanded,
      pendingCreate: pendingCreate.value,
      renaming: renaming.value,
      gitDecorations: gitDecorations.value,
    });
    if (result !== treeSnapshot.value) {
      treeSnapshot.value = result;
    }
  }

  const rows = computed(() => treeSnapshot.value.rows);
  const hasTreeFilter = computed(() => treeFilter.value.trim().length > 0);
  /** 超过阈值才切到窗口化渲染（阈值以下全量渲染更快也更简单）。 */
  const useVirtualization = computed(() => visibleRows.value.length > VIRTUAL_THRESHOLD);
  const filteredRows = computed(() => filterFileTreeRows(rows.value, treeFilter.value));
  /** 渲染与交互（选择、键盘、拖拽）统一看这一份，保证"看得见"="能选中"。 */
  const visibleRows = computed(() =>
    hasTreeFilter.value ? filteredRows.value : rows.value,
  );
  const entryIndexByPath = computed(() => {
    if (!hasTreeFilter.value) return treeSnapshot.value.entryIndexByPath;
    const index = new Map<string, number>();
    for (const [i, row] of visibleRows.value.entries()) {
      if (row.kind === "entry" || row.kind === "rename") index.set(row.path, i);
    }
    return index;
  });
  const entryPaths = computed(() =>
    visibleRows.value.flatMap((row) => (row.kind === "entry" ? [row.path] : [])),
  );

  const pendingAtRoot = computed<VisibleTreeRow | null>(() => {
    const root = rootPath.value;
    if (!root || pendingCreate.value?.parentPath !== root) return null;
    return {
      kind: "pending",
      key: `pending:${root}`,
      depth: 0,
      pendingKind: pendingCreate.value.kind,
    };
  });

  // ── 虚拟滚动 ──────────────────────────────────────────────────────
  const treeScroll = ref<HTMLElement | null>(null);
  const virtualWindow = useVirtualWindow(treeScroll, {
    total: () => visibleRows.value.length,
    rowHeight: ROW_HEIGHT,
    onScroll: options.onScroll,
  });
  const virtualRows = computed(() => {
    const { start, end } = virtualWindow.range.value;
    return visibleRows.value.slice(start, end);
  });

  // ── 目录加载 ──────────────────────────────────────────────────────
  async function loadChildren(path: string, opts: LoadChildrenOptions = {}) {
    const current = nodes[path];
    const silent = opts.silent === true && current?.status === "loaded";
    const active = inFlightLoads.get(path);
    if (active) {
      active.rerun = true;
      active.silent = active.silent && silent;
      return;
    }

    inFlightLoads.set(path, { rerun: false, silent });
    if (!silent) {
      nodes[path] = { status: "loading" };
      rebuildTreeSnapshot();
    }
    try {
      const entries = await readFileTreeDir(wsNative, path, showHidden.value);
      nodes[path] = { status: "loaded", entries };
      if (silent) {
        // 成员没变走快路径（只 patch）；有增删/改名必须整棵重建，否则新出现
        // 的条目会带着旧的选择态/重命名态渲染出来。
        if (entriesMembershipChanged(current?.entries, entries)) {
          rebuildTreeSnapshot();
        } else {
          patchTreeSnapshot([path]);
        }
      } else {
        rebuildTreeSnapshot();
      }
    } catch (error) {
      nodes[path] = { status: "error", message: normalizeErrorMessage(error) };
      rebuildTreeSnapshot();
    } finally {
      const finished = inFlightLoads.get(path);
      inFlightLoads.delete(path);
      if (finished?.rerun) {
        void loadChildren(path, { silent: finished.silent });
      }
    }
  }

  /**
   * 比较两次 `readFileTreeDir` 结果的**成员**（名字 + 类型）。
   * 故意不看 size/mtime：内容变化不需要重建，增删才需要。
   */
  function entriesMembershipChanged(
    prev: DirEntry[] | undefined,
    next: DirEntry[],
  ): boolean {
    if (!prev) return true;
    if (prev.length !== next.length) return true;
    const prevKeys = new Set<string>();
    for (const entry of prev) prevKeys.add(entryMembershipKey(entry));
    for (const entry of next) {
      if (!prevKeys.has(entryMembershipKey(entry))) return true;
    }
    return false;
  }

  function entryMembershipKey(entry: DirEntry): string {
    return `${entry.kind}:${entry.name}`;
  }

  // ── 刷新编排 ──────────────────────────────────────────────────────
  function isRefreshableState(state: FileTreeState[string] | undefined): boolean {
    return state?.status === "loaded" || state?.status === "error";
  }

  function refreshPath(path: string | null = rootPath.value) {
    if (!path) return;
    const targets = Object.entries(nodes)
      .filter(([, state]) => isRefreshableState(state))
      .map(([p]) => p);
    // 用户在首屏加载完成前狂点刷新：此时还没有任何可刷新的节点。
    if (targets.length === 0) {
      void loadChildren(path);
      return;
    }
    // 由深到浅：让 loadChildren 的在途去重把祖先刷新与子节点刷新合并，
    // 而不是互相打架。
    targets.sort((a, b) => b.length - a.length);
    for (const target of targets) {
      void loadChildren(target, { silent: true });
    }
  }

  function isPathWithinRoot(path: string, root: string): boolean {
    return path === root || path.startsWith(`${root}/`);
  }

  function nearestRefreshableAncestor(
    path: string,
    root: string,
    refreshablePaths: Map<string, string>,
  ): string | null {
    let cursor = dirnameOf(path);
    while (isPathWithinRoot(cursor, root)) {
      const original = refreshablePaths.get(cursor);
      if (original) return original;
      if (cursor === root) break;
      const next = dirnameOf(cursor);
      if (next === cursor) break;
      cursor = next;
    }
    return null;
  }

  /** fs 事件涉及的路径 → 需要重读的已加载目录集合。 */
  function refreshTargetsForPaths(paths: string[]): string[] {
    if (!rootPath.value) return [];
    const root = normalizeWorkspacePath(rootPath.value);
    const refreshablePaths = new Map<string, string>();
    for (const [path, state] of Object.entries(nodes)) {
      if (isRefreshableState(state)) {
        refreshablePaths.set(normalizeWorkspacePath(path), path);
      }
    }

    const targets = new Set<string>();
    let sawRelevantPath = false;
    for (const rawPath of paths.length > 0 ? paths : [rootPath.value]) {
      const path = normalizeWorkspacePath(rawPath);
      if (!isPathWithinRoot(path, root)) continue;
      sawRelevantPath = true;

      const sizeBefore = targets.size;
      if (path === root) {
        const target = refreshablePaths.get(root);
        if (target) targets.add(target);
        continue;
      }

      const parent = refreshablePaths.get(dirnameOf(path));
      if (parent) targets.add(parent);

      const direct = refreshablePaths.get(path);
      if (direct) targets.add(direct);

      if (targets.size === sizeBefore) {
        const ancestor = nearestRefreshableAncestor(path, root, refreshablePaths);
        if (ancestor) targets.add(ancestor);
      }
    }

    if (targets.size === 0 && sawRelevantPath && rootPath.value) {
      targets.add(rootPath.value);
    }
    return Array.from(targets);
  }

  function clearScheduledTreeRefresh() {
    if (fsRefreshTimer) clearTimeout(fsRefreshTimer);
    fsRefreshTimer = null;
    pendingFsEventPaths.clear();
  }

  /**
   * 立即 flush 待执行的重读（取消防抖）。
   *
   * 场景：workspace 切回可见时不立即 flush，切走期间 watcher 已发出但仍
   * 落在防抖窗口内的变更要等满窗口才生效 —— 用户看到 explorer 切回时"树是
   * 旧的，几百毫秒后才更新"。
   */
  function flushPendingTreeRefresh(): void {
    if (fsRefreshTimer === null && pendingFsEventPaths.size === 0) return;
    clearScheduledTreeRefresh();
    if (!rootPath.value) return;
    const paths = Array.from(pendingFsEventPaths);
    if (paths.length === 0) return;
    for (const path of refreshTargetsForPaths(paths)) {
      void loadChildren(path, { silent: true });
    }
  }

  /**
   * 切回激活钩子：不等 forceFlush/fsEvent，直接重读根与所有展开节点。
   * 这些是切换 tab 时实际可见的状态，必须立刻对；随后到达的 forceFlush
   * 事件会被上面的 watch 接住，重复的 loadChildren 由 inFlightLoads 吃掉。
   */
  function activate(): void {
    flushPendingTreeRefresh();
    if (!rootPath.value) return;
    void loadChildren(rootPath.value, { silent: true });
    for (const dir of expanded) {
      if (dir === rootPath.value) continue;
      if (nodes[dir]?.status === "loaded") {
        void loadChildren(dir, { silent: true });
      }
    }
  }

  function scheduleTreeRefresh(event: WorkspaceFsChangedEvent) {
    if (!rootPath.value) return;
    for (const path of event.paths.length > 0 ? event.paths : [rootPath.value]) {
      pendingFsEventPaths.add(path);
    }
    if (fsRefreshTimer) clearTimeout(fsRefreshTimer);
    fsRefreshTimer = setTimeout(() => {
      fsRefreshTimer = null;
      if (!rootPath.value) return;
      const paths = Array.from(pendingFsEventPaths);
      pendingFsEventPaths.clear();
      for (const path of refreshTargetsForPaths(paths)) {
        void loadChildren(path, { silent: true });
      }
    }, FS_REFRESH_DEBOUNCE_MS);
  }

  // ── 展开态 ────────────────────────────────────────────────────────
  function toggleDir(path: string) {
    const isOpen = expanded.has(path);
    if (isOpen) expanded.delete(path);
    else expanded.add(path);
    rebuildTreeSnapshot();
    if (!isOpen && (!nodes[path] || nodes[path].status === "error")) {
      void loadChildren(path);
    }
  }

  const expandedCount = computed(() => {
    const root = rootPath.value;
    if (!root) return 0;
    let count = 0;
    for (const dir of expanded) {
      if (dir !== root && dir.startsWith(`${root}/`)) count += 1;
    }
    return count;
  });

  /**
   * 只处理**已加载**的目录：为了铺开一棵树就把每个子目录都拉一遍，正是
   * 文件树在大仓里卡顿的主因。未展开的目录仍然可以点开时懒加载。
   */
  function loadedDirectories(): string[] {
    const root = rootPath.value;
    return Object.entries(nodes)
      .filter(([path, state]) => state.status === "loaded" && path !== root)
      .map(([path]) => path);
  }

  function collapseAll() {
    expanded.clear();
    rebuildTreeSnapshot();
  }

  function expandAllLoaded() {
    for (const dir of loadedDirectories()) expanded.add(dir);
    rebuildTreeSnapshot();
  }

  function toggleExpandAll() {
    if (expandedCount.value > 0) collapseAll();
    else expandAllLoaded();
  }

  // ── 内联新建 ──────────────────────────────────────────────────────
  function beginCreate(parentPath: string | null, kind: "file" | "dir") {
    if (!parentPath) return;
    pendingCreate.value = { parentPath, kind };
    if (rootPath.value && parentPath !== rootPath.value) {
      expanded.add(parentPath);
    }
    rebuildTreeSnapshot();
    if (!nodes[parentPath]) void loadChildren(parentPath);
  }

  function cancelCreate() {
    pendingCreate.value = null;
    rebuildTreeSnapshot();
  }

  async function commitCreate(name: string) {
    const pending = pendingCreate.value;
    if (!pending) return;
    const trimmed = name.trim();
    if (!trimmed) {
      pendingCreate.value = null;
      rebuildTreeSnapshot();
      return;
    }
    const path = joinPath(pending.parentPath, trimmed);
    try {
      await createFileTreeEntry(wsNative, path, pending.kind);
      await loadChildren(pending.parentPath);
    } finally {
      pendingCreate.value = null;
      rebuildTreeSnapshot();
    }
  }

  // ── 内联重命名 ────────────────────────────────────────────────────
  function beginRename(path: string) {
    pendingCreate.value = null;
    renaming.value = path;
    rebuildTreeSnapshot();
  }

  function cancelRename() {
    renaming.value = null;
    rebuildTreeSnapshot();
  }

  async function commitRename(newName: string) {
    const from = renaming.value;
    if (!from) return;
    const trimmed = newName.trim();
    const parent = dirnameOf(from);
    const oldName = basename(from);
    if (!trimmed || trimmed === oldName) {
      renaming.value = null;
      rebuildTreeSnapshot();
      return;
    }
    const to = joinPath(parent, trimmed);
    try {
      await renameFileTreePath(wsNative, from, to);
      return { from, to, parent };
    } finally {
      renaming.value = null;
      rebuildTreeSnapshot();
    }
  }

  // ── 供搬运层查询的只读视图 ────────────────────────────────────────
  /** 已加载目录的条目名集合；未加载返回 null（表示"判不了"）。 */
  function entryNamesOf(dir: string): Set<string> | null {
    const state = nodes[dir];
    if (state?.status !== "loaded") return null;
    return new Set(state.entries.map((entry) => entry.name));
  }

  function isEntryDir(dir: string, name: string): boolean {
    const state = nodes[dir];
    if (state?.status !== "loaded") return false;
    return state.entries.some((entry) => entry.name === name && entry.kind === "dir");
  }

  // ── 响应式编排 ────────────────────────────────────────────────────
  watch(
    rootPath,
    (next) => {
      clearScheduledTreeRefresh();
      Object.keys(nodes).forEach((key) => delete nodes[key]);
      expanded.clear();
      pendingCreate.value = null;
      renaming.value = null;
      treeFilter.value = "";
      rebuildTreeSnapshot();
      if (next) void loadChildren(next);
    },
    { immediate: true },
  );

  watch(showHidden, () => {
    if (!rootPath.value) return;
    const loadedPaths = Object.entries(nodes)
      .filter(([, state]) => state.status === "loaded")
      .map(([path]) => path);
    for (const path of loadedPaths.length > 0 ? loadedPaths : [rootPath.value]) {
      void loadChildren(path);
    }
  });

  watch(fsEvent, (event) => {
    if (!event || !isSameWorkspaceRoot(event.rootPath, rootPath.value)) return;
    scheduleTreeRefresh(event);
  });

  // 源控角标变化时只需重算**当前可见**的目录。全量重建会在大仓上退化到
  // 秒级（每次 git status 都重新遍历所有已加载目录）。
  watch(gitDecorations, () => {
    const root = rootPath.value;
    if (!root) return;
    const visibleDirs = [root];
    for (const dir of expanded) {
      if (dir === root || !dir.startsWith(`${root}/`)) continue;
      visibleDirs.push(dir);
    }
    if (visibleDirs.length === 0) return;
    patchTreeSnapshot(visibleDirs);
  });

  // 注意：行集合变化后剔除不可见选中项的 watch 放在 useTreeSelection ——
  // 选择集的写权限归它所有，数据层不该反向持有它（否则两个 composable 会
  // 互相 import 成环）。
  return {
    // 状态
    nodes,
    expanded,
    pendingCreate,
    renaming,
    treeFilter,
    // 派生
    rootName,
    rootState,
    rows,
    visibleRows,
    entryIndexByPath,
    entryPaths,
    pendingAtRoot,
    expandedCount,
    hasTreeFilter,
    useVirtualization,
    // 虚拟滚动
    treeScroll,
    virtualRows,
    virtualTopPadding: virtualWindow.topPadding,
    virtualBottomPadding: virtualWindow.bottomPadding,
    onTreeScroll: virtualWindow.onScroll,
    // 只读查询
    entryNamesOf,
    isEntryDir,
    dirnameOf,
    // 动作
    rebuildTreeSnapshot,
    loadChildren,
    refreshPath,
    refreshTargetsForPaths,
    clearScheduledTreeRefresh,
    flushPendingTreeRefresh,
    activate,
    toggleDir,
    collapseAll,
    expandAllLoaded,
    toggleExpandAll,
    beginCreate,
    cancelCreate,
    commitCreate,
    beginRename,
    cancelRename,
    commitRename,
  };
}

/** `dirname` 的本地别名：数据层只需要它做路径回溯。 */
function dirnameOf(path: string): string {
  const slash = path.lastIndexOf("/");
  if (slash <= 0) return "/";
  return path.slice(0, slash);
}
