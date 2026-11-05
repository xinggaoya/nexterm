<script setup lang="ts">
/**
 * 顶栏工作区切换器。
 *
 * v3.2 壳层重设计：全局侧栏下线后，工作区列表从「常驻 248px 左栏」搬进
 * 顶栏的弹出浮层 —— 工作区通常只有 1~3 个，为它们常驻一整列是纯浪费；
 * 改成按需展开后，那 248px 全部还给终端与编辑器。
 *
 * 能力与旧 `Sidebar.vue` 保持一致：切换、拖拽重排、新窗口打开、移除、
 * 添加（本机 / WSL distro / SSH）。
 *
 * 交互约定：
 * - 行内 `⋯` 展开该行的动作区（不另开右键菜单）：键盘可达、位置确定，
 *   也不会和拖拽手势抢右键。
 * - 拖拽重排复用 `usePointerDragReorder`，落手后抑制随之而来的 click，
 *   避免「排序顺手把工作区切了」。
 */
import {
  AddOutline,
  ChevronDownOutline,
  EllipsisHorizontalOutline,
} from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import { computed, ref, watch } from "vue";
import { IS_WINDOWS } from "@/lib/platform";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import { useEventListener } from "@/lib/useEventListener";
import {
  usePointerDragReorder,
  type DragPlacement,
} from "@/lib/usePointerDragReorder";
import { t } from "@/modules/i18n/translate";
import {
  LOCAL_WORKSPACE,
  type WorkspaceEnv,
  type WorkspaceInstance,
} from "@/modules/workspace";
import { useWorkspaceEnvPiniaStore } from "@/modules/workspace/workspaceEnvPinia";
import {
  envBadgeOf,
  envIconOf,
  monogramOf,
  monogramStyle,
} from "./workspaceIdentity";

const props = defineProps<{
  workspaces: WorkspaceInstance[];
  activeWorkspaceId: string | null;
}>();

const emit = defineEmits<{
  "select-workspace": [id: string];
  "close-workspace": [id: string];
  "add-workspace": [env: WorkspaceEnv];
  "open-workspace-in-new-window": [id: string];
  "reorder-workspace": [sourceId: string, targetId: string, placement: DragPlacement];
}>();

const workspaceEnv = useWorkspaceEnvPiniaStore();

const rootRef = ref<HTMLElement | null>(null);
const open = ref(false);
/** 展开了动作区的工作区 id（同一时刻只展开一个）。 */
const expandedId = ref<string | null>(null);
/** 添加菜单是否展开。 */
const addMenuOpen = ref(false);

// ── 添加工作区菜单：本机 + WSL distro + SSH ─────────────────────────────
const showWsl = computed(() => IS_WINDOWS && workspaceEnv.distros.length > 0);

const addOptions = computed<{ key: string; label: string }[]>(() => {
  const options = [{ key: "local", label: t("app.workspaceBar.addLocal") }];
  if (showWsl.value) {
    for (const distro of workspaceEnv.distros) {
      options.push({
        key: `wsl:${distro.name}`,
        label: `${t("app.workspaceBar.addWsl")} · ${distro.name}`,
      });
    }
  }
  options.push({ key: "ssh", label: t("app.workspaceBar.addSsh") });
  return options;
});

function handleAddSelect(key: string) {
  addMenuOpen.value = false;
  if (key === "local") {
    emit("add-workspace", LOCAL_WORKSPACE);
    return;
  }
  if (key === "ssh") {
    emit("add-workspace", { kind: "ssh", profileId: "new" });
    return;
  }
  if (key.startsWith("wsl:")) {
    const distro = key.slice(4);
    if (distro) emit("add-workspace", { kind: "wsl", distro });
  }
}

// 切换器是常驻 UI,挂载即刷新 WSL distro 列表(失败静默)。
watch(
  () => IS_WINDOWS && hasTauriInternals(),
  (needed) => {
    if (needed) void workspaceEnv.refreshDistros();
  },
  { immediate: true },
);

// ── 当前工作区 ──────────────────────────────────────────────────────────
const activeWorkspace = computed(
  () =>
    props.workspaces.find((ws) => ws.id === props.activeWorkspaceId) ??
    props.workspaces[0] ??
    null,
);

// ── 浮层开合 ────────────────────────────────────────────────────────────
function toggleOpen() {
  open.value = !open.value;
  if (!open.value) {
    expandedId.value = null;
    addMenuOpen.value = false;
  }
}

function closeAll() {
  open.value = false;
  expandedId.value = null;
  addMenuOpen.value = false;
}

// 点击浮层外部：收起浮层与行内动作区。
// 触发行内的 pointerdown 也要放行 —— 否则拖拽排序刚开始浮层就关了。
useEventListener(document, "pointerdown", (event) => {
  if (!open.value) return;
  const target = event.target as Node | null;
  if (target && rootRef.value?.contains(target)) return;
  closeAll();
});

