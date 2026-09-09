<script setup lang="ts">
import { CloseOutline, DuplicateOutline, TerminalOutline } from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import { computed, onBeforeUnmount, ref } from "vue";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import { tabLabel } from "@/modules/tabs/tabLabel";
import { t } from "@/modules/i18n/translate";
import type { TabDropPlacement } from "@/modules/tabs/tabsReorder";
import type { Tab, TerminalTab } from "@/modules/tabs/tabsTypes";
import type { TabWidthMode } from "@/modules/settings/store";
import TabContextMenu, {
  type TabContextMenuTarget,
} from "./TabContextMenu.vue";
import { startWindowDrag } from "./useWindowDrag";

const props = defineProps<{
  tabs: Tab[];
  activeId: number;
  widthMode: TabWidthMode;
  fixedWidth: number;
}>();

const emit = defineEmits<{
  selectTab: [id: number];
  closeTab: [id: number];
  pinTab: [id: number];
  reorderTab: [sourceId: number, targetId: number, placement: TabDropPlacement];
  closeOthers: [id: number];
  closeToRight: [id: number];
  closeAll: [];
  duplicateTerminal: [tabId: number];
  renameTab: [tabId: number, title: string];
  requestRename: [tabId: number];
}>();

// ── Minimal mode ────────────────────────────────────────────────────────
// 终端优先:工作区里只有一个终端 tab 时,会话条退化为一枚 cwd 面包屑,
// 顶栏看起来就像一台原生终端。出现第二个 tab 或非终端 tab 时恢复完整标签。
const minimalTab = computed<TerminalTab | null>(() => {
  if (props.tabs.length !== 1) return null;
  const only = props.tabs[0];
  return only && only.kind === "terminal" ? only : null;
});

const kindLabelByTabKind = computed(() => {
  const m = new Map<Tab["kind"], string>();
  m.set("terminal", t("app.header.terminal"));
  m.set("git-history", t("app.header.gitHistory"));
  m.set("git-diff", t("app.header.gitDiff"));
  m.set("git-commit-file", t("app.header.gitDiff"));
  m.set("markdown", t("app.header.markdown"));
  m.set("file-preview", t("app.header.filePreview"));
  m.set("preview", t("app.header.preview"));
  m.set("editor", t("settings.general.editor"));
  return m;
});

function tabKindLabel(tab: Tab): string {
  return kindLabelByTabKind.value.get(tab.kind) ?? "";
}

function tabWidthStyle(): Record<string, string> | undefined {
  if (props.widthMode !== "fixed") return undefined;
  return { width: `${Math.round(props.fixedWidth)}px` };
}

function tabWidthClass(): string {
  return props.widthMode === "fixed"
    ? "flex-none"
    : "max-w-48 flex-[1_1_8rem]";
}

// ── Drag-to-reorder(移植自旧 TabBar)─────────────────────────────────

type PointerDragState = {
  sourceId: number;
  pointerId: number;
  startX: number;
  startY: number;
  sourceWidth: number;
  dragging: boolean;
};

type DragGhostState = {
  tab: Tab;
  x: number;
  y: number;
  width: number;
};

const DRAG_THRESHOLD = 6;
const draggingTabId = ref<number | null>(null);
const dropTarget = ref<{ id: number; placement: TabDropPlacement } | null>(null);
const pointerDrag = ref<PointerDragState | null>(null);
const suppressedClickTabId = ref<number | null>(null);
const dragGhost = ref<DragGhostState | null>(null);

function clearDragState() {
  draggingTabId.value = null;
  dropTarget.value = null;
  pointerDrag.value = null;
  dragGhost.value = null;
  cachedDragTab = null;
  cachedDragTabId = null;
}

function dropPlacementFromElement(clientX: number, el: HTMLElement): TabDropPlacement {
  const rect = el.getBoundingClientRect();
  return clientX < rect.left + rect.width / 2 ? "before" : "after";
}

function tabElementFromPoint(x: number, y: number): HTMLElement | null {
  return document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-tab-id]") ?? null;
}

function tabIdFromElement(el: HTMLElement): number | null {
  const id = Number(el.dataset.tabId);
  return Number.isFinite(id) ? id : null;
}

function updateDropTarget(e: PointerEvent) {
  const drag = pointerDrag.value;
  if (!drag) return;
  const el = tabElementFromPoint(e.clientX, e.clientY);
  if (!el) { dropTarget.value = null; return; }
  const id = tabIdFromElement(el);
  if (id === null || id === drag.sourceId) { dropTarget.value = null; return; }
  dropTarget.value = { id, placement: dropPlacementFromElement(e.clientX, el) };
}

// 拖拽开始时缓存 sourceTab,避免 pointermove 每帧线性扫描 tabs。
let cachedDragTab: Tab | null = null;
let cachedDragTabId: number | null = null;

