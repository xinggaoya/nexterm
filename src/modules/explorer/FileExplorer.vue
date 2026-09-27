<script setup lang="ts">
import { useVirtualWindow } from "@/lib/useVirtualWindow";
import { useEventListener } from "@/lib/useEventListener";
import { usePointerDragReorder } from "@/lib/usePointerDragReorder";
import { basename } from "@/lib/path";
import { normalizeErrorMessage } from "@/lib/error";
import {
  CopyOutline,
  DocumentOutline,
  FolderOutline,
  MoveOutline,
  RefreshOutline,
  SearchOutline,
} from "@vicons/ionicons5";
import { NButton, NIcon } from "naive-ui";
import { computed, onBeforeUnmount, reactive, ref, shallowRef, watch } from "vue";
import TooltipTitle from "@/components/TooltipTitle.vue";
import { t, type MessageKey } from "@/modules/i18n/translate";
import { useWorkspaceContext } from "@/app/workspaceContext";
import type {
  FsConflictPolicy,
  FsTransferResult,
  OsFileDragEvent,
  WorkspaceFsChangedEvent,
} from "@/lib/native";
import { onOsFileDragDrop } from "@/lib/native";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import { notifyError, notifyInfo, notifySuccess } from "@/modules/notifications/notificationCenter";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import { isSameWorkspaceRoot, normalizeWorkspacePath } from "@/modules/workspace";
import type { GitDecorationMap } from "@/modules/source-control";
import ExplorerContextMenu, {
  type ExplorerContextMenuTarget,
} from "./ExplorerContextMenu.vue";
import ExplorerSearch from "./ExplorerSearch.vue";
import { FindInFilesPanel } from "@/modules/search";
import FileTreeRow from "./FileTreeRow.vue";
import FileTransferConflictDialog, {
  type ConflictRequest,
} from "./FileTransferConflictDialog.vue";
import {
  canTransferInto,
  describeRejections,
  isInsideDir,
  planTransfer,
  summarizeTransfer,
  type PlanPolicy,
  type RejectReason,
  type TransferMode,
} from "./lib/fileTransfer";
import { useFileClipboard } from "./lib/fileClipboard";
import {
  buildFileTreeRows,
  updateFileTreeRows,
  type FileTreeRow as VisibleTreeRow,
  type FileTreeSnapshot,
  type FileTreeState,
  type PendingCreate,
} from "./lib/fileTreeRows";
import {
  copyFileTreePath,
  createFileTreeEntry,
  deleteFileTreePath,
  dirname,
  generateCopyTarget,
  joinPath,
  readFileTreeDir,
  renameFileTreePath,
  type DirEntry,
} from "./lib/fileTreeService";import { folderIconUrl } from "./lib/iconResolver";

type EntryRow = Extract<VisibleTreeRow, { kind: "entry" }>;
type MenuRow = Extract<VisibleTreeRow, { kind: "entry" | "rename" }>;
type LoadChildrenOptions = {
  silent?: boolean;
};
type InFlightLoad = {
  rerun: boolean;
  silent: boolean;
};

const props = defineProps<{
  rootPath: string | null;
  fsEvent?: WorkspaceFsChangedEvent | null;
  gitDecorations?: GitDecorationMap;
}>();

const emit = defineEmits<{
  openFile: [path: string, pin: boolean];
  pathRenamed: [from: string, to: string];
  pathDeleted: [path: string];
  pathDuplicated: [from: string, to: string];
  openMarkdownPreview: [path: string];
  openFilePreview: [path: string];
  openInTerminal: [path: string];
  openSearchResult: [path: string, line: number];
}>();

const prefs = usePreferencesPiniaStore();
const wsCtx = useWorkspaceContext();
const nodes = reactive<FileTreeState>({});
const expanded = reactive(new Set<string>());
const pendingCreate = ref<PendingCreate | null>(null);
const renaming = ref<string | null>(null);
// ── 多选状态 ────────────────────────────────────────────────────────────
// selectedPaths：当前高亮的全部行；每次变更都整体替换 Set，shallowRef 即可触发更新。
// focusedPath：键盘导航的光标行（最近一次操作的行）。
// anchorPath：Shift 范围选择的起点，普通点击 / Ctrl 点击会把锚点移到该行。
const selectedPaths = shallowRef<ReadonlySet<string>>(new Set());
const focusedPath = ref<string | null>(null);
const anchorPath = ref<string | null>(null);
const isSearchOpen = ref(false);
const isSearchActive = ref(false);
// 每个工作区的文件树各持一份剪贴板：组件卸载即丢弃，切工作区自然隔离。
const clipboard = useFileClipboard();
const mode = ref<"files" | "content">("files");
const menu = ref<ExplorerContextMenuTarget | null>(null);
let fsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
const pendingFsEventPaths = new Set<string>();
const inFlightLoads = new Map<string, InFlightLoad>();

// ── Virtual scroll window ──────────────────────────────────────────────
// FileTreeRow 定高 24px（template h-6）。窗口化实现见 lib/useVirtualWindow；
// pending / rename 含内联输入框，仍全量渲染以保留焦点。
const ROW_HEIGHT = 24;
const VIRTUAL_THRESHOLD = 200;
const treeScroll = ref<HTMLElement | null>(null);
const {
  range: virtualRange,
  topPadding: virtualTopPadding,
  bottomPadding: virtualBottomPadding,
  onScroll: onTreeScroll,
} = useVirtualWindow(treeScroll, {
  total: () => rows.value.length,
  rowHeight: ROW_HEIGHT,
  onScroll: () => closeMenu(),
});
const virtualRows = computed(() => {
  const { start, end } = virtualRange.value;
  return rows.value.slice(start, end);
});

const rootName = computed(() => {
  if (!props.rootPath) return "";
  return basename(props.rootPath);
});

const rootState = computed(() =>
  props.rootPath ? nodes[props.rootPath] : undefined,
);

const emptySnapshot: FileTreeSnapshot = {
  rows: [] as VisibleTreeRow[],
  entryIndexByPath: new Map<string, number>(),
};

const treeSnapshot = shallowRef<FileTreeSnapshot>(emptySnapshot);

function rebuildTreeSnapshot() {
  if (!props.rootPath) {
    treeSnapshot.value = emptySnapshot;
    return;
  }
  treeSnapshot.value = buildFileTreeRows({
    rootPath: props.rootPath,
    nodes,
    expanded,
    pendingCreate: pendingCreate.value,
    renaming: renaming.value,
    gitDecorations: props.gitDecorations,
  });
}

function patchTreeSnapshot(changedPaths: string[]) {
  if (!props.rootPath) {
    treeSnapshot.value = emptySnapshot;
    return;
  }
  const result = updateFileTreeRows(treeSnapshot.value, changedPaths, {
    rootPath: props.rootPath,
    nodes,
    expanded,
    pendingCreate: pendingCreate.value,
    renaming: renaming.value,
    gitDecorations: props.gitDecorations,
  });
  if (result !== treeSnapshot.value) {
    treeSnapshot.value = result;
  }
}

// Return every directory path that is either the root or has been
// expanded. These are the only directories whose rows are currently
// visible in the tree, so they're the only ones that need to be
// re-walked when the git decoration map changes.
function visibleDirectoryPaths(): string[] {
  const root = props.rootPath;
  if (!root) return [];
  const out = [root];
  for (const dir of expanded) {
    // Only include paths inside the current root, otherwise we will
    // feed stale entries from a previous workspace into the patch.
    if (dir === root || dir.startsWith(`${root}/`)) out.push(dir);
  }
  return out;
}

