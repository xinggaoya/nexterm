<script setup lang="ts">
import {
  DocumentOutline,
  FolderOutline,
  RefreshOutline,
  SearchOutline,
} from "@vicons/ionicons5";
import { NButton, NIcon } from "naive-ui";
import { computed, onBeforeUnmount, reactive, ref, shallowRef, watch } from "vue";
import TooltipTitle from "@/components/TooltipTitle.vue";
import { t } from "@/modules/i18n/translate";
import { useWorkspaceContext } from "@/app/workspaceContext";
import type { WorkspaceFsChangedEvent } from "@/lib/native";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import { isSameWorkspaceRoot, normalizeWorkspacePath } from "@/modules/workspace";
import type { GitDecorationMap } from "@/modules/source-control";
import ExplorerContextMenu, {
  type ExplorerContextMenuTarget,
} from "./ExplorerContextMenu.vue";
import ExplorerSearch from "./ExplorerSearch.vue";
import { FindInFilesPanel } from "@/modules/search";
import FileTreeRow from "./FileTreeRow.vue";
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
} from "./lib/fileTreeService";
import { folderIconUrl } from "./lib/iconResolver";

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
const selectedPath = ref<string | null>(null);
const isSearchOpen = ref(false);
const isSearchActive = ref(false);
const mode = ref<"files" | "content">("files");
const menu = ref<ExplorerContextMenuTarget | null>(null);
let fsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
const pendingFsEventPaths = new Set<string>();
const inFlightLoads = new Map<string, InFlightLoad>();

// ── Virtual scroll window ──────────────────────────────────────────────
// FileTreeRow 定高 24px（template h-6）。窗口化只对 entry / status 行生效；
// pending / rename 含内联输入框，仍全量渲染以保留焦点。行数少于阈值时
// 直接走 v-for，避免给小树引入无谓的 scroll 计算。
const VIRTUAL_THRESHOLD = 200;
const ROW_HEIGHT = 24;
const VIRTUAL_OVERSCAN = 6;
const treeScroll = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportHeight = ref(0);
let viewportRO: ResizeObserver | null = null;

const virtualRange = computed(() => {
  const total = rows.value.length;
  if (total === 0) return { start: 0, end: 0 };
  const visibleStart = Math.floor(scrollTop.value / ROW_HEIGHT) - VIRTUAL_OVERSCAN;
  const visibleRows = Math.ceil(viewportHeight.value / ROW_HEIGHT) + VIRTUAL_OVERSCAN * 2;
  const start = Math.max(0, visibleStart);
  const end = Math.min(total, start + visibleRows);
  return { start, end };
});

const virtualRows = computed(() => {
  const { start, end } = virtualRange.value;
  return rows.value.slice(start, end);
});
const virtualTopPadding = computed(() => virtualRange.value.start * ROW_HEIGHT);
const virtualBottomPadding = computed(() => {
  const total = rows.value.length;
  const { end } = virtualRange.value;
  return Math.max(0, (total - end) * ROW_HEIGHT);
});

function onTreeScroll(event: Event) {
  scrollTop.value = (event.target as HTMLElement).scrollTop;
  closeMenu();
}

watch(
  treeScroll,
  (el, prev) => {
    if (prev) viewportRO?.unobserve(prev);
    viewportRO?.disconnect();
    viewportRO = null;
    if (el && typeof ResizeObserver === "function") {
      viewportRO = new ResizeObserver((entries) => {
        for (const entry of entries) {
          viewportHeight.value = entry.contentRect.height;
        }
      });
      viewportRO.observe(el);
      viewportHeight.value = el.clientHeight;
    }
  },
  { flush: "post" },
);

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

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function normalizeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
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
    nodes[path] = { status: "error", message: normalizeError(error) };
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

function handleEntryClick(row: EntryRow) {
  if (renaming.value) return;
  selectedPath.value = row.path;
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
    selectedPath.value = to;
    await loadChildren(parent);
  } finally {
    renaming.value = null;
    rebuildTreeSnapshot();
  }
}

async function deletePath(path: string) {
  await deleteFileTreePath(wsCtx.wsNative, path);
  emit("pathDeleted", path);
  if (selectedPath.value === path || selectedPath.value?.startsWith(`${path}/`)) {
    selectedPath.value = null;
  }
  await loadChildren(dirname(path));
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
  selectedPath.value = payload.row.path;
  menu.value = {
    path: payload.row.path,
    name: payload.row.name,
    isDir: payload.row.isDir,
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
    x: event.clientX,
    y: event.clientY,
    source: "root",
  };
}

function closeMenu() {
  menu.value = null;
}

function openTerminalInDir(path: string) {
  closeMenu();
  emit("openInTerminal", path);
}

function moveSelection(index: number) {
  const paths = entryPaths.value;
  if (paths.length === 0) return;
  const clamped = Math.max(0, Math.min(paths.length - 1, index));
  selectedPath.value = paths[clamped];
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
  const currentIdx = selectedPath.value
    ? paths.indexOf(selectedPath.value)
    : -1;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveSelection(currentIdx < 0 ? 0 : currentIdx + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveSelection(currentIdx < 0 ? paths.length - 1 : currentIdx - 1);
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
      selectedPath.value = parent;
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
    selectedPath.value = null;
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

watch(rows, () => {
  if (selectedPath.value && !entryIndexByPath.value.has(selectedPath.value)) {
    selectedPath.value = null;
  }
});

onBeforeUnmount(() => {
  clearScheduledTreeRefresh();
  viewportRO?.disconnect();
  viewportRO = null;
});

function setMode(next: "files" | "content") {
  mode.value = next;
  if (next === "files") {
    isSearchOpen.value = false;
  } else {
    isSearchOpen.value = false;
  }
}

defineExpose({
  setMode,
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
              :selected="row.kind !== 'status' && row.kind !== 'pending' && selectedPath === row.path"
              @entry-click="handleEntryClick"
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
              :selected="row.kind !== 'status' && row.kind !== 'pending' && selectedPath === row.path"
              @entry-click="handleEntryClick"
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

    <ExplorerContextMenu
      :target="menu"
      :root-path="rootPath"
      @close="closeMenu"
      @open-file="(path, pin) => emit('openFile', path, pin)"
      @open-markdown-preview="(path) => emit('openMarkdownPreview', path)"
      @open-file-preview="(path) => emit('openFilePreview', path)"
      @open-in-terminal="openTerminalInDir"
      @duplicate="duplicatePath"
      @create="beginCreate"
      @rename="beginRename"
      @delete-path="deletePath"
    />
  </aside>
</template>
