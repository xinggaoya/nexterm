<script setup lang="ts">
import { basename } from "@/lib/path";
import {
  ContractOutline,
  CopyOutline,
  DocumentOutline,
  ExpandOutline,
  FolderOutline,
  MoveOutline,
  RefreshOutline,
  SearchOutline,
} from "@vicons/ionicons5";
import { NButton, NIcon, NInput } from "naive-ui";
import { computed, onBeforeUnmount, ref } from "vue";
import TooltipTitle from "@/components/TooltipTitle.vue";
import { t } from "@/modules/i18n/translate";
import { useWorkspaceContext } from "@/app/workspaceContext";
import type { WorkspaceFsChangedEvent } from "@/lib/native";
import { notifyError } from "@/modules/notifications/notificationCenter";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import type { GitDecorationMap } from "@/modules/source-control";
import ExplorerContextMenu, {
  type ExplorerContextMenuTarget,
} from "./ExplorerContextMenu.vue";
import ExplorerSearch from "./ExplorerSearch.vue";
import { FindInFilesPanel } from "@/modules/search";
import FileTreeRow from "./FileTreeRow.vue";
import FileTransferConflictDialog from "./FileTransferConflictDialog.vue";
import { useFileTreeData } from "./composables/useFileTreeData";
import { useTreeSelection } from "./composables/useTreeSelection";
import { useTreeTransfer } from "./composables/useTreeTransfer";
import type { FileTreeRow as VisibleTreeRow } from "./lib/fileTreeRows";
import { deleteFileTreePath } from "./lib/fileTreeService";
import { folderIconUrl } from "./lib/iconResolver";

type EntryRow = Extract<VisibleTreeRow, { kind: "entry" }>;
type MenuRow = Extract<VisibleTreeRow, { kind: "entry" | "rename" }>;

const props = defineProps<{
  rootPath: string | null;
  fsEvent?: WorkspaceFsChangedEvent | null;
  gitDecorations?: GitDecorationMap;
}>();

const emit = defineEmits<{
  openFile: [path: string, pin: boolean];
  pathRenamed: [from: string, to: string];
  pathDeleted: [path: string];
  openMarkdownPreview: [path: string];
  openFilePreview: [path: string];
  openInTerminal: [path: string];
  openSearchResult: [path: string, line: number];
}>();

const prefs = usePreferencesPiniaStore();
const wsCtx = useWorkspaceContext();

const mode = ref<"files" | "content">("files");
const isSearchOpen = ref(false);
const isSearchActive = ref(false);
const menu = ref<ExplorerContextMenuTarget | null>(null);

/**
 * 文件树被拆成三层，组件只做组装与模板：
 * - `tree`     目录加载、展开态、行集、虚拟滚动、watcher 刷新编排
 * - `selection`多选集、键盘光标、Shift 锚点、键盘导航
 * - `transfer` 拖拽 / 剪贴板 / OS 拖入共用的搬运编排
 * 三层的边界就是它们的依赖方向（单向，无环），拆开后数据加载的时序逻辑
 * 可以脱离渲染单独推理。
 */
const tree = useFileTreeData({
  rootPath: computed(() => props.rootPath),
  fsEvent: computed(() => props.fsEvent ?? null),
  gitDecorations: computed(() => props.gitDecorations),
  showHidden: computed(() => prefs.showHidden),
  wsNative: wsCtx.wsNative,
  // 滚动时关掉右键菜单（菜单的定位在滚动后必然失效）。
  onScroll: () => closeMenu(),
});

