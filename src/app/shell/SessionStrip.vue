<script setup lang="ts">
import {
  AddOutline,
  CloseOutline,
  DuplicateOutline,
  EllipsisHorizontalOutline,
  ReorderTwoOutline,
  TerminalOutline,
} from "@vicons/ionicons5";
import { NDropdown, NIcon, type DropdownOption } from "naive-ui";
import { computed, h, nextTick, onBeforeUnmount, ref, watch, type VNode } from "vue";
import { fileIconUrl, shellIconUrl } from "@/modules/icons";
import { tabLabel } from "@/modules/tabs/tabLabel";
import { t } from "@/modules/i18n/translate";
import { IS_WINDOWS } from "@/lib/platform";
import {
  usePointerDragReorder,
  type DragPlacement,
} from "@/lib/usePointerDragReorder";
import NextermIconButton from "@/components/NextermIconButton.vue";
import TooltipTitle from "@/components/TooltipTitle.vue";
import type { Tab, TerminalTab } from "@/modules/tabs/tabsTypes";
import type { TabWidthMode } from "@/modules/settings/store";
import type { SplitDir } from "@/modules/terminal/lib/layout";
import TabContextMenu, {
  type TabContextMenuTarget,
} from "./TabContextMenu.vue";
import { startWindowDrag } from "./useWindowDrag";

