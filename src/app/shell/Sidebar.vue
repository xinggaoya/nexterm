<script setup lang="ts">
import {
  AddOutline,
  ChevronBackOutline,
  ChevronForwardOutline,
  CloseOutline,
  OpenOutline,
  SearchOutline,
  ServerOutline,
  SettingsOutline,
  TerminalOutline,
} from "@vicons/ionicons5";
import { NDropdown, NIcon, type DropdownOption } from "naive-ui";
import { computed, h, onBeforeUnmount, ref, watch } from "vue";
import TooltipTitle from "@/components/TooltipTitle.vue";
import { fmtShortcut, IS_WINDOWS, MOD_KEY } from "@/lib/platform";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import { t } from "@/modules/i18n/translate";
import type { TabDropPlacement } from "@/modules/tabs/tabsReorder";
import {
  LOCAL_WORKSPACE,
  type WorkspaceEnv,
  type WorkspaceInstance,
} from "@/modules/workspace";
import { useWorkspaceEnvPiniaStore } from "@/modules/workspace/workspaceEnvPinia";

/**
 * 全局侧栏(参考 MonoCode 的双列左侧结构):顶部搜索位(⌘K 命令面板)、
 * 工作区分区(每行 monogram 图标 + 名称 + env 图标)、底部设置入口。
 * 可折叠为 52px 轨道(仅芯片 + 添加 + 设置)。
 */
const props = defineProps<{
  workspaces: WorkspaceInstance[];
  activeWorkspaceId: string | null;
  collapsed: boolean;
}>();

const emit = defineEmits<{
  "select-workspace": [id: string];
  "close-workspace": [id: string];
  "add-workspace": [env: WorkspaceEnv];
  "open-workspace-in-new-window": [id: string];
  "reorder-workspace": [sourceId: string, targetId: string, placement: TabDropPlacement];
  "open-settings": [];
  "open-command-palette": [];
  "toggle-collapse": [];
}>();

const workspaceEnv = useWorkspaceEnvPiniaStore();

const shortcutLabel = `${fmtShortcut(MOD_KEY, "K")}`;

// ── 添加工作区菜单:本机 + WSL distro + SSH ─────────────────────────────
const showWsl = computed(() => IS_WINDOWS && workspaceEnv.distros.length > 0);
const addMenuOptions = computed<DropdownOption[]>(() => {
  const options: DropdownOption[] = [
    { key: "local", label: t("app.workspaceBar.addLocal") },
  ];
  if (showWsl.value) {
    const distros = workspaceEnv.distros;
    if (distros.length === 1) {
      options.push({
        key: `wsl:${distros[0]?.name ?? ""}`,
        label: `${t("app.workspaceBar.addWsl")} · ${distros[0]?.name ?? ""}`,
      });
    } else {
      options.push({
        key: "wsl",
        label: t("app.workspaceBar.addWsl"),
        children: distros.map((distro) => ({
          key: `wsl:${distro.name}`,
          label: distro.name,
        })),
      });
    }
  }
  options.push({ key: "ssh", label: t("app.workspaceBar.addSsh") });
  return options;
});

function handleAddSelect(key: string | number) {
  const value = String(key);
  if (value === "local") {
    emit("add-workspace", LOCAL_WORKSPACE);
    return;
  }
  if (value === "ssh") {
    emit("add-workspace", { kind: "ssh", profileId: "new" });
    return;
  }
  if (value.startsWith("wsl:")) {
    const distro = value.slice(4);
    if (distro) emit("add-workspace", { kind: "wsl", distro });
  }
}

// 侧栏是常驻 UI,挂载即刷新 WSL distro 列表(失败静默)。
watch(
  () => IS_WINDOWS && hasTauriInternals(),
  (needed) => {
    if (needed) void workspaceEnv.refreshDistros();
  },
  { immediate: true },
);

// ── 工作区行 ────────────────────────────────────────────────────────────
// MonoCode 风格:每个项目一枚彩色小图标。这里用工作区 id 稳定散列到
// chart 色板上,monogram 底色/前景同色系,像"项目 emoji"一样可辨。
const MONOGRAM_HUES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