const rows = computed(() => treeSnapshot.value.rows);
const entryIndexByPath = computed(() => treeSnapshot.value.entryIndexByPath);
const entryPaths = computed(() =>
  rows.value.flatMap((row) => (row.kind === "entry" ? [row.path] : [])),
);
const pendingAtRoot = computed<VisibleTreeRow | null>(() => {
  if (!props.rootPath || pendingCreate.value?.parentPath !== props.rootPath) {
    return null;
  }
  return {
    kind: "pending",
    key: `pending:${props.rootPath}`,
    depth: 0,
    pendingKind: pendingCreate.value.kind,
  };
});

// ── 选择操作 ────────────────────────────────────────────────────────────
function selectOnly(path: string | null) {
  selectedPaths.value = path ? new Set([path]) : new Set();
  focusedPath.value = path;
  anchorPath.value = path;
}

function toggleSelection(path: string) {
  const next = new Set(selectedPaths.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  selectedPaths.value = next;
  focusedPath.value = path;
  anchorPath.value = path;
}

// 从锚点到目标行（含）之间的可见行全部选中；锚点不动，光标移到目标行。
function selectRange(toPath: string) {
  const paths = entryPaths.value;
  const anchor = anchorPath.value ?? toPath;
  const from = paths.indexOf(anchor);
  const to = paths.indexOf(toPath);
  if (from < 0 || to < 0) {
    selectOnly(toPath);
    return;
  }
  const [start, end] = from <= to ? [from, to] : [to, from];
  selectedPaths.value = new Set(paths.slice(start, end + 1));
  focusedPath.value = toPath;
  anchorPath.value = anchor;
}

function selectAll() {
  const paths = entryPaths.value;
  if (paths.length === 0) return;
  selectedPaths.value = new Set(paths);
  if (!focusedPath.value) focusedPath.value = paths[0];
  if (!anchorPath.value) anchorPath.value = paths[0];
}

// 选中路径按树的可见顺序返回，供上下文菜单批量操作使用。
function orderedSelectedPaths(): string[] {
  const selected = selectedPaths.value;
  if (selected.size === 0) return [];
  return entryPaths.value.filter((path) => selected.has(path));
}

async function loadChildren(path: string, options: LoadChildrenOptions = {}) {
  const current = nodes[path];
  const silent = options.silent === true && current?.status === "loaded";
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
    const entries = await readFileTreeDir(wsCtx.wsNative, path, prefs.showHidden);
    nodes[path] = { status: "loaded", entries };
    if (silent) {
      // Pick patch vs rebuild based on whether the membership of this
      // directory changed. mtime/size-only changes still take the fast
      // patch path; add/remove/rename forces a full rebuild so any
      // newly visible entry is rendered with the current selection,
      // rename state, and pending-create state — none of which the
      // incremental patch path can synthesize reliably for entries
      // that didn't exist before.
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

// Compare the membership (name + kind) of two `readFileTreeDir` snapshots.
// We intentionally ignore size and mtime here: a content-only edit doesn't
// need a rebuild, but a brand-new file or a removed one does.
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

function refreshPath(path: string | null = props.rootPath) {
  if (!path) return;
  const targets = Object.entries(nodes)
    .filter(([, state]) => isRefreshableState(state))
    .map(([p]) => p);
  // Cover the case where nothing has been loaded yet (e.g. the user
  // mashes refresh before the initial load resolves).
  if (targets.length === 0) {
    void loadChildren(path);
    return;
  }
  // Deepest first so the in-flight dedupe in `loadChildren` coalesces
  // ancestor refreshes with child refreshes instead of fighting them.
  targets.sort((a, b) => b.length - a.length);
  for (const target of targets) {
    void loadChildren(target, { silent: true });
  }
}

function isSameRoot(a: string | null, b: string | null): boolean {
  return isSameWorkspaceRoot(a, b);
}

function isRefreshableState(state: FileTreeState[string] | undefined): boolean {
  return state?.status === "loaded" || state?.status === "error";
}

function isPathWithinRoot(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function nearestRefreshableAncestor(
  path: string,
  root: string,
  refreshablePaths: Map<string, string>,
): string | null {
  let cursor = dirname(path);
  while (isPathWithinRoot(cursor, root)) {
    const original = refreshablePaths.get(cursor);
    if (original) return original;
    if (cursor === root) break;
    const next = dirname(cursor);
    if (next === cursor) break;
    cursor = next;
  }
  return null;
}

function refreshTargetsForPaths(paths: string[]): string[] {
  if (!props.rootPath) return [];
  const root = normalizeWorkspacePath(props.rootPath);
  const refreshablePaths = new Map<string, string>();
  for (const [path, state] of Object.entries(nodes)) {
    if (isRefreshableState(state)) {
      refreshablePaths.set(normalizeWorkspacePath(path), path);
    }
  }

  const targets = new Set<string>();
  let sawRelevantPath = false;
  for (const rawPath of paths.length > 0 ? paths : [props.rootPath]) {
    const path = normalizeWorkspacePath(rawPath);
    if (!isPathWithinRoot(path, root)) continue;
    sawRelevantPath = true;

    const sizeBefore = targets.size;
    if (path === root) {
      const target = refreshablePaths.get(root);
      if (target) targets.add(target);
      continue;
    }

    const parent = refreshablePaths.get(dirname(path));
    if (parent) targets.add(parent);

    const direct = refreshablePaths.get(path);
    if (direct) targets.add(direct);

    if (targets.size === sizeBefore) {
      const ancestor = nearestRefreshableAncestor(path, root, refreshablePaths);
      if (ancestor) targets.add(ancestor);
    }
  }

  if (targets.size === 0 && sawRelevantPath && props.rootPath) {
    targets.add(props.rootPath);
  }
  return Array.from(targets);
}

function clearScheduledTreeRefresh() {
  if (fsRefreshTimer) clearTimeout(fsRefreshTimer);
  fsRefreshTimer = null;
  pendingFsEventPaths.clear();
}

/**
 * 立即 flush 待执行的 tree refresh（取消 180ms 防抖,同步执行）。
 *
 * 调用场景:workspace 切回可见时。如果不立即 flush,切走期间 watcher
 * 已经发出但仍在防抖窗口内的变更,要等 180ms 后才真正 loadChildren,
 * 用户看到 explorer 切回时"树状结构暂时是切走时的旧状态,几百毫秒
 * 后才更新到最新"——这是用户报告的"切回字段内容缺失,新内容出现才
 * 有内容"的根因之一。
 *
 * 由 WorkspaceHost 在 watch activeWorkspace 变化时通过 ref 调用。
 */
function flushPendingTreeRefresh(): void {
  if (fsRefreshTimer === null && pendingFsEventPaths.size === 0) return;
  if (fsRefreshTimer !== null) {
    clearTimeout(fsRefreshTimer);
    fsRefreshTimer = null;
  }
  if (!props.rootPath) return;
  const paths = Array.from(pendingFsEventPaths);
  pendingFsEventPaths.clear();
  if (paths.length === 0) return;
  for (const path of refreshTargetsForPaths(paths)) {
    void loadChildren(path, { silent: true });
  }
}

/**
 * 切回激活钩子:在 workspace 切回时由父组件调。不等 forceFlush/fsEvent,
 * 直接同步重读根目录和所有展开节点——这些是用户切换 tab 时实际可见的
 * 状态,必须立即更新,否则 explorer 会停留在切走时的旧树直到 180ms
 * 防抖窗口结束。forceFlush 触发的 fsEvent 后续会被 watch(fsEvent) 接
 * 住,180ms 防抖自然合并再次重读,重复的 loadChildren 由 inFlightLoads
 * 配合 scheduled dedup 吃掉。
 */
function activate(): void {
  // 清掉 pending 防抖 timer,flush 现有 pending 队列
  flushPendingTreeRefresh();
  if (!props.rootPath) return;
  // 主动重读根+展开节点(inFlightLoads 自身 dedup 同 path 同 tick 的
  // 重复 invoke,展开节点遍历是 O(展开数),正常用户 < 20 个)
  void loadChildren(props.rootPath, { silent: true });
  for (const dir of expanded) {
    if (dir === props.rootPath) continue;
    const state = nodes[dir];
    if (state?.status === "loaded") {
      void loadChildren(dir, { silent: true });
    }
  }
}

function scheduleTreeRefresh(event: WorkspaceFsChangedEvent) {
  if (!props.rootPath) return;
  for (const path of event.paths.length > 0 ? event.paths : [props.rootPath]) {
    pendingFsEventPaths.add(path);
  }
  if (fsRefreshTimer) clearTimeout(fsRefreshTimer);
  fsRefreshTimer = setTimeout(() => {
    fsRefreshTimer = null;
    if (!props.rootPath) return;
    const paths = Array.from(pendingFsEventPaths);
    pendingFsEventPaths.clear();
    for (const path of refreshTargetsForPaths(paths)) {
      void loadChildren(path, { silent: true });
    }
  }, 180);
}

function toggleDir(path: string) {
  const isOpen = expanded.has(path);
  if (isOpen) expanded.delete(path);
  else expanded.add(path);
  rebuildTreeSnapshot();
  if (!isOpen && (!nodes[path] || nodes[path].status === "error")) {
    void loadChildren(path);
  }
}

function handleEntryClick(row: EntryRow, event?: MouseEvent) {
  if (renaming.value) return;
  // 修饰键点击只改变选择集，不打开文件 / 不展开目录。
  if (event?.shiftKey) {
    selectRange(row.path);
    return;
  }
  if (event?.ctrlKey || event?.metaKey) {
    toggleSelection(row.path);
    return;
  }
  selectOnly(row.path);
  if (row.isDir) {
    toggleDir(row.path);
    return;
  }
  emit("openFile", row.path, false);
}

function beginCreate(parentPath: string | null, kind: "file" | "dir") {
  if (!parentPath) return;
  closeMenu();
  renaming.value = null;
  pendingCreate.value = { parentPath, kind };
  if (props.rootPath && parentPath !== props.rootPath) {
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
    await createFileTreeEntry(wsCtx.wsNative, path, pending.kind);
    await loadChildren(pending.parentPath);
  } finally {
    pendingCreate.value = null;
    rebuildTreeSnapshot();
  }
}

function beginRename(path: string) {
  closeMenu();
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
  const parent = dirname(from);
  const oldName = basename(from);
  if (!trimmed || trimmed === oldName) {
    renaming.value = null;
    rebuildTreeSnapshot();
    return;
  }
  const to = joinPath(parent, trimmed);
  try {
    await renameFileTreePath(wsCtx.wsNative, from, to);
    emit("pathRenamed", from, to);
    selectOnly(to);
    await loadChildren(parent);
  } finally {
    renaming.value = null;
    rebuildTreeSnapshot();
  }
}

// 批量删除：深路径优先（先删子项再删父目录），单项失败不阻断其余项；
// 全部完成后只刷新仍然存在的父目录。
async function deletePaths(paths: string[]) {
  const ordered = Array.from(new Set(paths)).sort((a, b) => b.length - a.length);
  const deleted: string[] = [];
  for (const path of ordered) {
    try {
      await deleteFileTreePath(wsCtx.wsNative, path);
      deleted.push(path);
      emit("pathDeleted", path);
    } catch (error) {
      notifyError(t("explorer.deleteFailed"), error);
    }
  }
  if (deleted.length === 0) return;

  const isGone = (path: string) =>
    deleted.some((gone) => path === gone || path.startsWith(`${gone}/`));
  const remaining = new Set(
    Array.from(selectedPaths.value).filter((path) => !isGone(path)),
  );
  selectedPaths.value = remaining;
  if (focusedPath.value && isGone(focusedPath.value)) focusedPath.value = null;
  if (anchorPath.value && isGone(anchorPath.value)) anchorPath.value = null;

  const parents = Array.from(new Set(deleted.map((path) => dirname(path)))).filter(
    (parent) => !isGone(parent),
  );
  await Promise.all(parents.map((parent) => loadChildren(parent)));
}

async function duplicatePath(path: string) {
  let target = generateCopyTarget(path);
  // If the candidate collides, walk the counter series to find a free
  // name. fs_copy rejects "already exists" so we keep the user's intent
  // ("give me a copy with a unique name") even when several copies exist.
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await copyFileTreePath(wsCtx.wsNative, path, target);
      emit("pathDuplicated", path, target);
      await loadChildren(dirname(path));
      return;
    } catch (error) {
      const message = typeof error === "string" ? error : String(error);
      if (!message.toLowerCase().includes("already exists")) throw error;
      const base = generateCopyTarget(path);
      const dot = base.lastIndexOf(".");
      const parent = base.slice(0, base.lastIndexOf("/") + 1);
      const stem = dot > 0 ? base.slice(parent.length, dot) : base.slice(parent.length);
      const ext = dot > 0 ? base.slice(dot) : "";
      const next = attempt + 2;
      target = `${parent}${stem.replace(/ copy( \d+)?$/, "")} copy ${next}${ext}`;
    }
  }
}

function handleRowContext(payload: { row: MenuRow; x: number; y: number }) {
  const path = payload.row.path;
  // 右键未选中的行：选择集收敛为该行；右键已选中的行：保留整批多选。
  if (!selectedPaths.value.has(path)) selectOnly(path);
  const ordered = orderedSelectedPaths();
  const paths = ordered.includes(path) ? ordered : [path];
  menu.value = {
    path,
    name: payload.row.name,
    isDir: payload.row.isDir,
    paths,
    x: payload.x,
    y: payload.y,
    source: "row",
  };
}

function openRootMenu(event: MouseEvent) {
  if (!props.rootPath) return;
  menu.value = {
    path: props.rootPath,
    name: rootName.value || props.rootPath,
    isDir: true,
    paths: [],
    x: event.clientX,
    y: event.clientY,
    source: "root",
  };
}

function closeMenu() {
  menu.value = null;
}

// ── 搬运编排（拖拽 / 剪贴板 / OS 拖入共用同一入口）──────────────────
//
// 三条入口的差异只在"什么时候触发"，计划解析、冲突征询、执行、刷新
// 全在这里，因此不会出现"拖拽能搬、粘贴不能搬"的行为分叉。

type PendingTransfer = {
  sources: string[];
  targetDir: string;
  mode: TransferMode;
};

const transferBusy = ref(false);
const pendingConflict = ref<ConflictRequest | null>(null);
let pendingTransfer: PendingTransfer | null = null;

/** 已加载目录的条目名集合；未加载时返回 null（表示"判不了"）。 */
function loadedEntryNames(dir: string): Set<string> | null {
  const state = nodes[dir];
  if (state?.status !== "loaded") return null;
  return new Set(state.entries.map((entry) => entry.name));
}

/**
 * 目标是否已存在。只看已加载的目录 —— 未加载时按"不冲突"处理，让后端
 * 自己的冲突判定兼底（它的 rename 策略同样不会丢数据）。这样避免为了
 * 一次拖拽先把整条路径上的目录都拉起来。
 */
function transferTargetExists(path: string): boolean {
  const names = loadedEntryNames(dirname(path));
  return names ? names.has(basename(path)) : false;
}

/** 源是否为目录（用于冲突对话框的"覆盖会递归删除"提示）。 */
function transferSourceIsDir(path: string): boolean {
  const state = nodes[dirname(path)];
  if (state?.status !== "loaded") return false;
  const name = basename(path);
  return state.entries.some((entry) => entry.name === name && entry.kind === "dir");
}

function buildTransferPlan(
  pending: PendingTransfer,
  policy: PlanPolicy,
) {
  return planTransfer({
    sources: pending.sources,
    targetDir: pending.targetDir,
    mode: pending.mode,
    policy,
    exists: transferTargetExists,
    isDir: transferSourceIsDir,
  });
}

// 严格版的 `t`（key 必须是 MessageKey 字面量）能接住这个联合：
// 把拒绝原因映射到文案，拼错 key 会在编译期暴露。
const REJECTION_MESSAGE: Record<RejectReason, MessageKey> = {
  self: "explorer.transferRejectedSelf",
  "own-subtree": "explorer.transferRejectedSubtree",
  "same-directory": "explorer.transferRejectedSameDir",
  "missing-source": "explorer.transferRejected",
};

function reportRejections(rejected: Array<{ from: string; reason: RejectReason }>): void {
  if (rejected.length === 0) return;
  // 单一原因时给出具体说法（“不能把文件夹移动到自己的子目录里”）比
  // “3 个项目无法移动”有用得多；原因混杂时退回到通用标题。
  const reasons = Array.from(new Set(rejected.map((entry) => entry.reason)));
  const title =
    reasons.length === 1
      ? t(REJECTION_MESSAGE[reasons[0]!])
      : t("explorer.transferRejected");
  notifyInfo(title, describeRejections(rejected));
}

/**
 * 搬运入口。拖拽、粘贴、OS 拖入都调它。
 *
 * 有同名冲突时先弹对话框拿到策略，再真正执行 —— 覆盖不可逆，而多选拖拽
 * 很容易撞名，默认策略必须是安全的“全部改名”。
 */
async function runTransfer(
  sources: readonly string[],
  targetDir: string,
  mode: TransferMode,
): Promise<void> {
  if (!props.rootPath || transferBusy.value || sources.length === 0) return;
  const pending: PendingTransfer = { sources: [...sources], targetDir, mode };
  const probe = buildTransferPlan(pending, "detect");
  reportRejections(probe.rejected);
  if (probe.items.length === 0) return;
  if (probe.conflicts.length > 0) {
    pendingTransfer = pending;
    pendingConflict.value = {
      targetDir,
      conflicts: probe.conflicts,
      dirCount: probe.conflicts.filter((conflict) => conflict.isDir).length,
    };
    return;
  }
  await executeTransfer(pending, "rename");
}

function onConflictResolved(policy: FsConflictPolicy): void {
  const pending = pendingTransfer;
  pendingTransfer = null;
  pendingConflict.value = null;
  if (pending) void executeTransfer(pending, policy);
}

function onConflictCanceled(): void {
  pendingTransfer = null;
  pendingConflict.value = null;
}

async function executeTransfer(
  pending: PendingTransfer,
  policy: FsConflictPolicy,
): Promise<void> {
  const plan = buildTransferPlan(pending, policy);
  if (plan.items.length === 0) return;
  transferBusy.value = true;
  try {
    const result =
      pending.mode === "move"
        ? await wsCtx.wsNative.fsMoveMany(plan.items, policy)
        : await wsCtx.wsNative.fsCopyMany(plan.items, policy);
    reportTransferResult(result, pending.mode);
    await settleAfterTransfer(result, pending);
  } catch (error) {
    notifyError(t("explorer.transferFailed", { failed: pending.sources.length }), error);
  } finally {
    transferBusy.value = false;
  }
}

/** 逐条汇报，而不是只报成功：多选搬运经常是“一部分成功一部分失败”。 */
function reportTransferResult(result: FsTransferResult, mode: TransferMode): void {
  const summary = summarizeTransfer(result);
  if (summary.moved === 0) {
    if (summary.failed > 0) {
      notifyError(
        t("explorer.transferFailed", { failed: summary.failed }),
        result.failed[0]?.error ?? null,
      );
    } else if (summary.skipped > 0) {
      notifyInfo(
        t("explorer.transferSkipped", { skipped: summary.skipped }),
        t("explorer.conflictSkipAll"),
      );
    }
    return;
  }
  const verbKey = mode === "move" ? "explorer.transferDoneMove" : "explorer.transferDoneCopy";
  notifySuccess(t(verbKey, { count: summary.moved }));
  if (summary.skipped > 0) {
    notifyInfo(t("explorer.transferSkipped", { skipped: summary.skipped }));
  }
  if (summary.failed > 0) {
    notifyError(
      t("explorer.transferFailed", { failed: summary.failed }),
      result.failed[0]?.error ?? null,
    );
  }
  if (summary.crossDevice > 0) {
    // 跨设备移动实际是 copy + delete：中途失败会在磁盘上留下两份，
    // 必须区别提示，不能混进普通成功里。
    notifyInfo(t("explorer.transferCrossDevice", { count: summary.crossDevice }));
  }
  for (const warning of summary.warnings) {
    notifyInfo(t("explorer.transferFailed", { failed: 0 }), warning);
  }
}

/** 搬运后收尾：让已打开的 tab 跟随新路径、刷新受影响目录、展开目标目录。 */
async function settleAfterTransfer(
  result: FsTransferResult,
  pending: PendingTransfer,
): Promise<void> {
  const moved = [...result.completed, ...result.crossDevice];
  if (pending.mode === "move") {
    for (const item of moved) {
      if (item.from !== item.to) emit("pathRenamed", item.from, item.to);
    }
  }
  if (
    props.rootPath &&
    isInsideDir(pending.targetDir, props.rootPath) &&
    !expanded.has(pending.targetDir)
  ) {
    // 展开目标目录：搬运完成后直接看到结果，否则用户得自己展开找。
    expanded.add(pending.targetDir);
    rebuildTreeSnapshot();
  }
  const dirs = new Set<string>();
  for (const item of [...moved, ...result.skipped]) {
    dirs.add(dirname(item.from));
    dirs.add(dirname(item.to));
  }
  for (const dir of dirs) {
    // 只刷新工作区内的目录：OS 拖入的源路径在磁盘任意位置，`dirname` 算
    // 出来的父目录可能根本不在树里，刷新它只会白白发一次读请求。
    if (props.rootPath && isInsideDir(dir, props.rootPath)) {
      void loadChildren(dir, { silent: true });
    }
  }
}

// ── 从操作系统拖文件进窗口 ───────────────────────────────────────
//
// 走 Tauri 的 drag-drop 事件通道（Tauri v2 默认 dragDropEnabled: true，
// 系统拖拽由 Tauri 拦截后广播给 webview），与树内指针拖拽共存。
//
// 一律当**复制**：从 Finder / 资源管理器拖进来永远不会删掉源文件，这与
// Finder / VS Code / 资源管理器本身的行为一致。

let unlistenOsDrag: (() => void) | null = null;

function handleOsDragEvent(event: OsFileDragEvent): void {
  if (dragDisabled() || !props.rootPath) {
    if (event.kind !== "leave") clearOsDropTarget();
    return;
  }
  if (event.kind === "leave") {
    clearOsDropTarget();
    return;
  }
  const hit = document.elementFromPoint(event.position.x, event.position.y);
  if (!hit) {
    clearOsDropTarget();
    return;
  }
  const row = hit.closest<HTMLElement>("[data-explorer-row-path]");
  let target: string | null = null;
  if (row) {
    target = row.dataset.isDir === "true" ? row.dataset.explorerRowPath ?? null : null;
  } else if (hit.closest("[data-explorer-drop-root]")) {
    target = props.rootPath;
  }
  if (!target) {
    clearOsDropTarget();
    return;
  }
  if (event.kind === "drop") {
    clearOsDropTarget();
    // 可行性在 drop 时才能算（Tauri 只在 drop 事件里给 paths），所以
    // over 阶段只做高亮；非法落点由 runTransfer 的守卫拒绝并提示。
    void runTransfer(event.paths, target, "copy");
    return;
  }
  dropTargetDir.value = target;
  dropAllowed.value = true;
}

function clearOsDropTarget(): void {
  dropTargetDir.value = null;
  dropAllowed.value = false;
}

// ── 文件树拖拽搬运 ───────────────────────────────────────────────────
//
// 手势用 `usePointerDragReorder`（与标签重排、工作区重排同一份实现）：阈值
// 判定 / ghost / click 抑制 / window 监听成对移除都不在这里重写。
//
// 交互按 VS Code 习惯：
// - 默认**移动**，按住 Alt（或 Ctrl）拖时变**复制**，ghost 文案实时跟着变；
// - 拖拽源 = 当前多选集（拖其中一行就拖走整批），未选中则只拖该行；
// - 落点是**目录**（或树的空白区 = 工作区根），不是文件；
// - 悬停目录 600ms 自动展开，拖到边缘自动滚动。
// drop-between（带缩进的插入线）是另一个独立交互，不与本阶段混在一起。

type DragGhost = { path: string; count: number; names: string[] };

/** 拖拽中的源集（多选时是整批）。ghost / 落点判定 / 执行都读它。 */
const dragSources = ref<readonly string[]>([]);
/** 移动 / 复制随修饰键实时切换。 */
const dragMode = ref<TransferMode>("move");
/** 当前落点目录；null 表示无落点。 */
const dropTargetDir = ref<string | null>(null);
const dropAllowed = ref(false);

/** 拖拽不可用（无根目录 / 搜索模式 / 内联重命名中 / 上一次搬运未结束）。 */
function dragDisabled(): boolean {
  if (!props.rootPath || transferBusy.value) return true;
  if (renaming.value || pendingCreate.value) return true;
  // 搜索与内容搜索模式下没有可拖的树行。
  return isSearchOpen.value || isSearchActive.value || mode.value !== "files";
}

/** 命中测试：目录行 = 放入该目录；树的空白区 = 放入工作区根。文件行不接收。 */
function treeDropTarget(clientX: number, clientY: number) {
  const hit = document.elementFromPoint(clientX, clientY);
  if (!hit) return null;
  const row = hit.closest<HTMLElement>("[data-explorer-row-path]");
  if (row) {
    if (row.dataset.isDir !== "true") return null;
    const path = row.dataset.explorerRowPath;
    return path ? { id: path, el: row } : null;
  }
  // 没命中行：落在树容器内（行间缝隙、行下方空白）就当工作区根。
  const container = hit.closest<HTMLElement>("[data-explorer-drop-root]");
  if (container && props.rootPath) return { id: props.rootPath, el: container };
  return null;
}

const treeDrag = usePointerDragReorder<DragGhost, string>({
  enabled: () => !dragDisabled(),
  resolveTarget: (x, y) => treeDropTarget(x, y),
  // 本阶段只有 drop-into 语义，before/after 不参与判断；固定返回 after
  // 以避免默认的水平中线二分给出一个无意义的方向。
  placementOf: () => "after",
  resolveGhost: (path) => ({
    path,
    count: dragSources.value.length,
    names: dragSources.value.map((source) => basename(source)).slice(0, 3),
  }),
  onDraggingChange: (dragging) => {
    if (dragging) return;
    // 拖拽结束（或取消）：清掉所有拖拽态，避免 ghost / 落点高亮残留。
    dropTargetDir.value = null;
    dropAllowed.value = false;
    cancelHoverExpand();
  },
  onDrop: (sourceId, targetId) => {
    const sources = dragSources.value.length > 0 ? dragSources.value : [sourceId];
    void runTransfer(sources, targetId, dragMode.value);
  },
});

const dragGhost = treeDrag.ghost;

function onEntryPointerDown(row: EntryRow, event: PointerEvent) {
  // 拖拽源 = 多选集：拖其中一行就拖走整批（VS Code 行为）。非多选时只拖它。
  const selected = orderedSelectedPaths();
  dragSources.value =
    selected.includes(row.path) && selected.length > 1 ? selected : [row.path];
  if (event.altKey || event.ctrlKey) dragMode.value = "copy";
  // 不在这里改选择集：真正拖起来时 click 会被 consumeSuppressedClick 吃掉，
  // 而没拖起来的普通点击应当走 handleEntryClick 的原有语义。
  treeDrag.startDrag(event, row.path);
}

// 拖拽结束后紧跟的 click 要被吃掉，否则松手会先落 drop 再触发选中。
function handleEntryClickForDrag(row: EntryRow, event: MouseEvent) {
  if (treeDrag.consumeSuppressedClick(row.path)) return;
  handleEntryClick(row, event);
}

// ── 修饰键监听：Alt / Ctrl 在拖拽过程中实时切换移动与复制 ────────────
//
// 靠 keydown/keyup 而不是 pointermove 读 event.altKey：修饰键的按下会
// 产生独立的键盘事件，比在每一帧里重新取 modifier 状态可靠。
function syncDragMode(event: KeyboardEvent) {
  if (treeDrag.draggingId.value === null) return;
  dragMode.value = event.altKey || event.ctrlKey ? "copy" : "move";
}

useEventListener(window, "keydown", syncDragMode);
useEventListener(window, "keyup", syncDragMode);

watch(
  () => treeDrag.dropTarget.value?.id ?? null,
  (target) => {
    dropTargetDir.value = target;
    dropAllowed.value = target
      ? canTransferInto(dragSources.value, target, dragMode.value)
      : false;
    scheduleHoverExpand(target);
  },
);

watch(dragMode, () => {
  const target = dropTargetDir.value;
  dropAllowed.value = target
    ? canTransferInto(dragSources.value, target, dragMode.value)
    : false;
});

// ── 悬停自动展开：拖到折叠目录上停 600ms 就展开，方便长路径嵌套 ────
const HOVER_EXPAND_DELAY_MS = 600;
let hoverExpandTimer: ReturnType<typeof setTimeout> | null = null;
let hoverExpandTarget: string | null = null;

function cancelHoverExpand() {
  if (hoverExpandTimer) clearTimeout(hoverExpandTimer);
  hoverExpandTimer = null;
  hoverExpandTarget = null;
}

function scheduleHoverExpand(target: string | null) {
  cancelHoverExpand();
  if (!target || !props.rootPath) return;
  if (target === props.rootPath) return;
  if (expanded.has(target)) return;
  // 源自身与其子目录不能展开：展开后用户只会看到自己拖走的东西。
  if (dragSources.value.some((source) => isInsideDir(target, source))) return;
  hoverExpandTarget = target;
  hoverExpandTimer = setTimeout(() => {
    hoverExpandTimer = null;
    const dir = hoverExpandTarget;
    hoverExpandTarget = null;
    if (!dir) return;
    expanded.add(dir);
    rebuildTreeSnapshot();
    if (!nodes[dir] || nodes[dir]?.status === "error") void loadChildren(dir);
  }, HOVER_EXPAND_DELAY_MS);
}

// ── 边缘自动滚动：拖到容器上下边缘时持续滚动，否则大树无法拖到深处 ──
const EDGE_SCROLL_ZONE = 28;
const EDGE_SCROLL_SPEED = 12;
let edgeScrollFrame: number | null = null;

function stopEdgeScroll() {
  if (edgeScrollFrame !== null) {
    cancelAnimationFrame(edgeScrollFrame);
    edgeScrollFrame = null;
  }
}

function edgeScrollStep() {
  const ghost = dragGhost.value;
  const scroller = treeScroll.value;
  if (!ghost || !scroller) {
    stopEdgeScroll();
    return;
  }
  const rect = scroller.getBoundingClientRect();
  let delta = 0;
  if (ghost.y < rect.top + EDGE_SCROLL_ZONE) {
    delta = -EDGE_SCROLL_SPEED * (1 - (ghost.y - rect.top) / EDGE_SCROLL_ZONE);
  } else if (ghost.y > rect.bottom - EDGE_SCROLL_ZONE) {
    delta = EDGE_SCROLL_SPEED * (1 - (rect.bottom - ghost.y) / EDGE_SCROLL_ZONE);
  }
  if (delta !== 0) scroller.scrollTop += Math.max(-EDGE_SCROLL_SPEED, Math.min(EDGE_SCROLL_SPEED, delta));
  // 持续跑：指针不动时也要继续滚（虚拟滚动下还要走 onScroll 让 range 更新）。
  edgeScrollFrame = requestAnimationFrame(edgeScrollStep);
}

watch(
  dragGhost,
  (ghost) => {
    if (ghost && edgeScrollFrame === null) {
      edgeScrollFrame = requestAnimationFrame(edgeScrollStep);
    } else if (!ghost) {
      stopEdgeScroll();
    }
  },
);

// ── 行级拖拽视觉的判定（virtual / 非 virtual 两处循环共用）───────────
type AnyRow = VisibleTreeRow;

function isRowDragging(row: AnyRow): boolean {
  if (row.kind !== "entry") return false;
  return dragSources.value.includes(row.path);
}

function isRowDropTarget(row: AnyRow): boolean {
  return row.kind === "entry" && dropTargetDir.value === row.path;
}

function isRowDropForbidden(row: AnyRow): boolean {
  return (
    row.kind === "entry" &&
    dropTargetDir.value === row.path &&
    !dropAllowed.value
  );
}

/** 拖拽 ghost 文案：跟随修饰键在「移动 / 复制」之间实时切换。 */
const dragGhostLabel = computed(() => {
  const ghost = dragGhost.value;
  if (!ghost) return "";
  const verb = dragMode.value === "move"
    ? t("explorer.dragMove")
    : t("explorer.dragCopy");
  const names = ghost.item.names.join("、");
  const more = ghost.item.count > ghost.item.names.length
    ? t("explorer.dragMore", { count: ghost.item.count - ghost.item.names.length })
    : "";
  return ghost.item.count > 1
    ? `${verb} ${ghost.item.count} 项：${names}${more}`
    : `${verb} ${names}`;
});

// ── 剪贴板动作（右键菜单与 Cmd+C/X/V 共用）───────────────────────

/**
 * 粘贴落点：选中恰好一个目录就用它，否则粘到工作区根。
 *
 * 不支持"粘到文件所在目录"这种隐式落点：用户往往刚点了右键，期望粘到
 * 右键的那个目录；而选中多个项时“往哪粘”本来就没有唯一答案。
 */
function pasteTargetDir(): string | null {
  if (!props.rootPath) return null;
  const selected = orderedSelectedPaths();
  if (selected.length !== 1) return props.rootPath;
  const path = selected[0]!;
  const state = nodes[dirname(path)];
  const isDir = state?.status === "loaded"
    ? state.entries.some((entry) => entry.name === basename(path) && entry.kind === "dir")
    : false;
  return isDir ? path : props.rootPath;
}

function copySelectionToClipboard(): void {
  const paths = orderedSelectedPaths();
  if (paths.length > 0) clipboard.setCopy(paths);
}

function cutSelectionToClipboard(): void {
  const paths = orderedSelectedPaths();
  if (paths.length > 0) clipboard.setCut(paths);
}

async function pasteFromClipboard(): Promise<void> {
  const state = clipboard.state.value;
  const target = pasteTargetDir();
  if (!target || state.paths.length === 0) return;
  const mode: TransferMode = state.mode === "cut" ? "move" : "copy";
  await runTransfer(state.paths, target, mode);
  // 剪切是一次性的：粘贴完成后剪贴板失效，避免重复剪切引发意外搬运。
  if (state.mode === "cut") clipboard.clear();
}

function openTerminalInDir(path: string) {
  closeMenu();
  emit("openInTerminal", path);
}

function moveSelection(index: number, extend = false) {
  const paths = entryPaths.value;
  if (paths.length === 0) return;
  const clamped = Math.max(0, Math.min(paths.length - 1, index));
  if (extend) selectRange(paths[clamped]);
  else selectOnly(paths[clamped]);
}

function handleKeydown(event: KeyboardEvent) {
  if (renaming.value || pendingCreate.value || isSearchOpen.value) return;
  const target = event.target as HTMLElement | null;
  if (
    target?.tagName === "INPUT" ||
    target?.tagName === "TEXTAREA" ||
    target?.isContentEditable
  ) {
    return;
  }

  const paths = entryPaths.value;
  if (paths.length === 0) return;

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
    event.preventDefault();
    selectAll();
    return;
  }

  // 文件树内的 Cmd+C / Cmd+X / Cmd+V 走文件剪贴板，不与文本剪贴板混用。
  // 选中集为空时不接管：用户很可能是在编辑筛选框或只是没选中任何东西。
  const mod = event.ctrlKey || event.metaKey;
  if (mod) {
    const key = event.key.toLowerCase();
    if (key === "c" && selectedPaths.value.size > 0) {
      event.preventDefault();
      copySelectionToClipboard();
      return;
    }
    if (key === "x" && selectedPaths.value.size > 0) {
      event.preventDefault();
      cutSelectionToClipboard();
      return;
    }
    if (key === "v" && !clipboard.isEmpty.value) {
      event.preventDefault();
      void pasteFromClipboard();
      return;
    }
  }

  const currentIdx = focusedPath.value ? paths.indexOf(focusedPath.value) : -1;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveSelection(currentIdx < 0 ? 0 : currentIdx + 1, event.shiftKey);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveSelection(currentIdx < 0 ? paths.length - 1 : currentIdx - 1, event.shiftKey);
  } else if (event.key === "ArrowRight") {
    if (currentIdx < 0) return;
    event.preventDefault();
    const row = rows.value[entryIndexByPath.value.get(paths[currentIdx]) ?? -1];
    if (row?.kind !== "entry" || !row.isDir) return;
    if (!row.isExpanded) toggleDir(row.path);
    else moveSelection(currentIdx + 1);
  } else if (event.key === "ArrowLeft") {
    if (currentIdx < 0) return;
    event.preventDefault();
    const row = rows.value[entryIndexByPath.value.get(paths[currentIdx]) ?? -1];
    if (row?.kind !== "entry") return;
    if (row.isDir && row.isExpanded) {
      toggleDir(row.path);
      return;
    }
    const parent = dirname(row.path);
    if (parent && parent !== props.rootPath && entryIndexByPath.value.has(parent)) {
      selectOnly(parent);
    }
  } else if (event.key === "Enter") {
    if (currentIdx < 0) return;
    event.preventDefault();
    const row = rows.value[entryIndexByPath.value.get(paths[currentIdx]) ?? -1];
    if (row?.kind !== "entry") return;
    if (row.isDir) toggleDir(row.path);
    else emit("openFile", row.path, false);
  }
}

