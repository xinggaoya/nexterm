<script setup lang="ts">
import {
  CaretDownOutline,
  CloseOutline,
  DesktopOutline,
  DuplicateOutline,
  FolderOpenOutline,
  GitCommitOutline,
  GitCompareOutline,
  GlobeOutline,
  HomeOutline,
  ReorderFourOutline,
  ReorderTwoOutline,
  SearchOutline,
  ServerOutline,
  SettingsOutline,
  TerminalOutline,
  TimeOutline,
} from "@vicons/ionicons5";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { NButton, NButtonGroup, NDropdown, NIcon, type DropdownOption } from "naive-ui";
import { computed, h, onBeforeUnmount, onMounted, ref, type Component, type VNode } from "vue";
import TooltipTitle from "@/components/TooltipTitle.vue";
import WindowControls from "@/components/WindowControls.vue";
import { IS_MAC } from "@/lib/platform";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import { t } from "@/modules/i18n/translate";
import type { TabDropPlacement } from "@/modules/tabs/tabsReorder";
import type { Tab } from "@/modules/tabs/tabsTypes";
import type { SplitDir } from "@/modules/terminal/lib/panes";
import { useWorkspaceEnvPiniaStore, type WorkspaceEnv } from "@/modules/workspace";

const props = withDefaults(
  defineProps<{
    tabs: Tab[];
    activeId: number;
    canSplit: boolean;
    workspaceReady?: boolean;
    showWindowControls?: boolean;
    leftPanelOpen?: boolean;
    rightPanelOpen?: boolean;

  }>(),
  {
    workspaceReady: true,
    showWindowControls: false,
    leftPanelOpen: false,
    rightPanelOpen: true,

  },
);

const emit = defineEmits<{
  selectTab: [id: number];
  closeTab: [id: number];
  pinTab: [id: number];
  newTab: [];
  chooseWorkspace: [];
  chooseWorkspaceInEnv: [env: WorkspaceEnv];
  openEnvHomeCurrent: [env: WorkspaceEnv];
  openEnvHomeNew: [env: WorkspaceEnv];
  splitPane: [dir: SplitDir];
  openCommandPalette: [];
  openSettings: [];

  toggleLeftPanel: [];
  toggleRightPanel: [];
  reorderTab: [sourceId: number, targetId: number, placement: TabDropPlacement];
}>();

type TabIcon =
  | { type: "component"; name: string; component: Component; class?: string }
  | { type: "image"; name: string; src: string };

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

const DRAG_START_THRESHOLD_PX = 6;
const draggingTabId = ref<number | null>(null);
const dropTarget = ref<{
  id: number;
  placement: TabDropPlacement;
} | null>(null);
const pointerDrag = ref<PointerDragState | null>(null);
const suppressedClickTabId = ref<number | null>(null);
const dragGhost = ref<DragGhostState | null>(null);

const workspaceEnvStore = useWorkspaceEnvPiniaStore();

const LOCAL_ENV: WorkspaceEnv = { kind: "local" };

function envLabel(env: WorkspaceEnv): string {
  return env.kind === "wsl" ? env.distro : t("common.local");
}

function buildOpenFolderOptions(): DropdownOption[] {
  const distros = workspaceEnvStore.distros ?? [];
  const envs: WorkspaceEnv[] = [
    LOCAL_ENV,
    ...distros.map((distro) => ({
      kind: "wsl" as const,
      distro: distro.name,
    })),
  ];
  const options: DropdownOption[] = [];
  for (const env of envs) {
    const envDisplay = envLabel(env);
    options.push(
      {
        key: `browse:${actionKey(env)}`,
        label: t("app.header.openFolderMenu.browseIn", { env: envDisplay }),
        icon: () =>
          h(NIcon, null, {
            default: () => h(env.kind === "wsl" ? ServerOutline : DesktopOutline),
          }),
      },
      {
        key: `home-current:${actionKey(env)}`,
        label: t("app.header.openFolderMenu.openHomeCurrent", { env: envDisplay }),
        icon: () => h(NIcon, null, { default: () => h(HomeOutline) }),
      },
      {
        key: `home-new:${actionKey(env)}`,
        label: t("app.header.openFolderMenu.openHomeNew", { env: envDisplay }),
        icon: () => h(NIcon, null, { default: () => h(HomeOutline) }),
      },
    );
  }
  return options;
}