function hueOf(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return MONOGRAM_HUES[Math.abs(hash) % MONOGRAM_HUES.length]!;
}

function monogramStyle(id: string): Record<string, string> {
  const hue = hueOf(id);
  return {
    color: hue,
    backgroundColor: `color-mix(in oklch, ${hue} 18%, transparent)`,
  };
}

function monogramOf(workspace: WorkspaceInstance): string {
  return (workspace.name.trim()[0] ?? "?").toUpperCase();
}

type EnvBadge = "wsl" | "ssh" | null;

function envBadgeOf(workspace: WorkspaceInstance): EnvBadge {
  if (workspace.env.kind === "wsl") return "wsl";
  if (workspace.env.kind === "ssh") return "ssh";
  return null;
}

function envIconOf(workspace: WorkspaceInstance) {
  return envBadgeOf(workspace) === "ssh" ? TerminalOutline : ServerOutline;
}

function rowTitle(workspace: WorkspaceInstance): string {
  const envLabel =
    workspace.env.kind === "wsl"
      ? `WSL · ${workspace.env.distro}`
      : workspace.env.kind === "ssh"
        ? "SSH"
        : t("app.rail.envLocal");
  return `${workspace.name}\n${workspace.rootPath}\n${envLabel}`;
}

// ── 拖拽排序(移植自 SessionStrip,竖向版)───────────────────────────────
// 展开行(data-workspace-row)与折叠芯片(data-workspace-chip)共用同一套
// 指针手势:阈值判定 → ghost 跟随 → 目标行上/下半区决定 before/after。

type PointerDragState = {
  sourceId: string;
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
};

const DRAG_THRESHOLD = 6;
const draggingWorkspaceId = ref<string | null>(null);
const dropTarget = ref<{ id: string; placement: TabDropPlacement } | null>(null);
const pointerDrag = ref<PointerDragState | null>(null);
const suppressedClickWorkspaceId = ref<string | null>(null);
const dragGhost = ref<{ workspace: WorkspaceInstance; x: number; y: number } | null>(null);

function clearDragState() {
  draggingWorkspaceId.value = null;
  dropTarget.value = null;
  pointerDrag.value = null;
  dragGhost.value = null;
}

function workspaceElementFromPoint(x: number, y: number): HTMLElement | null {
  return (
    document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-workspace-row],[data-workspace-chip]") ?? null
  );
}

function workspaceIdFromElement(el: HTMLElement): string | null {
  return el.dataset.workspaceRow ?? el.dataset.workspaceChip ?? null;
}

function dropPlacementFromElement(clientY: number, el: HTMLElement): TabDropPlacement {
  const rect = el.getBoundingClientRect();
  return clientY < rect.top + rect.height / 2 ? "before" : "after";
}

function updateDropTarget(e: PointerEvent) {
  const drag = pointerDrag.value;
  if (!drag) return;
  const el = workspaceElementFromPoint(e.clientX, e.clientY);
  if (!el) { dropTarget.value = null; return; }
  const id = workspaceIdFromElement(el);
  if (!id || id === drag.sourceId) { dropTarget.value = null; return; }
  dropTarget.value = { id, placement: dropPlacementFromElement(e.clientY, el) };
}

function updateDragGhost(e: PointerEvent, drag: PointerDragState) {
  const workspace = props.workspaces.find((ws) => ws.id === drag.sourceId);
  if (!workspace) { dragGhost.value = null; return; }
  dragGhost.value = { workspace, x: e.clientX, y: e.clientY };
}