watch(
  () => props.rootPath,
  (rootPath) => {
    clearScheduledTreeRefresh();
    Object.keys(nodes).forEach((k) => delete nodes[k]);
    expanded.clear();
    pendingCreate.value = null;
    renaming.value = null;
    selectOnly(null);
    isSearchOpen.value = false;
    isSearchActive.value = false;
    closeMenu();
    rebuildTreeSnapshot();
    if (rootPath) void loadChildren(rootPath);
  },
  { immediate: true },
);

watch(
  () => prefs.showHidden,
  () => {
    if (!props.rootPath) return;
    const loadedPaths = Object.entries(nodes)
      .filter(([, state]) => state.status === "loaded")
      .map(([path]) => path);
    for (const path of loadedPaths.length > 0 ? loadedPaths : [props.rootPath]) {
      void loadChildren(path);
    }
  },
);

watch(
  () => props.fsEvent,
  (event) => {
    if (!event || !isSameRoot(event.rootPath, props.rootPath)) return;
    scheduleTreeRefresh(event);
  },
);

// When the git decoration map changes, the only rows that need to be
// recomputed are the ones currently visible in the tree. Walking every
// expanded subtree from scratch on every `git status` refresh used to
// take seconds on large monorepos because the rebuild re-iterated
// every loaded directory. The incremental patch only re-walks the
// currently-expanded subtrees, leaving collapsed directories for when
// they are next opened.
watch(() => props.gitDecorations, () => {
  const visible = visibleDirectoryPaths();
  if (visible.length === 0) return;
  patchTreeSnapshot(visible);
});