function actionKey(env: WorkspaceEnv): string {
  return env.kind === "wsl" ? `wsl:${env.distro}` : "local";
}

const openFolderOptions = computed<DropdownOption[]>(() => buildOpenFolderOptions());

function handleOpenFolderSelect(key: string | number) {
  const value = String(key);
  const actionEnd = value.indexOf(":");
  const action = value.slice(0, actionEnd);
  const envPart = value.slice(actionEnd + 1);
  let env: WorkspaceEnv = LOCAL_ENV;
  if (envPart === "local") {
    env = LOCAL_ENV;
  } else if (envPart.startsWith("wsl:")) {
    env = { kind: "wsl", distro: envPart.slice(4) };
  }
  if (action === "browse") emit("chooseWorkspaceInEnv", env);
  else if (action === "home-current") emit("openEnvHomeCurrent", env);
  else if (action === "home-new") emit("openEnvHomeNew", env);
}

onMounted(() => {
  if (hasTauriInternals()) void workspaceEnvStore.refreshDistros();
});

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "/";
}

function tabKindLabel(tab: Tab): string {
  if (tab.kind === "terminal") {
    return t("app.header.terminal");
  }
  if (tab.kind === "git-history") return t("app.header.gitHistory");
  if (tab.kind === "git-diff" || tab.kind === "git-commit-file") {
    return t("app.header.gitDiff");
  }
  if (tab.kind === "markdown") return t("app.header.markdown");
  if (tab.kind === "preview") return t("app.header.preview");
  return t("settings.general.editor");
}

function tabLabel(tab: Tab): string {
  if (tab.kind === "terminal" && tab.terminalTitle) return tab.terminalTitle;
  if (tab.kind === "terminal" && tab.cwd) return basename(tab.cwd);
  return tab.title;
}

function tabIcon(tab: Tab): TabIcon {
  if (tab.kind === "terminal") {
    return { type: "component", name: "terminal", component: TerminalOutline };
  }
  if (tab.kind === "editor") {
    return { type: "image", name: "editor", src: fileIconUrl(tab.title) };
  }
  if (tab.kind === "markdown") {
    return { type: "image", name: "markdown", src: fileIconUrl(tab.title) };
  }
  if (tab.kind === "preview") {
    return { type: "component", name: "preview", component: GlobeOutline };
  }
  if (tab.kind === "git-history") {
    return { type: "component", name: "git-history", component: TimeOutline };
  }
  return { type: "component", name: "git-diff", component: GitCompareOutline };
}

function pinPreviewTab(tab: Tab) {
  if (tab.kind === "editor" && tab.preview) emit("pinTab", tab.id);
}

function clearDragState() {
  draggingTabId.value = null;
  dropTarget.value = null;
  pointerDrag.value = null;
  dragGhost.value = null;
}

function dropPlacementFromElement(
  clientX: number,
  element: HTMLElement,
): TabDropPlacement {
  const rect = element.getBoundingClientRect();
  return clientX < rect.left + rect.width / 2 ? "before" : "after";
}

function tabElementFromPoint(clientX: number, clientY: number): HTMLElement | null {
  return document
    .elementFromPoint(clientX, clientY)
    ?.closest<HTMLElement>("[data-tab-id]") ?? null;
}

function tabIdFromElement(element: HTMLElement): number | null {
  const id = Number(element.dataset.tabId);
  return Number.isFinite(id) ? id : null;
}

function updateDropTargetFromPointer(event: PointerEvent) {
  const drag = pointerDrag.value;
  if (!drag) return;
  const targetElement = tabElementFromPoint(event.clientX, event.clientY);
  if (!targetElement) {
    dropTarget.value = null;
    return;
  }
  const targetId = tabIdFromElement(targetElement);
  if (targetId === null || targetId === drag.sourceId) {
    dropTarget.value = null;
    return;
  }
  dropTarget.value = {
    id: targetId,
    placement: dropPlacementFromElement(event.clientX, targetElement),
  };
}

function clampDragGhostWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 160;
  return Math.min(224, Math.max(104, width));
}

function updateDragGhostFromPointer(event: PointerEvent, drag: PointerDragState) {
  const tab = props.tabs.find((item) => item.id === drag.sourceId);
  if (!tab) {
    dragGhost.value = null;
    return;
  }
  dragGhost.value = {
    tab,
    x: event.clientX,
    y: event.clientY,
    width: drag.sourceWidth,
  };
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

function suppressNextTabClick(tabId: number) {
  suppressedClickTabId.value = tabId;
  window.setTimeout(() => {
    if (suppressedClickTabId.value === tabId) suppressedClickTabId.value = null;
  }, 400);
}

function handleWindowPointerMove(event: PointerEvent) {
  const drag = pointerDrag.value;
  if (!drag || drag.pointerId !== event.pointerId) return;

  const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
  if (!drag.dragging && distance < DRAG_START_THRESHOLD_PX) return;

  event.preventDefault();
  if (!drag.dragging) {
    drag.dragging = true;
    draggingTabId.value = drag.sourceId;
  }
  updateDragGhostFromPointer(event, drag);
  updateDropTargetFromPointer(event);
}

function handleWindowPointerUp(event: PointerEvent) {
  const drag = pointerDrag.value;
  if (!drag || drag.pointerId !== event.pointerId) return;

  const sourceId = drag.sourceId;
  if (drag.dragging) updateDropTargetFromPointer(event);
  const target = dropTarget.value;
  removePointerListeners();
  if (drag.dragging) {
    event.preventDefault();
    suppressNextTabClick(sourceId);
    if (target && target.id !== sourceId) {
      emit("reorderTab", sourceId, target.id, target.placement);
    }
  }
  clearDragState();
}

function handleWindowPointerCancel(event: PointerEvent) {
  const drag = pointerDrag.value;
  if (!drag || drag.pointerId !== event.pointerId) return;
  removePointerListeners();
  clearDragState();
}

function handleTabPointerDown(event: PointerEvent, tab: Tab) {
  if (props.tabs.length <= 1 || event.button !== 0) return;
  event.stopPropagation();
  removePointerListeners();
  const sourceElement =
    event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  pointerDrag.value = {
    sourceId: tab.id,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    sourceWidth: clampDragGhostWidth(
      sourceElement?.getBoundingClientRect().width ?? 0,
    ),
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

async function startWindowDrag(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  try {
    const windowRef = getCurrentWindow();
    await windowRef.startDragging();
  } catch {
    // Running in a browser-only dev/test context has no native window to drag.
  }
}

function handleSplitSelect(key: string | number) {
  const dir: SplitDir = key === "col" ? "col" : "row";
  emit("splitPane", dir);
}

const splitOptions = computed<DropdownOption[]>(() => [
  { key: "row", label: t("app.header.splitRight") },
  { key: "col", label: t("app.header.splitDown") },
]);

function renderSplitOptionIcon(option: DropdownOption): VNode {
  return h(NIcon, { size: 14 }, {
    default: () =>
      h(option.key === "col" ? ReorderTwoOutline : DuplicateOutline),
  });
}

onBeforeUnmount(() => {
  removePointerListeners();
});
</script>

<template>
  <header
    :class="[
      'app-header flex h-11 shrink-0 items-center border-b border-border/60 bg-card',
      IS_MAC ? 'pr-2 pl-22' : 'pr-2 pl-2',
    ]"
  >
    <div class="flex shrink-0 items-center gap-0.5">
      <TooltipTitle :label="t('app.header.sourceControl')">
        <button
          type="button"
          :data-toggle-left-panel="leftPanelOpen"
          :aria-label="t('app.header.toggleSourceControl')"
          :class="[
            'grid h-7 w-7 place-items-center rounded-md transition-colors',
            leftPanelOpen
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
          ]"
          @click="emit('toggleLeftPanel')"
        >
          <NIcon :component="GitCommitOutline" :size="15" />
        </button>
      </TooltipTitle>
      <NButtonGroup size="tiny" class="shrink-0">
        <TooltipTitle :label="t('app.header.openFolder')">
          <NButton
            data-open-workspace
            secondary
            :aria-label="t('app.header.openFolder')"
            @click="emit('chooseWorkspace')"
          >
            <template #icon><NIcon :component="FolderOpenOutline" /></template>
            <span class="hidden xl:inline">{{ t("app.header.openFolder") }}</span>
          </NButton>
        </TooltipTitle>
        <NDropdown
          trigger="click"
          placement="bottom-end"
          :options="openFolderOptions"
          @select="handleOpenFolderSelect"
        >
          <NButton
            data-open-workspace-menu
            secondary
            :aria-label="t('app.header.openFolder')"
          >
            <template #icon><NIcon :component="CaretDownOutline" /></template>
          </NButton>
        </NDropdown>
      </NButtonGroup>
      <TooltipTitle :label="t('app.header.newTerminal')">
        <button
          type="button"
          data-new-tab
          :aria-label="t('app.header.newTerminal')"
          class="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
          @click="emit('newTab')"
        >
          <NIcon :component="TerminalOutline" :size="14" />
        </button>
      </TooltipTitle>
    </div>

    <div
      data-window-drag-region
      :title="t('app.header.dragWindow')"
      class="mx-1 h-7 w-5 shrink-0 rounded-md transition-colors hover:bg-accent/40"
      @pointerdown="startWindowDrag"
    />

    <div class="no-scrollbar ml-1 mr-1 min-w-0 flex-1 overflow-x-auto">
      <div class="flex min-w-full items-center gap-0.5">
        <button
          v-for="tab in props.tabs"
          :key="tab.id"
          type="button"
          :data-tab-id="tab.id"
          :aria-grabbed="draggingTabId === tab.id"
          :title="`${tabKindLabel(tab)}: ${tabLabel(tab)}`"
          :class="[
            'group relative flex h-7 min-w-[5.5rem] max-w-56 flex-[1_1_10rem] items-center justify-between gap-1.5 rounded-md px-2 text-left text-[12px] transition-[background-color,color,box-shadow,opacity]',
            props.tabs.length === 1 ? 'pe-2' : 'pe-1',
            draggingTabId === tab.id ? 'opacity-60' : '',
            dropTarget?.id === tab.id && dropTarget.placement === 'before'
              ? 'before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-primary'
              : '',
            dropTarget?.id === tab.id && dropTarget.placement === 'after'
              ? 'after:absolute after:inset-y-1 after:right-0 after:w-0.5 after:rounded-full after:bg-primary'
              : '',
            tab.id === props.activeId
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
          ]"
          @click="handleTabClick(tab)"
          @dblclick="pinPreviewTab(tab)"
          @pointerdown="handleTabPointerDown($event, tab)"
        >
          <span class="flex min-w-0 flex-1 items-center gap-1.5 truncate">
            <template v-for="icon in [tabIcon(tab)]" :key="icon.name">
              <img
                v-if="icon.type === 'image'"
                :src="icon.src"
                alt=""
                :data-tab-icon="icon.name"
                class="size-3.5 shrink-0"
              />
              <NIcon
                v-else
                :component="icon.component"
                :size="14"
                :data-tab-icon="icon.name"
                :class="['shrink-0', icon.class]"
              />
            </template>
            <span
              class="min-w-0 truncate"
              :class="tab.kind === 'editor' && tab.preview ? 'italic' : ''"
              :data-tab-label="tab.id"
            >
              {{ tabLabel(tab) }}
            </span>
            <span
              v-if="tab.kind === 'editor' && tab.dirty"
              :data-tab-dirty="tab.id"
              :aria-label="t('app.header.unsavedChanges')"
              class="size-1.5 shrink-0 rounded-full bg-foreground/70"
            />
          </span>
          <TooltipTitle v-if="props.tabs.length > 1" :label="t('app.header.closeTab')">
            <span
              role="button"
              tabindex="-1"
              :data-close-tab-id="tab.id"
              class="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground group-hover:opacity-70 group-hover:hover:opacity-100"
              :aria-label="t('app.header.closeTab')"
              @click.stop="emit('closeTab', tab.id)"
              @pointerdown.stop
              @keydown.enter.stop.prevent="emit('closeTab', tab.id)"
              @keydown.space.stop.prevent="emit('closeTab', tab.id)"
            >
              <NIcon :component="CloseOutline" :size="11" />
            </span>
          </TooltipTitle>
        </button>
        <div
          data-window-drag-region
          :title="t('app.header.dragWindow')"
          class="h-7 min-w-5 flex-1 rounded-md transition-colors hover:bg-accent/40"
          @pointerdown="startWindowDrag"
        />
      </div>
    </div>

    <div
      data-header-actions
      class="flex shrink-0 items-center gap-0.5 pl-1"
    >
      <TooltipTitle :label="t('app.header.splitActions')">
        <NDropdown
          trigger="click"
          placement="bottom-end"
          :options="splitOptions"
          :disabled="!props.workspaceReady || !canSplit"
          :render-icon="renderSplitOptionIcon"
          @select="handleSplitSelect"
        >
          <button
            type="button"
            data-split-actions
            :disabled="!props.workspaceReady || !canSplit"
            :aria-label="t('app.header.splitActions')"
            class="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          >
            <NIcon :component="ReorderFourOutline" :size="14" />
          </button>
        </NDropdown>
      </TooltipTitle>
      <TooltipTitle :label="t('app.header.openCommandCenter')">
        <button
          type="button"
          data-open-command-palette
          :aria-label="t('app.header.openCommandCenter')"
          class="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
          @click="emit('openCommandPalette')"
        >
          <NIcon :component="SearchOutline" :size="14" />
        </button>
      </TooltipTitle>
      <TooltipTitle :label="t('common.settings')">
        <button
          type="button"
          data-open-settings
          :aria-label="t('common.settings')"
          class="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
          @click="emit('openSettings')"
        >
          <NIcon :component="SettingsOutline" :size="14" />
        </button>
      </TooltipTitle>
      <TooltipTitle :label="t('common.explorer')">
        <button
          type="button"
          :data-toggle-right-panel="rightPanelOpen"
          :aria-label="t('app.header.toggleExplorer')"
          :class="[
            'grid h-7 w-7 place-items-center rounded-md transition-colors',
            rightPanelOpen
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
          ]"
          @click="emit('toggleRightPanel')"
        >
          <NIcon :component="FolderOpenOutline" :size="14" />
        </button>
      </TooltipTitle>
      <WindowControls v-if="props.showWindowControls" />
    </div>

    <div
      v-if="dragGhost"
      data-tab-drag-ghost
      class="pointer-events-none fixed z-50 flex h-7 items-center gap-1.5 rounded-md border border-border/70 bg-card px-2 text-left text-[12px] text-foreground opacity-95 shadow-lg ring-1 ring-foreground/10 transition-[box-shadow,opacity]"
      :style="{
        width: `${dragGhost.width}px`,
        transform: `translate3d(${dragGhost.x}px, ${dragGhost.y}px, 0) translate(-50%, -50%)`,
      }"
    >
      <template v-for="icon in [tabIcon(dragGhost.tab)]" :key="icon.name">
        <img
          v-if="icon.type === 'image'"
          :src="icon.src"
          alt=""
          class="size-3.5 shrink-0"
        />
        <NIcon
          v-else
          :component="icon.component"
          :size="14"
          :class="['shrink-0', icon.class]"
        />
      </template>
      <span class="min-w-0 truncate">{{ tabLabel(dragGhost.tab) }}</span>
    </div>
  </header>
</template>

<style scoped>
.app-header,
.app-header :deep(*) {
  cursor: default !important;
}
</style>
