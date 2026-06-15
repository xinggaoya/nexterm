<script setup lang="ts">
import {
  CloseOutline,
  DuplicateOutline,
  AddOutline,
  ReorderTwoOutline,
} from "@vicons/ionicons5";
import { NDropdown, NIcon, type DropdownOption } from "naive-ui";
import { computed, h, onBeforeUnmount, ref, type VNode } from "vue";
import TooltipTitle from "@/components/TooltipTitle.vue";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import { tabLabel } from "@/modules/tabs/tabLabel";
import { t } from "@/modules/i18n/translate";
import type { TabDropPlacement } from "@/modules/tabs/tabsReorder";
import type { Tab } from "@/modules/tabs/tabsTypes";
import type { SplitDir } from "@/modules/terminal/lib/panes";

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
}>();



function tabKindLabel(tab: Tab): string {
  if (tab.kind === "terminal") return t("app.header.terminal");
  if (tab.kind === "git-history") return t("app.header.gitHistory");
  if (tab.kind === "git-diff" || tab.kind === "git-commit-file") return t("app.header.gitDiff");
  if (tab.kind === "markdown") return t("app.header.markdown");
  if (tab.kind === "preview") return t("app.header.preview");
  return t("settings.general.editor");
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

function updateDragGhost(e: PointerEvent, drag: PointerDragState) {
  const tab = props.tabs.find((t) => t.id === drag.sourceId);
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
  <div class="flex h-9 shrink-0 items-center border-b border-border/30 bg-title-bar">
    <div class="no-scrollbar min-w-0 flex-1 overflow-x-auto">
      <div class="flex min-w-full items-center gap-0.5 px-1">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          :data-tab-id="tab.id"
          :aria-grabbed="draggingTabId === tab.id"
          :title="`${tabKindLabel(tab)}: ${tabLabel(tab)}`"
          :class="[
            'group relative flex min-w-[5rem] max-w-48 flex-[1_1_8rem] items-center justify-between gap-1.5 rounded-md px-2 py-1 text-left text-[12px] transition-[background-color,color,opacity]',
            draggingTabId === tab.id ? 'opacity-60' : '',
            dropTarget?.id === tab.id && dropTarget.placement === 'before'
              ? 'before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-primary'
              : '',
            dropTarget?.id === tab.id && dropTarget.placement === 'after'
              ? 'after:absolute after:inset-y-1 after:right-0 after:w-0.5 after:rounded-full after:bg-primary'
              : '',
            tab.id === activeId
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
          ]"
          @click="handleTabClick(tab)"
          @dblclick="pinPreviewTab(tab)"
          @pointerdown="handleTabPointerDown($event, tab)"
        >
          <span class="flex min-w-0 flex-1 items-center gap-1.5 truncate">
            <img
              v-if="tab.kind === 'editor' || tab.kind === 'markdown'"
              :src="fileIconUrl(tab.title)"
              alt=""
              class="size-3.5 shrink-0"
            />
            <span
              class="min-w-0 truncate"
              :class="tab.kind === 'editor' && tab.preview ? 'italic' : ''"
            >
              {{ tabLabel(tab) }}
            </span>
            <span
              v-if="tab.kind === 'editor' && tab.dirty"
              class="size-1.5 shrink-0 rounded-full bg-foreground/70"
            />
          </span>
          <TooltipTitle v-if="tabs.length > 1" :label="t('app.header.closeTab')">
            <span
              role="button"
              tabindex="-1"
              class="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground group-hover:opacity-70 group-hover:hover:opacity-100"
              @click.stop="emit('closeTab', tab.id)"
              @pointerdown.stop
            >
              <NIcon :component="CloseOutline" :size="11" />
            </span>
          </TooltipTitle>
        </button>

        <div
          data-window-drag-region
          class="h-6 min-w-4 flex-1"
        />
      </div>
    </div>

    <div v-if="showActions" class="flex shrink-0 items-center gap-0.5 pr-1.5">
      <TooltipTitle :label="t('app.header.newTerminal')">
        <button
          type="button"
          data-new-tab
          class="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
          @click="emit('newTab')"
        >
          <NIcon :component="AddOutline" :size="14" />
        </button>
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
          <button
            type="button"
            class="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!canSplit"
          >
            <NIcon :component="DuplicateOutline" :size="14" />
          </button>
        </NDropdown>
      </TooltipTitle>
    </div>

    <!-- Drag ghost -->
    <div
      v-if="dragGhost"
      class="pointer-events-none fixed z-50 flex h-7 items-center gap-1.5 rounded-md border border-border/70 bg-card px-2 text-[12px] text-foreground opacity-95 shadow-lg"
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
  </div>
</template>