// 行集合变化（目录折叠、刷新、重命名中）后剔除已不可见的选中项，
// 避免选择集里残留"幽灵路径"参与批量删除。
watch(rows, () => {
  const index = entryIndexByPath.value;
  const selected = selectedPaths.value;
  if (selected.size > 0) {
    const next = new Set<string>();
    for (const path of selected) {
      if (index.has(path)) next.add(path);
    }
    if (next.size !== selected.size) selectedPaths.value = next;
  }
  if (focusedPath.value && !index.has(focusedPath.value)) focusedPath.value = null;
  if (anchorPath.value && !index.has(anchorPath.value)) anchorPath.value = null;
});

onBeforeUnmount(() => {
  clearScheduledTreeRefresh();
  stopEdgeScroll();
  cancelHoverExpand();
  unlistenOsDrag?.();
  unlistenOsDrag = null;
});

// OS 拖入订阅挂在组件生命周期上：文件树在每个工作区各一份，每份都订阅
// 同一个全局事件，落点靠自己的命中判定区分。卸载时必须退订，否则工作区
// 关掉后仍在处理拖拽事件。
if (hasTauriInternals()) {
  void onOsFileDragDrop(handleOsDragEvent)
    .then((unlisten) => {
      unlistenOsDrag = unlisten;
    })
    .catch((error) => {
      // 不支持 drag-drop 的平台（如部分 Wayland 组合）会在这里失败：
      // 静默降级为“不支持拖入”，而不是让整棵文件树挂掉。
      console.warn("[explorer] OS file drag & drop unavailable:", error);
    });
}