const {
  expanded,
  pendingCreate,
  renaming,
  treeFilter,
  rootName,
  rootState,
  visibleRows,
  entryPaths,
  entryIndexByPath,
  pendingAtRoot,
  expandedCount,
  useVirtualization,
  treeScroll,
  virtualRows,
  virtualTopPadding,
  virtualBottomPadding,
  onTreeScroll,
  isEntryDir,
  dirnameOf,
  rebuildTreeSnapshot,
  loadChildren,
  refreshPath,
  clearScheduledTreeRefresh,
  flushPendingTreeRefresh,
  activate,
  toggleDir,
  toggleExpandAll,
  beginCreate: beginCreateInTree,
  beginRename: beginRenameInTree,
  cancelRename,
  commitCreate,
  cancelCreate,
  commitRename,
} = tree;

const selection = useTreeSelection({
  entryPaths: entryPaths,
  entryIndexByPath: entryIndexByPath,
  isDirPath: (path) => isEntryDir(dirnameOf(path), basename(path)),
  isExpanded: (path) => expanded.has(path),
  parentOf: dirnameOf,
  rootPath: computed(() => props.rootPath),
  toggleDir: (path) => {
    closeMenu();
    toggleDir(path);
  },
  openFile: (path) => emit("openFile", path, false),
});

const {
  selectedPaths,
  focusedPath,
  anchorPath,
  selectOnly,
  toggleSelection,
  selectRange,
  orderedSelectedPaths,
  handleKeydown: handleTreeKeydown,
} = selection;

const transfer = useTreeTransfer({
  wsNative: wsCtx.wsNative,
  rootPath: computed(() => props.rootPath),
  treeScroll: treeScroll,
  loadChildren: loadChildren,
  parentOf: dirnameOf,
  entryPaths: entryPaths,
  selectedPaths: selection.selectedPaths,
  expanded: tree.expanded,
  rebuildSnapshot: rebuildTreeSnapshot,
  entryNamesOf: tree.entryNamesOf,
  isEntryDir: isEntryDir,
  onPathRenamed: (from, to) => emit("pathRenamed", from, to),
  isDragBlocked: () =>
    !props.rootPath ||
    transferBusy.value ||
    renaming.value !== null ||
    pendingCreate.value !== null ||
    isSearchOpen.value ||
    isSearchActive.value ||
    mode.value !== "files",
});

const {
  clipboard,
  transferBusy,
  transferProgress,
  transferPercent,
  transferProgressLabel,
  cancelTransfer,
  pendingConflict,
  dragMode,
  dropAllowed,
  dragGhost,
  dragGhostLabel,
  beginRowDrag,
  consumeDragClick,
  runTransfer,
  onConflictResolved,
  onConflictCanceled,
  copySelection,
  cutSelection,
  paste,
  isRowDragSource,
  isRowCut,
  isRowDropLine,
  isRowDropTarget,
  isRowDropForbidden,
} = transfer;

