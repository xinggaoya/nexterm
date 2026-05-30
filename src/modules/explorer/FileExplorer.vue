<script setup lang="ts">
import {
  DocumentOutline,
  FolderOutline,
  RefreshOutline,
  SearchOutline,
} from "@vicons/ionicons5";
import { NButton, NIcon, NSpin } from "naive-ui";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import TooltipTitle from "@/components/TooltipTitle.vue";
import { t } from "@/modules/i18n/translate";
import type { GitChangedFile, WorkspaceFsChangedEvent } from "@/lib/native";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import ExplorerContextMenu, {
  type ExplorerContextMenuTarget,
} from "./ExplorerContextMenu.vue";
import ExplorerSearch from "./ExplorerSearch.vue";
import FileTreeRow from "./FileTreeRow.vue";
import {
  buildFileTreeRows,
  type FileTreeRow as VisibleTreeRow,
  type FileTreeState,
  type PendingCreate,
} from "./lib/fileTreeRows";
import {
  createFileTreeEntry,
  deleteFileTreePath,
  dirname,
  joinPath,
  readFileTreeDir,
  renameFileTreePath,
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
type VirtualRow = {
  row: VisibleTreeRow;
  top: number;
};

const TREE_ROW_HEIGHT = 24;
const TREE_OVERSCAN_ROWS = 8;
const TREE_REFRESH_DELAY_MS = 240;
const TREE_BULK_REFRESH_DELAY_MS = 420;
const TREE_BULK_EVENT_PATH_THRESHOLD = 48;

const props = defineProps<{
  rootPath: string | null;
  fsEvent?: WorkspaceFsChangedEvent | null;
  gitChangedFiles?: GitChangedFile[];
}>();

const emit = defineEmits<{
  openFile: [path: string, pin: boolean];
  pathRenamed: [from: string, to: string];
  pathDeleted: [path: string];
  openMarkdownPreview: [path: string];
}>();

const prefs = usePreferencesPiniaStore();
const nodes = ref<FileTreeState>({});
const expanded = ref<Set<string>>(new Set());
const pendingCreate = ref<PendingCreate | null>(null);
const renaming = ref<string | null>(null);
const selectedPath = ref<string | null>(null);
const isSearchOpen = ref(false);
const isSearchActive = ref(false);
const menu = ref<ExplorerContextMenuTarget | null>(null);
const treeScrollHost = ref<HTMLElement | null>(null);
const treeScrollTop = ref(0);
const treeViewportHeight = ref(0);
let fsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
const pendingFsEventPaths = new Set<string>();
const inFlightLoads = new Map<string, InFlightLoad>();
let resizeObserver: ResizeObserver | null = null;

const rootName = computed(() => {
  if (!props.rootPath) return "";
  return basename(props.rootPath);
});

const rootState = computed(() =>
  props.rootPath ? nodes.value[props.rootPath] : undefined,
);

const treeSnapshot = computed(() => {
  if (!props.rootPath) {
    return {
      rows: [] as VisibleTreeRow[],
      entryIndexByPath: new Map<string, number>(),
    };
  }
  return buildFileTreeRows({
    rootPath: props.rootPath,
    nodes: nodes.value,
    expanded: expanded.value,
    pendingCreate: pendingCreate.value,
    renaming: renaming.value,
    gitChangedFiles: props.gitChangedFiles ?? [],
  });
});

const rows = computed(() => treeSnapshot.value.rows);
const totalTreeHeight = computed(() => rows.value.length * TREE_ROW_HEIGHT);
const visibleTreeRows = computed<VirtualRow[]>(() => {
  const allRows = rows.value;
  if (allRows.length === 0) return [];
  const viewportHeight = treeViewportHeight.value || 480;
  const start = Math.max(
    0,
    Math.floor(treeScrollTop.value / TREE_ROW_HEIGHT) - TREE_OVERSCAN_ROWS,
  );
  const end = Math.min(
    allRows.length,
    Math.ceil((treeScrollTop.value + viewportHeight) / TREE_ROW_HEIGHT) +
      TREE_OVERSCAN_ROWS,
  );
  return allRows.slice(start, end).map((row, index) => ({
    row,
    top: (start + index) * TREE_ROW_HEIGHT,
  }));
});
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
  const current = nodes.value[path];
  const silent = options.silent === true && current?.status === "loaded";
  const active = inFlightLoads.get(path);
  if (active) {
    active.rerun = true;
    active.silent = active.silent && silent;
    return;
  }

  inFlightLoads.set(path, { rerun: false, silent });
  if (!silent) {
    nodes.value = { ...nodes.value, [path]: { status: "loading" } };
  }
  try {
    const entries = await readFileTreeDir(path, prefs.showHidden);
    nodes.value = { ...nodes.value, [path]: { status: "loaded", entries } };
  } catch (error) {
    nodes.value = {
      ...nodes.value,
      [path]: { status: "error", message: normalizeError(error) },
    };
  } finally {
    const finished = inFlightLoads.get(path);
    inFlightLoads.delete(path);
    if (finished?.rerun) {
      void loadChildren(path, { silent: finished.silent });
    }
  }
}