// ── 行操作 ──────────────────────────────────────────────────────────────
function toggleRowActions(id: string) {
  expandedId.value = expandedId.value === id ? null : id;
}

function handleSelect(workspace: WorkspaceInstance) {
  if (workspaceDrag.consumeSuppressedClick(workspace.id)) return;
  emit("select-workspace", workspace.id);
  closeAll();
}

function handleNewWindow(id: string) {
  emit("open-workspace-in-new-window", id);
  // 只收起行内动作区，浮层保持展开：用户可能连着做几件事
  // （先在新窗口打开，再移除）。
  expandedId.value = null;
}

function handleClose(id: string) {
  emit("close-workspace", id);
  expandedId.value = null;
}

// ── 拖拽排序 ────────────────────────────────────────────────────────────
function workspaceDragTarget(clientX: number, clientY: number) {
  const el =
    document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-workspace-row]") ?? null;
  if (!el) return null;
  const id = el.dataset.workspaceRow;
  if (!id) return null;
  return { id, el };
}

/** 竖向列表：上/下半区决定 before/after。 */
function verticalPlacementOf(
  target: { el: HTMLElement },
  _clientX: number,
  clientY: number,
): DragPlacement {
  const rect = target.el.getBoundingClientRect();
  return clientY < rect.top + rect.height / 2 ? "before" : "after";
}

const workspaceDrag = usePointerDragReorder<WorkspaceInstance, string>({
  enabled: () => props.workspaces.length > 1,
  resolveTarget: (x, y) => workspaceDragTarget(x, y),
  placementOf: verticalPlacementOf,
  resolveGhost: (id) => props.workspaces.find((ws) => ws.id === id) ?? null,
  onDrop: (sourceId, targetId, placement) =>
    emit("reorder-workspace", sourceId, targetId, placement),
});

const draggingWorkspaceId = workspaceDrag.draggingId;
const dropTarget = workspaceDrag.dropTarget;
const dragGhostItem = workspaceDrag.ghost;

/** 落点指示器：目标行上缘（before）/ 下缘（after）一条 2px 主色横线。 */
function dropIndicatorClass(id: string): string {
  const target = dropTarget.value;
  if (!target || target.id !== id) return "";
  return target.placement === "before"
    ? "before:absolute before:inset-x-1.5 before:top-0 before:h-0.5 before:rounded-full before:bg-primary"
    : "before:absolute before:inset-x-1.5 before:bottom-0 before:h-0.5 before:rounded-full before:bg-primary";
}

/**
 * 整行都能发起拖拽（不必精确按在名称上），但 `⋯` 按钮除外 ——
 * 那里是点开动作区，不是排序。
 */
function handleRowPointerDown(event: PointerEvent, workspace: WorkspaceInstance) {
  const target = event.target as HTMLElement | null;
  if (target?.closest("[data-workspace-more]")) return;
  workspaceDrag.startDrag(event, workspace.id);
}
</script>