const props = defineProps<{
  tabs: Tab[];
  activeId: number;
  widthMode: TabWidthMode;
  fixedWidth: number;
  /** 工作区环境：只有 local 能确定终端用的 shell，WSL / SSH 走通用终端图标。 */
  envKind?: "local" | "wsl" | "ssh";
  /** 本地终端的 shell profile id（"auto" 表示后端默认顺序）。 */
  shellId?: string;
  /** 当前标签能否分屏（只对终端 tab 成立）。 */
  canSplit: boolean;
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
  newTerminal: [];
  splitPane: [dir: SplitDir];
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

/**
 * 终端标签的 shell 图标（PowerShell / Bash …）。
 *
 * 只有本地工作区能确定 shell（`shellId` 来自终端偏好）；WSL / SSH 的登录
 * shell 前端无从得知，返回空串 → 标签回落到通用终端图标。
 */
const terminalShellIcon = computed(() => {
  if (props.envKind !== "local") return "";
  return shellIconUrl(props.shellId ?? "", IS_WINDOWS ? "windows" : "unix");
});

function tabWidthStyle(): Record<string, string> | undefined {
  if (props.widthMode !== "fixed") return undefined;
  return { width: `${Math.round(props.fixedWidth)}px` };
}

function tabWidthClass(): string {
  // 自适应模式不再拉伸填满整行（flex-[1_1_8rem] 会把标签拉得又宽又空），
  // 改成「按内容 + 封顶」：短标签短、长标签到上限就截断。
  return props.widthMode === "fixed" ? "flex-none" : "max-w-56";
}

/**
 * 标签的形状 —— 极简模式的 cwd chip 与完整模式的标签**共用同一套**。
 *
 * 之前两者各写各的：chip 是一枚填充底色的圆角胶囊，标签是另一套形状与配色。
 * 单终端 ↔ 多标签切换时整行会跳变。
 *
 * 圆角取全局基准档的 rounded-md（8px）：胶囊太圆（看起来像一颗药丸），
 * 顶部切角太锐。用主色实心填充更糟 —— 高饱和的色块在深色主题下刺眼。
 * 激活用**中性底色 + 顶部一条主色条**，主色只做点缀。
 */
const TAB_SHAPE_CLASS =
  "group relative flex h-7 min-w-[6rem] items-center justify-between gap-1.5 rounded-md px-3 text-left text-[12px] transition-[background-color,color,opacity] duration-[var(--dur-fast)]";
const TAB_ACTIVE_CLASS = "bg-accent text-foreground";
const TAB_IDLE_CLASS =
  "text-muted-foreground hover:bg-surface-hover hover:text-foreground";

// ── 标签行动作区：新建终端 / 分屏 ───────────────────────────────────────
// 这两个都是「针对当前标签」的操作，放在顶栏右端既占地方又离上下文远，
// 挪到标签行末尾（JetBrains 的位置）。

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

// ── 溢出菜单 ────────────────────────────────────────────────────────────
// 标签溢出时不再用左右翻页箭头（占地方、且在窄行里互相挤压），
// 改成行尾一个「⋯」下拉：直接列出全部标签，点一下就跳过去。

/** 溢出菜单里的标签图标：文件类用真实文件图标，其余用类型图标。 */
function tabIconVNode(tab: Tab): VNode {
  if (tab.kind === "editor" || tab.kind === "markdown") {
    return h("img", {
      src: fileIconUrl(tab.title),
      alt: "",
      class: "size-3.5 nexterm-file-icon",
    });
  }
  if (tab.kind === "terminal" && terminalShellIcon.value) {
    return h("img", {
      src: terminalShellIcon.value,
      alt: "",
      class: "size-3.5 nexterm-file-icon",
    });
  }
  return h(NIcon, { component: TerminalOutline, size: 12 });
}

const overflowOptions = computed(() =>
  props.tabs.map((tab) => ({
    key: tab.id,
    label: tabLabel(tab),
    icon: () => tabIconVNode(tab),
  })),
);

function handleOverflowSelect(key: string | number) {
  const id = Number(key);
  if (!Number.isFinite(id)) return;
  emit("selectTab", id);
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
    class="flex h-9 min-w-0 shrink-0 items-center border-b border-border bg-title-bar"
    data-session-strip
  >
    <!-- 极简模式:单终端面包屑（形状与配色与完整标签完全一致） -->
    <button
      v-if="minimalTab"
      type="button"
      data-session-minimal
      :title="minimalTab.cwd ?? tabLabel(minimalTab)"
      :class="[TAB_SHAPE_CLASS, 'max-w-64', TAB_ACTIVE_CLASS]"
      @click="emit('selectTab', minimalTab.id)"
      @contextmenu.prevent="handleTabContextMenu($event, minimalTab)"
    >
      <!-- 激活指示：顶部一条主色条（主色只做点缀，不填色块） -->
      <span
        data-tab-active-indicator
        aria-hidden="true"
        class="v2-anim-underline absolute inset-x-1 top-0 h-0.5 rounded-full bg-primary"
      />
      <NIcon :component="TerminalOutline" :size="13" class="shrink-0 text-primary" />
      <span class="flex min-w-0 flex-1 items-center gap-1.5">
        <span class="min-w-0 truncate">{{ tabLabel(minimalTab) }}</span>
        <span
          v-if="minimalTab.terminalTitle"
          class="min-w-0 truncate text-[11px] text-muted-foreground"
        >{{ minimalTab.cwd }}</span>
      </span>
    </button>

    <!-- 完整会话条 -->
    <template v-else>
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
                TAB_SHAPE_CLASS,
                tabWidthClass(),
                draggingTabId === tab.id ? 'opacity-60' : '',
                // 插入条落在胶囊**间隙**里（-left-1），不压在圆角弧线上。
                dropTarget?.id === tab.id && dropTarget.placement === 'before'
                  ? 'before:absolute before:inset-y-2 before:-left-1 before:w-[3px] before:rounded-full before:bg-primary'
                  : '',
                dropTarget?.id === tab.id && dropTarget.placement === 'after'
                  ? 'after:absolute after:inset-y-2 after:-right-1 after:w-[3px] after:rounded-full after:bg-primary'
                  : '',
                tab.id === activeId ? TAB_ACTIVE_CLASS : TAB_IDLE_CLASS,
              ]"
              @click="handleTabClick(tab)"
              @dblclick="pinPreviewTab(tab)"
              @contextmenu.prevent="handleTabContextMenu($event, tab)"
              @pointerdown="handleTabPointerDown($event, tab)"
            >
              <!-- 激活指示：顶部一条主色条（主色只做点缀，不填色块） -->
              <span
                v-if="tab.id === activeId"
                data-tab-active-indicator
                aria-hidden="true"
                class="v2-anim-underline absolute inset-x-1 top-0 h-0.5 rounded-full bg-primary"
              />
              <span class="flex min-w-0 flex-1 items-center gap-1.5">
                <img
                  v-if="tab.kind === 'editor' || tab.kind === 'markdown'"
                  v-memo="[tab.kind, tab.title]"
                  :src="fileIconUrl(tab.title)"
                  alt=""
                  class="size-3.5 shrink-0 nexterm-file-icon"
                />
                <img
                  v-else-if="tab.kind === 'terminal' && terminalShellIcon"
                  :src="terminalShellIcon"
                  alt=""
                  data-terminal-shell-icon
                  class="size-3.5 shrink-0 nexterm-file-icon"
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
                  :class="[
                    tab.kind === 'editor' && tab.preview ? 'italic' : '',
                    tab.id === activeId ? '' : 'text-muted-foreground',
                  ]"
                >
                  {{ tabLabel(tab) }}
                </span>
                <span
                  v-if="tab.kind === 'editor' && tab.dirty"
                  class="size-1.5 shrink-0 rounded-full bg-primary"
                />
              </span>
              <!--
                关闭按钮不能只靠 hover 出现：
                激活标签常显（淡一点），非激活标签 hover / 键盘聚焦时显现，
                触屏（无 hover 能力的指针）直接常显。
              -->
              <span
                role="button"
                tabindex="-1"
                class="grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground transition-all duration-[var(--dur-fast)] hover:bg-destructive/15 hover:text-destructive"
                :class="
                  tab.id === activeId
                    ? 'opacity-70 group-hover:opacity-100'
                    : 'opacity-0 group-hover:opacity-60 group-focus-within:opacity-100 [@media(hover:none)]:opacity-60'
                "
                @click.stop="emit('closeTab', tab.id)"
                @pointerdown.stop
              >
                <NIcon :component="CloseOutline" :size="11" />
              </span>
            </button>
          </TransitionGroup>
        </div>
      </div>
      <!-- 溢出菜单：标签超出时在行尾给出入口 -->
      <NDropdown
        v-if="scrollEdges.right"
        trigger="click"
        :options="overflowOptions"
        @select="handleOverflowSelect"
      >
        <button
          type="button"
          data-strip-overflow
          :aria-label="t('app.header.allTabs')"
          :title="t('app.header.allTabs')"
          class="flex h-8 w-8 flex-none items-center justify-center rounded-md text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:bg-surface-hover hover:text-foreground"
        >
          <NIcon :component="EllipsisHorizontalOutline" :size="14" />
        </button>
      </NDropdown>
    </template>

    <!-- 拖拽区:会话条之后的空白带 -->
    <div
      data-window-drag-region
      class="h-8 min-w-2 flex-1"
      @pointerdown="startWindowDrag"
    />

    <!--
      标签行动作区：新建终端 / 分屏。
      两者都针对「当前标签」，放在标签行末尾比挤在顶栏右端更贴上下文，
      顶栏也因此腾出空间。
    -->
    <div class="ml-1 flex shrink-0 items-center gap-0.5">
      <TooltipTitle :label="t('app.header.newTerminal')">
        <NextermIconButton
          data-new-terminal
          :aria-label="t('app.header.newTerminal')"
          @click="emit('newTerminal')"
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
            data-split-terminal
            :disabled="!canSplit"
            :aria-label="t('app.header.splitActions')"
          >
            <NIcon :component="DuplicateOutline" :size="14" />
          </NextermIconButton>
        </NDropdown>
      </TooltipTitle>
    </div>

    <!-- Drag ghost -->
    <div
      v-if="tabGhost"
      class="v2-glass-float will-change-transform pointer-events-none fixed z-50 flex h-7 items-center gap-1.5 rounded-md px-3 text-[12px] opacity-95"
      :style="{
        width: `${tabGhost.width}px`,
        transform: `translate3d(${tabGhost.x}px, ${tabGhost.y}px, 0) translate(-50%, -50%)`,
      }"
    >
      <img
        v-if="tabGhost.item.kind === 'editor' || tabGhost.item.kind === 'markdown'"
        :src="fileIconUrl(tabGhost.item.title)"
        alt=""
        class="size-3.5 shrink-0 nexterm-file-icon"
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