function updateDragGhost(e: PointerEvent, drag: PointerDragState) {
  if (cachedDragTabId !== drag.sourceId) {
    cachedDragTab = props.tabs.find((t) => t.id === drag.sourceId) ?? null;
    cachedDragTabId = drag.sourceId;
  }
  const tab = cachedDragTab;
  if (!tab) { dragGhost.value = null; return; }
  dragGhost.value = { tab, x: e.clientX, y: e.clientY, width: drag.sourceWidth };
}

function handleWindowPointerMove(e: PointerEvent) {
  const drag = pointerDrag.value;
  if (!drag || drag.pointerId !== e.pointerId) return;
  const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
  if (!drag.dragging && dist < DRAG_THRESHOLD) return;
  e.preventDefault();
  if (!drag.dragging) {
    drag.dragging = true;
    draggingTabId.value = drag.sourceId;
  }
  updateDragGhost(e, drag);
  updateDropTarget(e);
}

function handleWindowPointerUp(e: PointerEvent) {
  const drag = pointerDrag.value;
  if (!drag || drag.pointerId !== e.pointerId) return;
  const sourceId = drag.sourceId;
  if (drag.dragging) updateDropTarget(e);
  const target = dropTarget.value;
  removePointerListeners();
  if (drag.dragging) {
    e.preventDefault();
    suppressedClickTabId.value = sourceId;
    window.setTimeout(() => { if (suppressedClickTabId.value === sourceId) suppressedClickTabId.value = null; }, 400);
    if (target && target.id !== sourceId) {
      emit("reorderTab", sourceId, target.id, target.placement);
    }
  }
  clearDragState();
}

function handleWindowPointerCancel(e: PointerEvent) {
  const drag = pointerDrag.value;
  if (!drag || drag.pointerId !== e.pointerId) return;
  removePointerListeners();
  clearDragState();
}

function addPointerListeners() {
  window.addEventListener("pointermove", handleWindowPointerMove, { passive: false });
  window.addEventListener("pointerup", handleWindowPointerUp);
  window.addEventListener("pointercancel", handleWindowPointerCancel);
}

function removePointerListeners() {
  window.removeEventListener("pointermove", handleWindowPointerMove);
  window.removeEventListener("pointerup", handleWindowPointerUp);
  window.removeEventListener("pointercancel", handleWindowPointerCancel);
}

function handleTabPointerDown(e: PointerEvent, tab: Tab) {
  if (props.tabs.length <= 1 || e.button !== 0) return;
  e.stopPropagation();
  removePointerListeners();
  const actualWidth =
    (e.currentTarget as HTMLElement)?.getBoundingClientRect().width ?? 160;
  const ghostCap = props.widthMode === "fixed"
    ? Math.max(104, props.fixedWidth)
    : 224;
  const ghostFloor = props.widthMode === "fixed"
    ? Math.min(104, props.fixedWidth)
    : 104;
  pointerDrag.value = {
    sourceId: tab.id,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    sourceWidth: Math.min(ghostCap, Math.max(ghostFloor, actualWidth)),
    dragging: false,
  };
  addPointerListeners();
}

function handleTabClick(tab: Tab) {
  if (suppressedClickTabId.value === tab.id) {
    suppressedClickTabId.value = null;
    return;
  }
  emit("selectTab", tab.id);
}

function pinPreviewTab(tab: Tab) {
  if (tab.kind === "editor" && tab.preview) emit("pinTab", tab.id);
}

// ── Right-click context menu ────────────────────────────────────────────

const tabContextMenu = ref<TabContextMenuTarget | null>(null);

function handleTabContextMenu(event: MouseEvent, tab: Tab) {
  event.preventDefault();
  const idx = props.tabs.findIndex((t) => t.id === tab.id);
  if (idx < 0) return;
  tabContextMenu.value = {
    tab,
    x: event.clientX,
    y: event.clientY,
    index: idx,
    total: props.tabs.length,
  };
}

function closeTabContextMenu() {
  tabContextMenu.value = null;
}

onBeforeUnmount(removePointerListeners);
</script>