function setMode(next: "files" | "content") {
  mode.value = next;
  isSearchOpen.value = false;
}

defineExpose({
  setMode,
  /**
   * 搬运入口。拖拽、剪贴板粘贴、OS 文件拖入都走它，保证三条入口的
   * 冲突征询与结果汇报完全一致。
   */
  runTransfer,
  /** 搬运进行中（用于禁用重复提交与展示 busy 态）。 */
  isTransferring: () => transferBusy.value,
  /**
   * 同步 flush 待执行的 tree refresh(取消 180ms 防抖)。
   * 父组件在 workspace 切回时调,保证切回 explorer 立即是最新状态。
   * 切走 / 卸载时无需调 — clearScheduledTreeRefresh 已在 onBeforeUnmount
   * 路径上跑。
   */
  flushPendingTreeRefresh,
  /**
   * 切回激活:主动重读根+展开节点,不依赖 fsEvent 是否到达。
   * 父组件(WorkspaceHost)切回时调,保证切回 explorer 立刻是最新状态。
   */
  activate,
});
</script>

<template>
  <aside
    data-file-explorer
    class="flex h-full w-full min-h-0 flex-col bg-transparent text-foreground outline-none"
    tabindex="0"
    @keydown="handleKeydown"
  >
    <div
      class="nexterm-toolbar flex h-8 shrink-0 items-center gap-1 px-2"
      data-explorer-header
    >
      <div class="flex min-w-0 flex-1 items-center gap-1.5" :title="rootPath || undefined">
        <img
          v-if="rootPath"
          :src="folderIconUrl(rootName, false)"
          alt=""
          data-explorer-root-icon
          class="size-4 shrink-0"
        />
        <NIcon
          v-else
          :component="FolderOutline"
          :size="14"
          class="shrink-0 text-muted-foreground"
        />
        <span class="truncate text-[12px] font-medium text-foreground/85">
          {{ rootName || t("common.explorer") }}
        </span>
      </div>
      <TooltipTitle :label="t('explorer.searchFilesTitle')">
        <NButton
          size="tiny"
          quaternary
          data-toggle-search
          :aria-label="t('explorer.searchFilesTitle')"
          :disabled="!rootPath"
          @click="isSearchOpen = !isSearchOpen; mode = 'files'"
        >
          <template #icon><NIcon :component="SearchOutline" /></template>
        </NButton>
      </TooltipTitle>
      <TooltipTitle :label="t('findInFiles.searchPlaceholder')">
        <NButton
          size="tiny"
          quaternary
          data-toggle-content-search
          :aria-label="t('findInFiles.searchPlaceholder')"
          :disabled="!rootPath"
          :class="mode === 'content' ? 'bg-accent text-foreground' : ''"
          @click="mode = mode === 'content' ? 'files' : 'content'; isSearchOpen = false"
        >
          <template #icon><NIcon :component="SearchOutline" /></template>
        </NButton>
      </TooltipTitle>
      <TooltipTitle :label="t('explorer.newFile')">
        <NButton
          size="tiny"
          quaternary
          data-new-file
          :aria-label="t('explorer.newFile')"
          :disabled="!rootPath"
          @click="beginCreate(rootPath, 'file')"
        >
          <template #icon><NIcon :component="DocumentOutline" /></template>
        </NButton>
      </TooltipTitle>
      <TooltipTitle :label="t('explorer.newFolder')">
        <NButton
          size="tiny"
          quaternary
          data-new-folder
          :aria-label="t('explorer.newFolder')"
          :disabled="!rootPath"
          @click="beginCreate(rootPath, 'dir')"
        >
          <template #icon><NIcon :component="FolderOutline" /></template>
        </NButton>
      </TooltipTitle>
      <TooltipTitle :label="t('common.refresh')">
        <NButton
          size="tiny"
          quaternary
          :aria-label="t('common.refresh')"
          :disabled="!rootPath"
          @click="refreshPath()"
        >
          <template #icon><NIcon :component="RefreshOutline" /></template>
        </NButton>
      </TooltipTitle>
    </div>

    <div v-if="!rootPath" class="grid min-h-0 flex-1 place-items-center p-4 text-center">
      <div class="text-[12px] text-muted-foreground">
        {{ t("common.noCurrentDirectory") }}
      </div>
    </div>

    <template v-else>
      <ExplorerSearch
        v-if="mode === 'files'"
        :root-path="rootPath"
        :open="isSearchOpen"
        @request-close="isSearchOpen = false"
        @active-change="(active) => (isSearchActive = active)"
        @open-file="(path, pin) => emit('openFile', path, pin)"
      />

      <FindInFilesPanel
        v-else
        :root-path="rootPath"
        @open-result="(path, line) => emit('openSearchResult', path, line)"
      />

      <div
        v-show="!isSearchActive && mode === 'files'"
        ref="treeScroll"
        data-explorer-drop-root
        class="min-h-0 flex-1 overflow-y-auto py-1"
        @scroll.passive="onTreeScroll"
        @contextmenu.prevent="openRootMenu"
      >
        <FileTreeRow
          v-if="pendingAtRoot"
          :row="pendingAtRoot"
          :selected="false"
          @commit-create="commitCreate"
          @cancel-create="cancelCreate"
        />

        <div
          v-if="rootState?.status === 'loading'"
          class="px-1.5 py-1"
          aria-busy="true"
        >
          <div
            v-for="n in 10"
            :key="n"
            class="v2-skeleton m-0.5 h-6 w-full"
            :style="{ opacity: 1 - n * 0.06 }"
          />
        </div>
        <div
          v-else-if="rootState?.status === 'error'"
          class="px-3 py-2 text-[11px] text-destructive"
        >
          {{ rootState.message }}
        </div>
        <div v-else-if="rootState?.status === 'loaded'">
          <!--
            视口窗口化：大仓（5k+ 文件）一次性 v-for 所有行会让 mount + 滚动
            都掉到个位数 FPS。这里对 entry / status 行按 24px 定高做切片渲染：
            顶部 spacer + 可见行 + 底部 spacer。pending / rename 含内联输入框
            单独渲染以保留焦点（行高可能略大于 24px）。
          -->
          <div
            v-if="rows.length > VIRTUAL_THRESHOLD"
            class="relative px-1"
          >
            <div
              :style="{ height: `${virtualTopPadding}px` }"
              aria-hidden="true"
            />
            <FileTreeRow
              v-for="row in virtualRows"
              :key="row.key"
              :row="row"
              :selected="row.kind !== 'status' && row.kind !== 'pending' && selectedPaths.has(row.path)"
              :dragging="isRowDragging(row)"
              :drop-target="isRowDropTarget(row)"
              :drop-forbidden="isRowDropForbidden(row)"
              @entry-click="handleEntryClickForDrag"
              @entry-pointer-down="onEntryPointerDown"
              @begin-rename="beginRename"
              @commit-rename="commitRename"
              @cancel-rename="cancelRename"
              @commit-create="commitCreate"
              @cancel-create="cancelCreate"
              @row-context="handleRowContext"
            />
            <div
              :style="{ height: `${virtualBottomPadding}px` }"
              aria-hidden="true"
            />
          </div>
          <div v-else class="space-y-0.5 px-1">
            <FileTreeRow
              v-for="row in rows"
              :key="row.key"
              :row="row"
              :selected="row.kind !== 'status' && row.kind !== 'pending' && selectedPaths.has(row.path)"
              :dragging="isRowDragging(row)"
              :drop-target="isRowDropTarget(row)"
              :drop-forbidden="isRowDropForbidden(row)"
              @entry-click="handleEntryClickForDrag"
              @entry-pointer-down="onEntryPointerDown"
              @begin-rename="beginRename"
              @commit-rename="commitRename"
              @cancel-rename="cancelRename"
              @commit-create="commitCreate"
              @cancel-create="cancelCreate"
              @row-context="handleRowContext"
            />
          </div>
        </div>
      </div>
    </template>

    <FileTransferConflictDialog
      :request="pendingConflict"
      @resolve="onConflictResolved"
      @cancel="onConflictCanceled"
    />

    <!--
      拖拽 ghost：跟随指针的胶囊，文案实时反映“移动/复制 N 项”。
      pointer-events-none：ghost 不能挡住下面的行，否则 elementFromPoint
      会命中它自己导致落点抖动。
    -->
    <div
      v-if="dragGhost"
      data-explorer-drag-ghost
      class="v2-glass-float pointer-events-none fixed z-50 flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] opacity-95"
      :class="dropAllowed ? '' : 'text-destructive'"
      :style="{
        transform: `translate3d(${dragGhost.x}px, ${dragGhost.y}px, 0) translate(-50%, -140%)`,
      }"
    >
      <NIcon
        :component="dragMode === 'move' ? MoveOutline : CopyOutline"
        :size="12"
      />
      <span class="max-w-56 truncate">{{ dragGhostLabel }}</span>
    </div>

    <ExplorerContextMenu
      :target="menu"
      :root-path="rootPath"
      @close="closeMenu"
      @open-file="(path, pin) => emit('openFile', path, pin)"
      @open-markdown-preview="(path) => emit('openMarkdownPreview', path)"
      @open-file-preview="(path) => emit('openFilePreview', path)"
      @open-in-terminal="openTerminalInDir"
      @duplicate="duplicatePath"
      @copy="copySelectionToClipboard"
      @cut="cutSelectionToClipboard"
      @paste="pasteFromClipboard"
      :can-paste="!clipboard.isEmpty.value"
      @create="beginCreate"
      @rename="beginRename"
      @delete-paths="deletePaths"
    />
  </aside>
</template>
