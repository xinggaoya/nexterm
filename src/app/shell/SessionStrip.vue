<script setup lang="ts">
import {
  ChevronBackOutline,
  ChevronForwardOutline,
  CloseOutline,
  DuplicateOutline,
  TerminalOutline,
} from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import { tabLabel } from "@/modules/tabs/tabLabel";
import { t } from "@/modules/i18n/translate";
import {
  usePointerDragReorder,
  type DragPlacement,
} from "@/lib/usePointerDragReorder";
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
  reorderTab: [sourceId: number, targetId: number, placement: DragPlacement];
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

// ── Drag-to-reorder ────────────────────────────────────────────────────
// 手势本体在 `usePointerDragReorder`（与 Sidebar 的工作区重排、explorer
// 的文件搬运共用）；这里只负责标签行的 selector、中线二分与 ghost 宽度。

function tabDragTarget(clientX: number, clientY: number) {
  const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-tab-id]") ?? null;
  if (!el) return null;
  const id = Number(el.dataset.tabId);
  if (!Number.isFinite(id)) return null;
  return { id, el };
}

// ghost 宽度向可读区间钳制：固定宽度模式跟随设定值，自适应模式封顶 224px，
// 否则超宽标签的 ghost 会遮住大半条会话条。
function clampGhostWidth(measured: number): number {
  if (props.widthMode !== "fixed") return Math.min(224, Math.max(104, measured));
  const cap = Math.max(104, props.fixedWidth);
  const floor = Math.min(104, props.fixedWidth);
  return Math.min(cap, Math.max(floor, measured));
}

const tabDrag = usePointerDragReorder<Tab, number>({
  enabled: () => props.tabs.length > 1,
  resolveTarget: (x, y) => tabDragTarget(x, y),
  resolveGhost: (id) => props.tabs.find((tab) => tab.id === id) ?? null,
  ghostWidth: clampGhostWidth,
  onDrop: (sourceId, targetId, placement) =>
    emit("reorderTab", sourceId, targetId, placement),
});

const draggingTabId = tabDrag.draggingId;
const dropTarget = tabDrag.dropTarget;
const tabGhost = tabDrag.ghost;

function handleTabPointerDown(e: PointerEvent, tab: Tab) {
  tabDrag.startDrag(e, tab.id);
}

function handleTabClick(tab: Tab) {
  if (tabDrag.consumeSuppressedClick(tab.id)) return;
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

// ── 溢出滚动:滚轮横滚 + 激活标签自动滚入 + 左右翻页按钮 ────────────────
// 会话条随标签增多必然溢出,而标题栏里不适合出现原生滚动条,
// 因此提供三条互补的可见/不可见通道,保证后续标签始终可达。

const stripScroller = ref<HTMLElement | null>(null);
const scrollEdges = ref({ left: false, right: false });

function updateScrollEdges() {
  const el = stripScroller.value;
  if (!el) return;
  const maxScroll = el.scrollWidth - el.clientWidth;
  scrollEdges.value = {
    left: el.scrollLeft > 1,
    right: el.scrollLeft < maxScroll - 1,
  };
}

// 鼠标竖向滚轮转为横向滚动(已溢出时才拦截,不劫持无关滚动)。
// 滚动容器随极简/完整模式挂载卸载,wheel 需非 passive,直接由模板绑定。
function handleStripWheel(e: WheelEvent) {
  const el = stripScroller.value;
  if (!el || el.scrollWidth <= el.clientWidth) return;
  const delta = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (!delta) return;
  e.preventDefault();
  el.scrollLeft += delta;
}

function scrollStripBy(direction: -1 | 1) {
  const el = stripScroller.value;
  if (!el || typeof el.scrollBy !== "function") return;
  el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
}

// 切换/新建/重排标签后把激活标签滚回可视区。
watch(
  [() => props.activeId, () => props.tabs.map((tab) => tab.id).join("|")],
  () => {
    nextTick(() => {
      const active = stripScroller.value?.querySelector<HTMLElement>(
        `[data-tab-id="${props.activeId}"]`,
      );
      if (!active || typeof active.scrollIntoView !== "function") return;
      active.scrollIntoView({ block: "nearest", inline: "nearest" });
      updateScrollEdges();
    });
  },
  { immediate: true },
);

// 会话条或标签内容尺寸变化时刷新翻页按钮的可见性。
let stripResizeObserver: ResizeObserver | null = null;

watch(
  stripScroller,
  (el) => {
    stripResizeObserver?.disconnect();
    stripResizeObserver = null;
    updateScrollEdges();
    if (el && typeof ResizeObserver === "function") {
      stripResizeObserver = new ResizeObserver(updateScrollEdges);
      stripResizeObserver.observe(el);
      if (el.firstElementChild) stripResizeObserver.observe(el.firstElementChild);
    }
  },
  { flush: "post" },
);

onBeforeUnmount(() => {
  stripResizeObserver?.disconnect();
  stripResizeObserver = null;
});
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
      <button
        v-if="scrollEdges.left"
        type="button"
        data-strip-scroll-left
        :aria-label="t('app.header.scrollTabsLeft')"
        :title="t('app.header.scrollTabsLeft')"
        class="flex h-7 w-5 flex-none items-center justify-center rounded-full text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:bg-surface-hover hover:text-foreground"
        @click="scrollStripBy(-1)"
      >
        <NIcon :component="ChevronBackOutline" :size="13" />
      </button>
      <div
        ref="stripScroller"
        data-strip-scroller
        class="no-scrollbar min-w-0 flex-[1_1_auto] overflow-x-auto"
        @scroll.passive="updateScrollEdges"
        @wheel="handleStripWheel"
      >
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
      <button
        v-if="scrollEdges.right"
        type="button"
        data-strip-scroll-right
        :aria-label="t('app.header.scrollTabsRight')"
        :title="t('app.header.scrollTabsRight')"
        class="flex h-7 w-5 flex-none items-center justify-center rounded-full text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:bg-surface-hover hover:text-foreground"
        @click="scrollStripBy(1)"
      >
        <NIcon :component="ChevronForwardOutline" :size="13" />
      </button>
    </template>

    <!-- 拖拽区:会话条之后的空白带 -->
    <div
      data-window-drag-region
      class="h-8 min-w-2 flex-1"
      @pointerdown="startWindowDrag"
    />

    <!-- Drag ghost -->
    <div
      v-if="tabGhost"
      class="v2-glass-float will-change-transform pointer-events-none fixed z-50 flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] opacity-95"
      :style="{
        width: `${tabGhost.width}px`,
        transform: `translate3d(${tabGhost.x}px, ${tabGhost.y}px, 0) translate(-50%, -50%)`,
      }"
    >
      <img
        v-if="tabGhost.item.kind === 'editor' || tabGhost.item.kind === 'markdown'"
        :src="fileIconUrl(tabGhost.item.title)"
        alt=""
        class="size-3.5 shrink-0"
      />
      <NIcon
        v-else-if="tabGhost.item.kind === 'terminal'"
        :component="DuplicateOutline"
        :size="12"
      />
      <span class="min-w-0 truncate">{{ tabLabel(tabGhost.item) }}</span>
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