<template>
  <div ref="rootRef" class="relative" data-no-drag>
    <!-- 触发按钮：monogram + 工作区名 + 展开箭头 -->
    <button
      type="button"
      data-workspace-switcher
      :aria-expanded="open"
      aria-haspopup="dialog"
      :aria-label="
        activeWorkspace
          ? `${t('app.titleBar.switchWorkspace')} · ${activeWorkspace.name}`
          : t('app.titleBar.switchWorkspace')
      "
      :title="activeWorkspace ? activeWorkspace.rootPath : undefined"
      class="flex h-7 max-w-[13rem] min-w-0 items-center gap-1.5 rounded-lg px-1.5 text-[12px] transition-colors duration-[var(--dur-fast)] hover:bg-surface-hover"
      @click="toggleOpen"
    >
      <span
        v-if="activeWorkspace"
        class="grid size-[18px] shrink-0 place-items-center rounded-[5px] text-[10px] font-semibold"
        :style="monogramStyle(activeWorkspace.id)"
      >
        {{ monogramOf(activeWorkspace) }}
      </span>
      <span
        v-if="activeWorkspace"
        class="min-w-0 flex-1 truncate font-medium text-foreground"
      >
        {{ activeWorkspace.name }}
      </span>
      <span
        v-else
        class="min-w-0 flex-1 truncate text-left text-muted-foreground"
      >
        {{ t("app.titleBar.switchWorkspace") }}
      </span>
      <NIcon
        :component="ChevronDownOutline"
        :size="12"
        class="shrink-0 text-muted-foreground"
      />
    </button>

    <!-- 浮层：工作区列表 + 添加入口 -->
    <div
      v-if="open"
      data-workspace-popover
      role="dialog"
      :aria-label="t('app.titleBar.workspaces')"
      class="nexterm-overlay absolute left-0 top-full z-50 mt-1 w-[260px] p-1"
    >
      <div class="max-h-[320px] overflow-y-auto">
        <div
          v-for="workspace in workspaces"
          :key="workspace.id"
          :data-workspace-row="workspace.id"
          :data-workspace-active="workspace.id === activeWorkspaceId"
          class="relative rounded-lg"
          :class="[
            dropIndicatorClass(workspace.id),
            draggingWorkspaceId === workspace.id ? 'opacity-60' : '',
          ]"
          @pointerdown="handleRowPointerDown($event, workspace)"
        >
          <div
            class="flex items-center gap-0.5 rounded-lg transition-colors duration-[var(--dur-fast)]"
            :class="
              workspace.id === activeWorkspaceId
                ? 'bg-primary/10'
                : 'hover:bg-surface-hover'
            "
          >
            <button
              type="button"
              :data-workspace-select="workspace.id"
              class="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pl-1.5 pr-1 text-left"
              :aria-current="workspace.id === activeWorkspaceId ? 'true' : undefined"
              @click="handleSelect(workspace)"
            >
              <span
                class="grid size-[18px] shrink-0 place-items-center rounded-[5px] text-[10px] font-semibold"
                :style="monogramStyle(workspace.id)"
              >
                {{ monogramOf(workspace) }}
              </span>
              <span
                class="min-w-0 flex-1 truncate text-[12.5px]"
                :class="
                  workspace.id === activeWorkspaceId
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground'
                "
              >
                {{ workspace.name }}
              </span>
              <NIcon
                v-if="envBadgeOf(workspace)"
                :component="envIconOf(workspace)"
                :size="12"
                class="shrink-0"
                :data-workspace-env-icon="envBadgeOf(workspace)"
                :class="envBadgeOf(workspace) === 'wsl' ? 'text-info' : 'text-warning'"
              />
            </button>
            <button
              type="button"
              :data-workspace-more="workspace.id"
              :aria-label="t('app.rail.openInNewWindow')"
              class="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:bg-surface-hover hover:text-foreground"
              @click="toggleRowActions(workspace.id)"
            >
              <NIcon :component="EllipsisHorizontalOutline" :size="14" />
            </button>
          </div>

          <!-- 行内动作区（`⋯` 展开）：键盘可达，位置确定 -->
          <div
            v-if="expandedId === workspace.id"
            :data-workspace-actions="workspace.id"
            class="flex items-center gap-1 px-1.5 pb-1 pt-0.5"
          >
            <button
              type="button"
              :data-workspace-new-window="workspace.id"
              class="flex-1 rounded-md bg-surface-hover px-1.5 py-1 text-[11px] text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:text-foreground"
              @click="handleNewWindow(workspace.id)"
            >
              {{ t("app.rail.openInNewWindow") }}
            </button>
            <button
              type="button"
              :data-workspace-close="workspace.id"
              class="flex-1 rounded-md bg-surface-hover px-1.5 py-1 text-[11px] text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:text-foreground"
              @click="handleClose(workspace.id)"
            >
              {{ t("app.workspaceBar.close") }}
            </button>
          </div>
        </div>
      </div>

      <!-- 添加工作区 -->
      <div class="mt-1 border-t border-border/70 pt-1">
        <button
          type="button"
          data-add-workspace
          :aria-expanded="addMenuOpen"
          class="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-[12px] text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:bg-surface-hover hover:text-foreground"
          @click="addMenuOpen = !addMenuOpen"
        >
          <NIcon :component="AddOutline" :size="13" class="shrink-0" />
          <span class="min-w-0 flex-1 truncate">{{ t("app.rail.addWorkspace") }}</span>
        </button>
        <div v-if="addMenuOpen" data-add-menu class="pb-0.5 pl-1">
          <button
            v-for="option in addOptions"
            :key="option.key"
            type="button"
            :data-add-option="option.key"
            class="flex w-full items-center rounded-md px-1.5 py-1.5 text-left text-[12px] text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:bg-surface-hover hover:text-foreground"
            @click="handleAddSelect(option.key)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- 拖拽 ghost：固定在视口层，不受浮层裁剪影响 -->
    <div
      v-if="dragGhostItem"
      class="v2-glass-float pointer-events-none fixed z-[60] flex h-8 items-center gap-2 rounded-lg px-1.5 text-[12.5px] opacity-95 will-change-transform"
      :style="{
        transform: `translate3d(${dragGhostItem.x}px, ${dragGhostItem.y}px, 0) translate(-50%, -50%)`,
      }"
    >
      <span
        class="grid size-5 shrink-0 place-items-center rounded-md text-[11px] font-semibold"
        :style="monogramStyle(dragGhostItem.item.id)"
      >
        {{ monogramOf(dragGhostItem.item) }}
      </span>
      <span class="min-w-0 max-w-40 truncate">{{ dragGhostItem.item.name }}</span>
    </div>
  </div>
</template>
