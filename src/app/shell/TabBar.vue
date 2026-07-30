<script setup lang="ts">
import {
  CloseOutline,
  DuplicateOutline,
  AddOutline,
  ReorderTwoOutline,
} from "@vicons/ionicons5";
import { NDropdown, NIcon, type DropdownOption } from "naive-ui";
import { computed, h, onBeforeUnmount, ref, type VNode } from "vue";
import NextermIconButton from "@/components/NextermIconButton.vue";
import TooltipTitle from "@/components/TooltipTitle.vue";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import { tabLabel } from "@/modules/tabs/tabLabel";
import { t } from "@/modules/i18n/translate";
import type { TabDropPlacement } from "@/modules/tabs/tabsReorder";
import type { Tab } from "@/modules/tabs/tabsTypes";
import type { SplitDir } from "@/modules/terminal/lib/layout";
import TabContextMenu, {
  type TabContextMenuTarget,
} from "./TabContextMenu.vue";

const props = defineProps<{
  tabs: Tab[];
  activeId: number;
  canSplit: boolean;
  showActions: boolean;
}>();

const emit = defineEmits<{
  selectTab: [id: number];
  closeTab: [id: number];
  pinTab: [id: number];
  newTab: [];
  reorderTab: [sourceId: number, targetId: number, placement: TabDropPlacement];
  splitPane: [dir: SplitDir];
  closeOthers: [id: number];
  closeToRight: [id: number];
  closeAll: [];
  duplicateTerminal: [tabId: number];
  renameTab: [tabId: number, title: string];
  requestRename: [tabId: number];
}>();



// tabKindLabel 调用的是静态翻译串，结果完全由 tab.kind 决定。把它做成
// computed Map 只在 tabs 数组引用变化时重算，避免每次父组件重渲染都重新
// 调用 t()（i18n key→字符串映射本身不重，但函数开销和模板求值仍然存在）。
const kindLabelByTabKind = computed(() => {
  const m = new Map<Tab["kind"], string>();
  m.set("terminal", t("app.header.terminal"));
  m.set("git-history", t("app.header.gitHistory"));
  m.set("git-diff", t("app.header.gitDiff"));
  m.set("git-commit-file", t("app.header.gitDiff"));
  m.set("markdown", t("app.header.markdown"));
  m.set("preview", t("app.header.preview"));
  m.set("editor", t("settings.general.editor"));
  return m;
});

function tabKindLabel(tab: Tab): string {
  return kindLabelByTabKind.value.get(tab.kind) ?? "";
}
// --- Drag-to-reorder ---


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

// 拖拽中每帧 pointermove 都会跑。原先 props.tabs.find 是 O(Tab 数)，
// 大标签数时叠加 layout 抖动。这里在拖拽开始时把 sourceTab 缓存，
// pointermove 期间直接读缓存，避免重复线性扫描。
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
  pointerDrag.value = {
    sourceId: tab.id,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    sourceWidth: Math.min(224, Math.max(104, (e.currentTarget as HTMLElement)?.getBoundingClientRect().width ?? 160)),
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

// --- Right-click context menu ---

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

// --- Split dropdown ---

const splitOptions = computed<DropdownOption[]>(() => [
  { key: "row", label: t("app.header.splitRight") },
  { key: "col", label: t("app.header.splitDown") },
]);

function renderSplitIcon(option: DropdownOption): VNode {
  return h(NIcon, { size: 14 }, { default: () => h(option.key === "col" ? ReorderTwoOutline : DuplicateOutline) });
}

function handleSplitSelect(key: string | number) {
  emit("splitPane", key === "col" ? "col" : "row");
}
</script>

<template>
  <div class="flex h-[34px] shrink-0 items-center rounded-t-[6px] border-b border-border bg-surface-subtle/60">
    <div class="no-scrollbar min-w-0 flex-1 overflow-x-auto">
      <div class="flex min-w-full items-end gap-0.5 px-1.5 py-1.5">
        <TransitionGroup tag="div" name="v2-tab-move" class="flex min-w-0 items-end gap-0.5">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          :data-tab-id="tab.id"
          :aria-grabbed="draggingTabId === tab.id"
          :title="`${tabKindLabel(tab)}: ${tabLabel(tab)}`"
          :class="[
            'group relative flex h-7 min-w-[5rem] max-w-48 flex-[1_1_8rem] items-center justify-between gap-1.5 rounded-[6px] px-2.5 text-left text-[12px] transition-[background-color,color,opacity] duration-[var(--dur-fast)]',
            draggingTabId === tab.id ? 'opacity-60' : '',
            dropTarget?.id === tab.id && dropTarget.placement === 'before'
              ? 'before:absolute before:inset-y-1.5 before:left-[-2px] before:w-0.5 before:rounded-full before:bg-primary'
              : '',
            dropTarget?.id === tab.id && dropTarget.placement === 'after'
              ? 'after:absolute after:inset-y-1.5 after:right-[-2px] after:w-0.5 after:rounded-full after:bg-primary'
              : '',
            tab.id === activeId
              ? 'bg-accent/70 text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary'
              : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
          ]"
          @click="handleTabClick(tab)"
          @dblclick="pinPreviewTab(tab)"
          @contextmenu.prevent="handleTabContextMenu($event, tab)"
          @pointerdown="handleTabPointerDown($event, tab)"
        >
          <span class="flex min-w-0 flex-1 items-center gap-1.5 truncate">
            <img
              v-if="tab.kind === 'editor' || tab.kind === 'markdown'"
              v-memo="[tab.kind, tab.title]"
              :src="fileIconUrl(tab.title)"
              alt=""
              class="size-3.5 shrink-0"
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
          <TooltipTitle v-if="tabs.length > 1" :label="t('app.header.closeTab')">
            <span
              role="button"
              tabindex="-1"
              class="grid size-4 shrink-0 place-items-center rounded-[3px] text-muted-foreground opacity-0 transition-all duration-[var(--dur-fast)] hover:bg-destructive/15 hover:text-destructive group-hover:opacity-60 group-hover:hover:opacity-100"
              @click.stop="emit('closeTab', tab.id)"
              @pointerdown.stop
            >
              <NIcon :component="CloseOutline" :size="11" />
            </span>
          </TooltipTitle>
        </button>
        </TransitionGroup>

        <div
          data-window-drag-region
          class="h-6 min-w-4 flex-1"
        />
      </div>
    </div>

    <div v-if="showActions" class="flex shrink-0 items-center gap-0.5 pr-1.5">
      <TooltipTitle :label="t('app.header.newTerminal')">
        <NextermIconButton
          data-new-tab
          @click="emit('newTab')"
        >
          <NIcon :component="AddOutline" :size="14" />
        </NextermIconButton>
      </TooltipTitle>
      <TooltipTitle :label="t('app.header.splitActions')">
        <NDropdown
          trigger="click"
          placement="bottom-end"
          :options="splitOptions"
          :disabled="!canSplit"
          :render-icon="renderSplitIcon"
          @select="handleSplitSelect"
        >
          <NextermIconButton
            :disabled="!canSplit"
          >
            <NIcon :component="DuplicateOutline" :size="14" />
          </NextermIconButton>
        </NDropdown>
      </TooltipTitle>
    </div>

    <!-- Drag ghost -->
    <div
      v-if="dragGhost"
      class="v2-glass-float will-change-transform pointer-events-none fixed z-50 flex h-7 items-center gap-1.5 rounded-[6px] px-2 text-[12px] opacity-95"
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