function refreshPath(path: string | null = props.rootPath) {
  if (path) void loadChildren(path);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isSameRoot(a: string | null, b: string | null): boolean {
  return !!a && !!b && normalizePath(a) === normalizePath(b);
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
  const root = normalizePath(props.rootPath);
  const refreshablePaths = new Map<string, string>();
  for (const [path, state] of Object.entries(nodes.value)) {
    if (isRefreshableState(state)) {
      refreshablePaths.set(normalizePath(path), path);
    }
  }

  const targets = new Set<string>();
  let sawRelevantPath = false;
  for (const rawPath of paths.length > 0 ? paths : [props.rootPath]) {
    const path = normalizePath(rawPath);
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

function scheduleTreeRefresh(event: WorkspaceFsChangedEvent) {
  if (!props.rootPath) return;
  for (const path of event.paths.length > 0 ? event.paths : [props.rootPath]) {
    pendingFsEventPaths.add(path);
  }
  const delay =
    pendingFsEventPaths.size > TREE_BULK_EVENT_PATH_THRESHOLD ||
    event.paths.length === 0
      ? TREE_BULK_REFRESH_DELAY_MS
      : TREE_REFRESH_DELAY_MS;
  if (fsRefreshTimer) clearTimeout(fsRefreshTimer);
  fsRefreshTimer = setTimeout(() => {
    fsRefreshTimer = null;
    if (!props.rootPath) return;
    const paths = Array.from(pendingFsEventPaths);
    pendingFsEventPaths.clear();
    for (const path of refreshTargetsForPaths(paths)) {
      void loadChildren(path, { silent: true });
    }
  }, delay);
}

function updateTreeViewport() {
  const host = treeScrollHost.value;
  if (!host) return;
  treeScrollTop.value = host.scrollTop;
  treeViewportHeight.value = host.clientHeight;
}

function handleTreeScroll() {
  closeMenu();
  updateTreeViewport();
}

function toggleDir(path: string) {
  const next = new Set(expanded.value);
  const isOpen = next.has(path);
  if (isOpen) next.delete(path);
  else next.add(path);
  expanded.value = next;
  if (!isOpen && (!nodes.value[path] || nodes.value[path].status === "error")) {
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
    expanded.value = new Set(expanded.value).add(parentPath);
  }
  if (!nodes.value[parentPath]) void loadChildren(parentPath);
}

function cancelCreate() {
  pendingCreate.value = null;
}

async function commitCreate(name: string) {
  const pending = pendingCreate.value;
  if (!pending) return;
  const trimmed = name.trim();
  if (!trimmed) {
    pendingCreate.value = null;
    return;
  }
  const path = joinPath(pending.parentPath, trimmed);
  try {
    await createFileTreeEntry(path, pending.kind);
    await loadChildren(pending.parentPath);
  } finally {
    pendingCreate.value = null;
  }
}

function beginRename(path: string) {
  closeMenu();
  pendingCreate.value = null;
  renaming.value = path;
}

function cancelRename() {
  renaming.value = null;
}

async function commitRename(newName: string) {
  const from = renaming.value;
  if (!from) return;
  const trimmed = newName.trim();
  const parent = dirname(from);
  const oldName = basename(from);
  if (!trimmed || trimmed === oldName) {
    renaming.value = null;
    return;
  }
  const to = joinPath(parent, trimmed);
  try {
    await renameFileTreePath(from, to);
    emit("pathRenamed", from, to);
    selectedPath.value = to;
    await loadChildren(parent);
  } finally {
    renaming.value = null;
  }
}

async function deletePath(path: string) {
  await deleteFileTreePath(path);
  emit("pathDeleted", path);
  if (selectedPath.value === path || selectedPath.value?.startsWith(`${path}/`)) {
    selectedPath.value = null;
  }
  await loadChildren(dirname(path));
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

function moveSelection(index: number) {
  const paths = entryPaths.value;
  if (paths.length === 0) return;
  const clamped = Math.max(0, Math.min(paths.length - 1, index));
  selectedPath.value = paths[clamped];
  void nextTick(() => scrollSelectedPathIntoView());
}

function scrollSelectedPathIntoView() {
  const host = treeScrollHost.value;
  const selected = selectedPath.value;
  if (!host || !selected) return;
  const rowIndex = entryIndexByPath.value.get(selected);
  if (rowIndex === undefined) return;
  const rowTop = rowIndex * TREE_ROW_HEIGHT;
  const rowBottom = rowTop + TREE_ROW_HEIGHT;
  if (rowTop < host.scrollTop) {
    host.scrollTop = rowTop;
    updateTreeViewport();
  } else if (rowBottom > host.scrollTop + host.clientHeight) {
    host.scrollTop = rowBottom - host.clientHeight;
    updateTreeViewport();
  }
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
    nodes.value = {};
    expanded.value = new Set();
    pendingCreate.value = null;
    renaming.value = null;
    selectedPath.value = null;
    isSearchOpen.value = false;
    isSearchActive.value = false;
    closeMenu();
    treeScrollTop.value = 0;
    if (rootPath) void loadChildren(rootPath);
  },
  { immediate: true },
);

watch(
  () => prefs.showHidden,
  () => {
    if (!props.rootPath) return;
    const loadedPaths = Object.entries(nodes.value)
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

watch(rows, () => {
  if (selectedPath.value && !entryIndexByPath.value.has(selectedPath.value)) {
    selectedPath.value = null;
  }
  void nextTick(() => updateTreeViewport());
});

watch(treeScrollHost, (host, previous) => {
  if (previous && resizeObserver) resizeObserver.unobserve(previous);
  if (!host) return;
  updateTreeViewport();
  if (typeof ResizeObserver === "undefined") return;
  resizeObserver ??= new ResizeObserver(updateTreeViewport);
  resizeObserver.observe(host);
});

onBeforeUnmount(() => {
  clearScheduledTreeRefresh();
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <aside
    data-file-explorer
    class="flex h-full w-full min-h-0 flex-col bg-card text-foreground outline-none"
    tabindex="0"
    @keydown="handleKeydown"
  >
    <div
      class="flex h-8 shrink-0 items-center gap-1 border-b border-border/60 px-2"
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
          @click="isSearchOpen = !isSearchOpen"
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
        :root-path="rootPath"
        :open="isSearchOpen"
        @request-close="isSearchOpen = false"
        @active-change="(active) => (isSearchActive = active)"
        @open-file="(path, pin) => emit('openFile', path, pin)"
      />

      <div
        ref="treeScrollHost"
        v-show="!isSearchActive"
        class="min-h-0 flex-1 overflow-y-auto"
        data-file-tree-scroll
        @scroll.passive="handleTreeScroll"
        @contextmenu.prevent="openRootMenu"
      >
        <div
          v-if="rootState?.status === 'loading'"
          class="flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground"
        >
          <NSpin size="small" />
          <span>{{ t("explorer.loading") }}</span>
        </div>
        <div
          v-else-if="rootState?.status === 'error'"
          class="px-3 py-2 text-[11px] text-destructive"
        >
          {{ rootState.message }}
        </div>
        <div
          v-else-if="rootState?.status === 'loaded'"
          class="relative px-1 py-1"
          :style="{ height: `${totalTreeHeight + (pendingAtRoot ? TREE_ROW_HEIGHT : 0) + 8}px` }"
          data-file-tree-virtual
        >
          <div
            v-if="pendingAtRoot"
            class="absolute inset-x-1"
            :style="{ top: '4px', height: `${TREE_ROW_HEIGHT}px` }"
          >
            <FileTreeRow
              :row="pendingAtRoot"
              :selected="false"
              @commit-create="commitCreate"
              @cancel-create="cancelCreate"
            />
          </div>
          <div
            v-for="item in visibleTreeRows"
            :key="item.row.key"
            class="absolute inset-x-1"
            :style="{
              top: `${item.top + (pendingAtRoot ? TREE_ROW_HEIGHT : 0) + 4}px`,
              height: `${TREE_ROW_HEIGHT}px`,
            }"
          >
            <FileTreeRow
              :row="item.row"
              :selected="item.row.kind !== 'status' && item.row.kind !== 'pending' && selectedPath === item.row.path"
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
      @create="beginCreate"
      @delete-path="deletePath"
    />
  </aside>
</template>