/** 拖拽结束后紧跟的 click 要被吃掉，否则松手会先落 drop 再触发选中。 */
function handleEntryClickForDrag(row: EntryRow, event: MouseEvent) {
  if (consumeDragClick(row.path)) return;
  handleEntryClick(row, event);
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

function handleRowPointerDown(row: EntryRow, event: PointerEvent) {
  beginRowDrag(row.path, event);
}

// ── 行级视觉判定（模板用不到 v-for 之外的东西，直接转发）────────────
function onRowDragSource(row: VisibleTreeRow): boolean {
  return row.kind === "entry" && isRowDragSource(row.path);
}

function onRowCut(row: VisibleTreeRow): boolean {
  return row.kind === "entry" && isRowCut(row.path);
}

function onRowDropTarget(row: VisibleTreeRow): boolean {
  return row.kind === "entry" && isRowDropTarget(row.path);
}

function onRowDropLine(row: VisibleTreeRow): "before" | "after" | null {
  return row.kind === "entry" ? isRowDropLine(row.path) : null;
}

function onRowDropForbidden(row: VisibleTreeRow): boolean {
  return row.kind === "entry" && isRowDropForbidden(row.path);
}

async function onCommitRename(newName: string): Promise<void> {
  const result = await commitRename(newName);
  // 重命名成功后让已打开的编辑器标签跟随新路径，否则保存会写回失效路径。
  if (result) emit("pathRenamed", result.from, result.to);
}

function onCopy(): void {
  copySelection(orderedSelectedPaths());
}

function onCut(): void {
  cutSelection(orderedSelectedPaths());
}

function onPaste(): void {
  void paste(orderedSelectedPaths());
}

function beginCreate(parentPath: string | null, kind: "file" | "dir") {
  closeMenu();
  // 数据层的 beginCreate 不管菜单（菜单是组件的事）。
  cancelRename();
  beginCreateInTree(parentPath, kind);
}

function beginRename(path: string) {
  closeMenu();
  beginRenameInTree(path);
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

  const mod = event.ctrlKey || event.metaKey;
  if (mod) {
    const key = event.key.toLowerCase();
    const selected = orderedSelectedPaths();
    // 文件树内的 Cmd+C / Cmd+X / Cmd+V 走文件剪贴板，不与文本剪贴板混用。
    // 选中集为空时不接管：用户很可能在编辑筛选框或只是没选中任何东西。
    if (key === "c" && selected.length > 0) {
      event.preventDefault();
      copySelection(selected);
      return;
    }
    if (key === "x" && selected.length > 0) {
      event.preventDefault();
      cutSelection(selected);
      return;
    }
    if (key === "v" && !clipboard.isEmpty.value) {
      event.preventDefault();
      void paste(selected);
      return;
    }
  }
  handleTreeKeydown(event);
}

// ── 批量删除：深路径优先（先删子项再删父目录），单项失败不阻断其余项；
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
  if (remaining.size !== selectedPaths.value.size) {
    selectOnly(null);
    for (const path of remaining) toggleSelection(path);
  }
  if (focusedPath.value && isGone(focusedPath.value)) {
    focusedPath.value = null;
  }
  if (anchorPath.value && isGone(anchorPath.value)) {
    anchorPath.value = null;
  }

  const parents = Array.from(new Set(deleted.map((path) => dirnameOf(path)))).filter(
    (parent) => !isGone(parent),
  );
  await Promise.all(parents.map((parent) => loadChildren(parent)));
}

/**
 * "复制副本"：在同级目录造一份 `foo copy.ext` / `foo copy 2.ext`。
 *
 * 走与拖拽 / 粘贴同一条搬运链路（runTransfer → fs_copy_many）：命名避让由
 * 后端 fs-core 负责。此前这里是自己 try 100 次 catch "already exists"，
 * 是最后一条没迁移的搬运路径，而且它依赖一条已被废弃的 fs_copy 命令
 * （WSL/SSH 下那条命令与新引擎的符号链接处理并不一致）。
 */