<template>
  <div
    class="flex h-full min-w-0 flex-1 items-center"
    data-session-strip
  >
    <!-- 极简模式:单终端面包屑 -->
    <button
      v-if="minimalTab"
      type="button"
      data-session-minimal
      :title="minimalTab.cwd ?? tabLabel(minimalTab)"
      class="flex h-7 max-w-64 items-center gap-1.5 rounded-full bg-accent/50 px-3 text-[12px] text-foreground transition-colors duration-[var(--dur-fast)] hover:bg-accent"
      @click="emit('selectTab', minimalTab.id)"
      @contextmenu.prevent="handleTabContextMenu($event, minimalTab)"
    >
      <NIcon :component="TerminalOutline" :size="13" class="shrink-0 text-primary" />
      <span class="min-w-0 truncate">{{ tabLabel(minimalTab) }}</span>
      <span
        v-if="minimalTab.terminalTitle"
        class="min-w-0 truncate text-[11px] text-muted-foreground"
      >{{ minimalTab.cwd }}</span>
    </button>

    <!-- 完整会话条 -->
    <template v-else>
      <div class="no-scrollbar min-w-0 flex-1 overflow-x-auto">
        <div class="flex min-w-full items-center gap-1 px-1">
          <TransitionGroup tag="div" name="v2-tab-move" class="flex min-w-0 items-center gap-1">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              type="button"
              :data-tab-id="tab.id"
              :aria-grabbed="draggingTabId === tab.id"
              :aria-pressed="tab.id === activeId"
              :title="`${tabKindLabel(tab)}: ${tabLabel(tab)}`"
              :style="tabWidthStyle()"
              :class="[
                'group relative flex h-7 min-w-[5rem] items-center justify-between gap-1.5 rounded-full px-3 text-left text-[12px] transition-[background-color,color,opacity,box-shadow] duration-[var(--dur-fast)]',
                tabWidthClass(),
                draggingTabId === tab.id ? 'opacity-60' : '',
                dropTarget?.id === tab.id && dropTarget.placement === 'before'
                  ? 'before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary'
                  : '',
                dropTarget?.id === tab.id && dropTarget.placement === 'after'
                  ? 'after:absolute after:inset-y-1.5 after:right-0 after:w-0.5 after:rounded-full after:bg-primary'
                  : '',
                tab.id === activeId
                  ? 'bg-accent text-foreground shadow-[inset_0_0_0_1px_var(--border)]'
                  : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
              ]"
              @click="handleTabClick(tab)"
              @dblclick="pinPreviewTab(tab)"
              @contextmenu.prevent="handleTabContextMenu($event, tab)"
              @pointerdown="handleTabPointerDown($event, tab)"
            >
              <span class="flex min-w-0 flex-1 items-center gap-1.5">
                <img
                  v-if="tab.kind === 'editor' || tab.kind === 'markdown'"
                  v-memo="[tab.kind, tab.title]"
                  :src="fileIconUrl(tab.title)"
                  alt=""
                  class="size-3.5 shrink-0"
                />
                <NIcon
                  v-else-if="tab.kind === 'terminal'"
                  :component="TerminalOutline"
                  :size="12"
                  class="shrink-0"
                  :class="tab.id === activeId ? 'text-primary' : ''"
                />
                <span
                  class="min-w-0 truncate"
                  :class="tab.kind === 'editor' && tab.preview ? 'italic text-muted-foreground' : ''"
                >
                  {{ tabLabel(tab) }}
                </span>
                <span
                  v-if="tab.kind === 'editor' && tab.dirty"
                  class="size-1.5 shrink-0 rounded-full bg-primary"
                />
              </span>
              <span
                role="button"
                tabindex="-1"
                class="grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground opacity-0 transition-all duration-[var(--dur-fast)] hover:bg-destructive/15 hover:text-destructive group-hover:opacity-60 group-hover:hover:opacity-100"
                @click.stop="emit('closeTab', tab.id)"
                @pointerdown.stop
              >
                <NIcon :component="CloseOutline" :size="11" />
              </span>
            </button>
          </TransitionGroup>
        </div>
      </div>
    </template>

    <!-- 拖拽区:会话条之后的空白带 -->
    <div
      data-window-drag-region
      class="h-8 min-w-2 flex-1"
      @pointerdown="startWindowDrag"
    />

    <!-- Drag ghost -->
    <div
      v-if="dragGhost"
      class="v2-glass-float will-change-transform pointer-events-none fixed z-50 flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] opacity-95"
      :style="{
        width: `${dragGhost.width}px`,
        transform: `translate3d(${dragGhost.x}px, ${dragGhost.y}px, 0) translate(-50%, -50%)`,
      }"
    >
      <img
        v-if="dragGhost.tab.kind === 'editor' || dragGhost.tab.kind === 'markdown'"
        :src="fileIconUrl(dragGhost.tab.title)"
        alt=""
        class="size-3.5 shrink-0"
      />
      <NIcon
        v-else-if="dragGhost.tab.kind === 'terminal'"
        :component="DuplicateOutline"
        :size="12"
      />
      <span class="min-w-0 truncate">{{ tabLabel(dragGhost.tab) }}</span>
    </div>

    <TabContextMenu
      :target="tabContextMenu"
      @close="closeTabContextMenu"
      @close-tab="(id) => emit('closeTab', id)"
      @close-others="(id) => emit('closeOthers', id)"
      @close-to-right="(id) => emit('closeToRight', id)"
      @close-all="emit('closeAll')"
      @duplicate-terminal="(id) => emit('duplicateTerminal', id)"
      @rename-tab="(id, title) => emit('renameTab', id, title)"
      @request-rename="(id) => emit('requestRename', id)"
      @pin-editor="(id) => emit('pinTab', id)"
    />
  </div>
</template>