function handleWindowPointerMove(e: PointerEvent) {
  const drag = pointerDrag.value;
  if (!drag || drag.pointerId !== e.pointerId) return;
  const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
  if (!drag.dragging && dist < DRAG_THRESHOLD) return;
  e.preventDefault();
  if (!drag.dragging) {
    drag.dragging = true;
    draggingWorkspaceId.value = drag.sourceId;
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
    suppressedClickWorkspaceId.value = sourceId;
    window.setTimeout(() => { if (suppressedClickWorkspaceId.value === sourceId) suppressedClickWorkspaceId.value = null; }, 400);
    if (target && target.id !== sourceId) {
      emit("reorder-workspace", sourceId, target.id, target.placement);
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

function handleItemPointerDown(e: PointerEvent, workspace: WorkspaceInstance) {
  if (props.workspaces.length <= 1 || e.button !== 0) return;
  e.stopPropagation();
  removePointerListeners();
  pointerDrag.value = {
    sourceId: workspace.id,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    dragging: false,
  };
  addPointerListeners();
}

function handleItemClick(workspace: WorkspaceInstance) {
  if (suppressedClickWorkspaceId.value === workspace.id) {
    suppressedClickWorkspaceId.value = null;
    return;
  }
  emit("select-workspace", workspace.id);
}

// 落点指示器:目标行上缘(before)/下缘(after)一条 2px 主色横线。
// 展开行挂在包装 div 上,折叠芯片挂在按钮自身上,两者都已 position:relative。
function dropIndicatorClass(id: string): string {
  const target = dropTarget.value;
  if (!target || target.id !== id) return "";
  return target.placement === "before"
    ? "before:absolute before:inset-x-1.5 before:top-0 before:h-0.5 before:rounded-full before:bg-primary"
    : "before:absolute before:inset-x-1.5 before:bottom-0 before:h-0.5 before:rounded-full before:bg-primary";
}

onBeforeUnmount(removePointerListeners);

// ── 工作区行右键菜单 ────────────────────────────────────────────────────
const rowMenu = ref<{ x: number; y: number; id: string } | null>(null);
const rowMenuOptions = computed<DropdownOption[]>(() => [
  {
    key: "new-window",
    label: t("app.rail.openInNewWindow"),
    icon: () => h(NIcon, { component: OpenOutline, size: 13 }),
  },
  { key: "close", label: t("app.rail.closeWorkspace") },
]);

function handleRowContextMenu(event: MouseEvent, workspace: WorkspaceInstance) {
  event.preventDefault();
  rowMenu.value = { x: event.clientX, y: event.clientY, id: workspace.id };
}

function handleRowMenuSelect(key: string | number) {
  const id = rowMenu.value?.id;
  rowMenu.value = null;
  if (!id) return;
  if (key === "new-window") emit("open-workspace-in-new-window", id);
  if (key === "close") emit("close-workspace", id);
}
</script>

<template>
  <!-- 折叠态:52px 轨道,仅芯片 + 添加 + 设置 -->
  <nav
    v-if="collapsed"
    class="flex h-full w-[52px] shrink-0 flex-col items-center border-r border-border bg-sidebar py-2"
    data-sidebar
    data-sidebar-collapsed
    aria-label="Workspaces"
  >
    <div class="flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto no-scrollbar pt-1">
      <TooltipTitle
        v-for="workspace in workspaces"
        :key="workspace.id"
        :label="rowTitle(workspace)"
      >
        <button
          type="button"
          :data-workspace-chip="workspace.id"
          :aria-pressed="workspace.id === activeWorkspaceId"
          :aria-grabbed="draggingWorkspaceId === workspace.id"
          :title="rowTitle(workspace)"
          class="relative grid size-9 shrink-0 place-items-center rounded-xl text-[13px] font-semibold transition-all duration-[var(--dur-fast)]"
          :class="[
            dropIndicatorClass(workspace.id),
            draggingWorkspaceId === workspace.id ? 'opacity-60' : '',
            workspace.id === activeWorkspaceId
              ? 'bg-primary text-primary-foreground shadow-[0_0_0_1px_var(--border)]'
              : 'bg-surface-hover text-muted-foreground hover:text-foreground',
          ]"
          @click="handleItemClick(workspace)"
          @contextmenu="handleRowContextMenu($event, workspace)"
          @auxclick.middle.prevent="emit('close-workspace', workspace.id)"
          @pointerdown="handleItemPointerDown($event, workspace)"
        >
          {{ monogramOf(workspace) }}
          <span
            v-if="envBadgeOf(workspace)"
            class="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-sidebar"
            :class="envBadgeOf(workspace) === 'wsl' ? 'bg-info' : 'bg-warning'"
          />
        </button>
      </TooltipTitle>

      <NDropdown
        trigger="click"
        placement="right-start"
        :options="addMenuOptions"
        @select="handleAddSelect"
      >
        <button
          type="button"
          data-add-workspace
          :title="t('app.rail.addWorkspace')"
          :aria-label="t('app.rail.addWorkspace')"
          class="grid size-9 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:bg-surface-hover hover:text-foreground"
        >
          <NIcon :component="AddOutline" :size="16" />
        </button>
      </NDropdown>
    </div>

    <div class="v2-hairline my-2 h-px w-7 border-t" />

    <TooltipTitle :label="t('app.sidebar.expand')">
      <button
        type="button"
        data-sidebar-expand
        :title="t('app.sidebar.expand')"
        :aria-label="t('app.sidebar.expand')"
        class="grid size-9 place-items-center rounded-xl text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:bg-surface-hover hover:text-foreground"
        @click="emit('toggle-collapse')"
      >
        <NIcon :component="ChevronForwardOutline" :size="15" />
      </button>
    </TooltipTitle>

    <TooltipTitle :label="t('common.settings')">
      <button
        type="button"
        data-open-settings
        :title="t('common.settings')"
        :aria-label="t('common.settings')"
        class="grid size-9 place-items-center rounded-xl text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:bg-surface-hover hover:text-foreground"
        @click="emit('open-settings')"
      >
        <NIcon :component="SettingsOutline" :size="15" />
      </button>
    </TooltipTitle>

    <NDropdown
      trigger="manual"
      :show="rowMenu !== null"
      :x="rowMenu?.x ?? 0"
      :y="rowMenu?.y ?? 0"
      placement="right-start"
      :options="rowMenuOptions"
      @clickoutside="rowMenu = null"
      @select="handleRowMenuSelect"
    />
  </nav>

  <!-- 展开态:全局侧栏 -->
  <nav
    v-else
    class="flex h-full w-[248px] shrink-0 flex-col border-r border-border bg-sidebar"
    data-sidebar
    aria-label="Workspaces"
  >
    <!-- 顶部:应用标识 + 折叠 -->
    <div class="flex h-11 shrink-0 items-center gap-2 px-3">
      <span class="v2-dot-glow v2-anim-breathe size-2 shrink-0 rounded-full bg-primary" />
      <span class="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight text-foreground">Nexterm</span>
      <TooltipTitle :label="t('app.sidebar.collapse')">
        <button
          type="button"
          data-sidebar-collapse
          :title="t('app.sidebar.collapse')"
          :aria-label="t('app.sidebar.collapse')"
          class="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:bg-surface-hover hover:text-foreground"
          @click="emit('toggle-collapse')"
        >
          <NIcon :component="ChevronBackOutline" :size="13" />
        </button>
      </TooltipTitle>
    </div>

    <!-- 搜索位(命令面板) -->
    <div class="px-3 pb-2">
      <button
        type="button"
        data-sidebar-search
        class="flex h-8 w-full items-center gap-2 rounded-lg border border-border/70 bg-surface-subtle px-2.5 text-[12px] text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:border-primary/30 hover:text-foreground"
        @click="emit('open-command-palette')"
      >
        <NIcon :component="SearchOutline" :size="13" />
        <span class="min-w-0 flex-1 truncate text-left">{{ t("app.sidebar.search") }}</span>
        <kbd
          class="rounded border border-border/70 bg-background px-1 font-sans text-[10px] leading-4 text-muted-foreground"
        >{{ shortcutLabel }}</kbd>
      </button>
    </div>

    <!-- 工作区分区 -->
    <div class="flex min-h-0 flex-1 flex-col px-2">
      <div class="flex h-7 shrink-0 items-center gap-1 px-1.5">
        <span class="min-w-0 flex-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          {{ t("app.titleBar.workspaces") }}
        </span>
        <NDropdown
          trigger="click"
          placement="bottom-start"
          :options="addMenuOptions"
          @select="handleAddSelect"
        >
          <button
            type="button"
            data-add-workspace
            :title="t('app.rail.addWorkspace')"
            :aria-label="t('app.rail.addWorkspace')"
            class="grid size-5 place-items-center rounded-md text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:bg-surface-hover hover:text-foreground"
          >
            <NIcon :component="AddOutline" :size="12" />
          </button>
        </NDropdown>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto no-scrollbar pb-1">
        <div
          v-for="workspace in workspaces"
          :key="workspace.id"
          class="group/row relative"
          :class="dropIndicatorClass(workspace.id)"
        >
          <button
            type="button"
            :data-workspace-row="workspace.id"
            :aria-pressed="workspace.id === activeWorkspaceId"
            :aria-grabbed="draggingWorkspaceId === workspace.id"
            :title="rowTitle(workspace)"
            class="flex h-8 w-full items-center gap-2 rounded-lg px-1.5 text-left transition-colors duration-[var(--dur-fast)]"
            :class="[
              draggingWorkspaceId === workspace.id ? 'opacity-60' : '',
              workspace.id === activeWorkspaceId
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
            ]"
            @click="handleItemClick(workspace)"
            @contextmenu="handleRowContextMenu($event, workspace)"
            @auxclick.middle.prevent="emit('close-workspace', workspace.id)"
            @pointerdown="handleItemPointerDown($event, workspace)"
          >
            <span
              class="grid size-5 shrink-0 place-items-center rounded-md text-[11px] font-semibold"
              :style="monogramStyle(workspace.id)"
            >
              {{ monogramOf(workspace) }}
            </span>
            <span class="min-w-0 flex-1 truncate text-[12.5px]">{{ workspace.name }}</span>
            <NIcon
              v-if="envBadgeOf(workspace)"
              :component="envIconOf(workspace)"
              :size="12"
              class="shrink-0"
              :class="envBadgeOf(workspace) === 'wsl' ? 'text-info' : 'text-warning'"
            />
            <span
              role="button"
              tabindex="-1"
              :data-close-workspace="workspace.id"
              class="grid size-4 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-all duration-[var(--dur-fast)] hover:bg-destructive/15 hover:text-destructive group-hover/row:opacity-70"
              @click.stop="emit('close-workspace', workspace.id)"
              @pointerdown.stop
            >
              <NIcon :component="CloseOutline" :size="10" />
            </span>
          </button>
        </div>
      </div>
    </div>

    <!-- 底部:设置 -->
    <div class="v2-hairline h-px shrink-0 border-t" />
    <div class="shrink-0 p-2">
      <button
        type="button"
        data-open-settings
        class="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[12.5px] text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:bg-surface-hover hover:text-foreground"
        @click="emit('open-settings')"
      >
        <NIcon :component="SettingsOutline" :size="13" />
        <span class="min-w-0 flex-1 truncate text-left">{{ t("common.settings") }}</span>
      </button>
    </div>

    <NDropdown
      trigger="manual"
      :show="rowMenu !== null"
      :x="rowMenu?.x ?? 0"
      :y="rowMenu?.y ?? 0"
      placement="bottom-start"
      :options="rowMenuOptions"
      @clickoutside="rowMenu = null"
      @select="handleRowMenuSelect"
    />
  </nav>

  <!-- 拖拽 ghost:折叠/展开态共用,monogram + 名称胶囊跟随指针 -->
  <div
    v-if="dragGhost"
    class="v2-glass-float will-change-transform pointer-events-none fixed z-50 flex h-8 items-center gap-2 rounded-lg px-1.5 text-[12.5px] opacity-95"
    :style="{
      transform: `translate3d(${dragGhost.x}px, ${dragGhost.y}px, 0) translate(-50%, -50%)`,
    }"
  >
    <span
      class="grid size-5 shrink-0 place-items-center rounded-md text-[11px] font-semibold"
      :style="monogramStyle(dragGhost.workspace.id)"
    >
      {{ monogramOf(dragGhost.workspace) }}
    </span>
    <span class="min-w-0 max-w-40 truncate">{{ dragGhost.workspace.name }}</span>
  </div>
</template>