async function duplicatePath(path: string) {
  await runTransfer([path], dirnameOf(path), "copy");
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

function openTerminalInDir(path: string) {
  closeMenu();
  emit("openInTerminal", path);
}

function setMode(next: "files" | "content") {
  mode.value = next;
  isSearchOpen.value = false;
}

onBeforeUnmount(() => {
  clearScheduledTreeRefresh();
});

defineExpose({
  setMode,
  /**
   * 搬运入口。拖拽、剪贴板粘贴、OS 文件拖入都走它，保证三条入口的
   * 冲突征询与结果汇报完全一致。
   */
  runTransfer: runTransfer,
  /** 搬运进行中（用于禁用重复提交与展示 busy 态）。 */
  isTransferring: () => transferBusy.value,
  /**
   * 同步 flush 待执行的 tree refresh（取消 180ms 防抖）。
   * 父组件在 workspace 切回时调，保证切回 explorer 立即是最新状态。
   */
  flushPendingTreeRefresh: flushPendingTreeRefresh,
  /**
   * 切回激活：主动重读根 + 展开节点，不依赖 fsEvent 是否到达。
   * 父组件切回时调，保证切回 explorer 立刻是最新状态。
   */
  activate: activate,
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
      <TooltipTitle :label="expandedCount > 0 ? t('explorer.collapseAll') : t('explorer.expandAll')">
        <NButton
          size="tiny"
          quaternary
          :data-collapse-all="expandedCount > 0 ? 'collapse' : 'expand'"
          :aria-label="expandedCount > 0 ? t('explorer.collapseAll') : t('explorer.expandAll')"
          :disabled="!rootPath"
          @click="toggleExpandAll"
        >
          <template #icon>
            <NIcon :component="expandedCount > 0 ? ContractOutline : ExpandOutline" />
          </template>
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
      <div
        v-if="rootPath"
        class="relative ml-0.5 flex min-w-0 flex-1 items-center"
        data-tree-filter
      >
        <NInput
          v-model:value="treeFilter"
          size="tiny"
          clearable
          :placeholder="t('explorer.filterTreePlaceholder')"
          data-tree-filter-input
          class="max-w-40"
        />
      </div>
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
            v-if="useVirtualization"
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
              :dragging="onRowDragSource(row)"
              :cut="onRowCut(row)"
              :drop-line="onRowDropLine(row)"
              :drop-target="onRowDropTarget(row)"
              :drop-forbidden="onRowDropForbidden(row)"
              @entry-click="handleEntryClickForDrag"
              @entry-pointer-down="handleRowPointerDown"
              @begin-rename="beginRename"
              @commit-rename="onCommitRename"
              @cancel-rename="tree.cancelRename"
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
              v-for="row in visibleRows"
              :key="row.key"
              :row="row"
              :selected="row.kind !== 'status' && row.kind !== 'pending' && selectedPaths.has(row.path)"
              :dragging="onRowDragSource(row)"
              :cut="onRowCut(row)"
              :drop-line="onRowDropLine(row)"
              :drop-target="onRowDropTarget(row)"
              :drop-forbidden="onRowDropForbidden(row)"
              @entry-click="handleEntryClickForDrag"
              @entry-pointer-down="handleRowPointerDown"
              @begin-rename="beginRename"
              @commit-rename="onCommitRename"
              @cancel-rename="tree.cancelRename"
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
      搬运进度条：复制几 GB 的目录时没有反馈 = 用户以为卡死。
      只在搬运进行中挂载，且带取消按钮（后端是协作式取消：下一个 256KiB
      检查点停下，已写了一半的文件会被记为 failed 而不是悄悄留在磁盘上）。
    -->
    <div
      v-if="transferProgress"
      data-transfer-progress
      class="pointer-events-none fixed bottom-3 left-1/2 z-50 w-[320px] max-w-[92vw] -translate-x-1/2"
    >
      <div
        class="pointer-events-auto v2-glass-float flex flex-col gap-1.5 rounded-lg px-2.5 py-2 shadow-lg"
      >
        <div class="flex items-center justify-between gap-2 text-[11.5px]">
          <span class="min-w-0 flex-1 truncate">
            {{ transferProgressLabel }}
          </span>
          <span v-if="transferPercent !== null" class="shrink-0 tabular-nums text-muted-foreground">
            {{ transferPercent }}%
          </span>
          <NButton
            size="tiny"
            quaternary
            data-transfer-cancel
            :aria-label="t('explorer.transferCancel')"
            @click="cancelTransfer"
          >
            {{ t("explorer.transferCancel") }}
          </NButton>
        </div>
        <div class="h-1 w-full overflow-hidden rounded-full bg-surface-subtle">
          <div
            class="h-full rounded-full bg-primary transition-[width] duration-200"
            :style="{ width: `${transferPercent ?? 0}%` }"
          />
        </div>
      </div>
    </div>

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
      @copy="onCopy"
      @cut="onCut"
      @paste="onPaste"
      :can-paste="!clipboard.isEmpty.value"
      @create="beginCreate"
      @rename="beginRename"
      @delete-paths="deletePaths"
    />
  </aside>
</template>
