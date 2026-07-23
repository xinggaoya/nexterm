import { computed, nextTick, ref, watch, type Ref } from "vue";
import { defineStore, storeToRefs } from "pinia";
import {
  LEFT_SIDEBAR_WIDTH_DEFAULT,
  LEFT_SIDEBAR_WIDTH_MAX,
  LEFT_SIDEBAR_WIDTH_MIN,
  SIDE_PANEL_WIDTH_MAX,
  SIDE_PANEL_WIDTH_MIN,
  setLayoutLeftSidebar,
  setLayoutPanels,
} from "@/modules/settings/store";
import { hasTauriInternals } from "@/lib/tauriRuntime";

export type WorkbenchLayoutPreferences = {
  sourceControlPanelWidth: number;
  explorerPanelWidth: number;
  updateSourceControlPanelWidth: (value: number) => Promise<void>;
  updateExplorerPanelWidth: (value: number) => Promise<void>;
};

export type ActivityKey = "workspace" | "sourceControl";
export type PanelKey =
  | "workspace"
  | "sourceControl"
  | "explorer"
  | "taskConsole";

export interface LeftSidebarState {
  activity: ActivityKey;
  open: boolean;
  width: number;
}

export interface PanelVisibilityState {
  workspace: boolean;
  sourceControl: boolean;
  explorer: boolean;
  taskConsole: boolean;
}

export type WorkbenchLayoutOptions = {
  prefs: WorkbenchLayoutPreferences;
  panelResizeTriggerSize?: number;
  saveDelayMs?: number;
};

// 4px 与 WorkspaceHost 的 gap-1 间隙一致：让右侧 NSplit 的透明热区与左侧
// 栏卡片到中间卡片的画布透出间隙视觉完全对齐。
const DEFAULT_PANEL_RESIZE_TRIGGER_SIZE = 4;
const DEFAULT_PANEL_WIDTH_SAVE_DELAY_MS = 250;

const DEFAULT_LEFT_SIDEBAR: LeftSidebarState = {
  activity: "sourceControl",
  open: true,
  width: LEFT_SIDEBAR_WIDTH_DEFAULT,
};

const DEFAULT_PANELS: PanelVisibilityState = {
  workspace: true,
  sourceControl: true,
  explorer: true,
  taskConsole: false,
};

/**
 * Global panel-visibility state shared across all workspace hosts.
 *
 * In the multi-workspace architecture, MainApp owns the TitleBar whose
 * buttons toggle the source-control / explorer panels. Each WorkspaceHost
 * creates its own `useWorkbenchLayout` for split-sizing, but the open/closed
 * state must be shared — otherwise toggling a panel in the title bar has no
 * effect on the active workspace's workbench. This Pinia store is the single
 * source of truth for that shared visibility.
 */
const usePanelVisibilityStore = defineStore("workbench-panel-visibility", () => {
  const leftPanelOpen = ref(false);
  const rightPanelOpen = ref(true);
  const leftSidebar = ref<LeftSidebarState>({ ...DEFAULT_LEFT_SIDEBAR });
  const panelVisibility = ref<PanelVisibilityState>({ ...DEFAULT_PANELS });
  return {
    leftPanelOpen,
    rightPanelOpen,
    leftSidebar,
    panelVisibility,
  };
});

function clampPanelWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDE_PANEL_WIDTH_MIN;
  return Math.min(
    SIDE_PANEL_WIDTH_MAX,
    Math.max(SIDE_PANEL_WIDTH_MIN, Math.round(value)),
  );
}

// Sidebar width bounds come from the settings store so there is a single
// source of truth shared with persistence (LEFT_SIDEBAR_WIDTH_* above).

function clampLeftSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return LEFT_SIDEBAR_WIDTH_DEFAULT;
  return Math.min(
    LEFT_SIDEBAR_WIDTH_MAX,
    Math.max(LEFT_SIDEBAR_WIDTH_MIN, Math.round(value)),
  );
}

function parsePxSize(value: string | number): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function useWorkbenchLayout(options: WorkbenchLayoutOptions) {
  const prefs = options.prefs;
  const panelResizeTriggerSize =
    options.panelResizeTriggerSize ?? DEFAULT_PANEL_RESIZE_TRIGGER_SIZE;
  const saveDelayMs = options.saveDelayMs ?? DEFAULT_PANEL_WIDTH_SAVE_DELAY_MS;

  // Shared panel visibility — same refs across MainApp and every WorkspaceHost
  // so title-bar toggles reach the active workbench. Pinia store refs are
  // writable and shared, so `leftPanelOpen.value = true` in MainApp is visible
  // to every WorkspaceHost's workbench.
  const visibility = usePanelVisibilityStore();
  const leftPanelOpen = computed(() => visibility.leftPanelOpen);
  const rightPanelOpen = computed(() => visibility.rightPanelOpen);
  const leftSidebar = computed(() => visibility.leftSidebar);
  const panelVisibility = computed(() => visibility.panelVisibility);
  function setLeftPanelOpen(v: boolean): void {
    visibility.leftPanelOpen = v;
  }
  function setRightPanelOpen(v: boolean): void {
    visibility.rightPanelOpen = v;
  }
  function toggleLeftPanel(): void {
    visibility.leftPanelOpen = !visibility.leftPanelOpen;
  }
  function toggleRightPanel(): void {
    visibility.rightPanelOpen = !visibility.rightPanelOpen;
  }
  function setLeftSidebarActivity(key: ActivityKey): void {
    visibility.leftSidebar = { ...visibility.leftSidebar, activity: key };
  }
  function toggleLeftSidebar(): void {
    visibility.leftSidebar = {
      ...visibility.leftSidebar,
      open: !visibility.leftSidebar.open,
    };
  }
  function setLeftSidebarWidth(width: number): void {
    visibility.leftSidebar = {
      ...visibility.leftSidebar,
      width: clampLeftSidebarWidth(width),
    };
  }
  function togglePanel(key: PanelKey): void {
    visibility.panelVisibility = {
      ...visibility.panelVisibility,
      [key]: !visibility.panelVisibility[key],
    };
    if (key === "sourceControl") {
      visibility.leftPanelOpen = visibility.panelVisibility.sourceControl;
    }
    if (key === "explorer") {
      visibility.rightPanelOpen = visibility.panelVisibility.explorer;
    }
  }
  const sourceControlPanelWidth = ref(
    clampPanelWidth(prefs.sourceControlPanelWidth),
  );
  const explorerPanelWidth = ref(clampPanelWidth(prefs.explorerPanelWidth));
  const rightSplitHost = ref<HTMLElement | null>(null);
  const rightSplitWidth = ref(0);
  let rightSplitResizeObserver: ResizeObserver | null = null;
  let stopRightSplitHostWatch: (() => void) | null = null;
  let sourceControlWidthSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let explorerWidthSaveTimer: ReturnType<typeof setTimeout> | null = null;

  const sourceControlSplitSize = computed(() =>
    leftPanelOpen.value ? `${sourceControlPanelWidth.value}px` : "0px",
  );
  const sourceControlSplitMin = computed(() =>
    leftPanelOpen.value ? `${SIDE_PANEL_WIDTH_MIN}px` : "0px",
  );
  const sourceControlSplitMax = computed(() =>
    leftPanelOpen.value ? `${SIDE_PANEL_WIDTH_MAX}px` : "0px",
  );
  const sourceControlPaneClass = computed(() =>
    [
      "h-full overflow-hidden",
      leftPanelOpen.value
        ? "nexterm-surface"
        : "bg-transparent",
    ].join(" "),
  );
  const explorerSplitSize = computed(() => {
    if (!rightPanelOpen.value) return "100%";
    const usable = rightSplitWidth.value - panelResizeTriggerSize;
    if (usable <= 0) {
      return `calc(100% - ${explorerPanelWidth.value + panelResizeTriggerSize}px)`;
    }
    return `${Math.max(0, usable - explorerPanelWidth.value)}px`;
  });
  const explorerSplitMin = computed(() => {
    if (!rightPanelOpen.value) return "0px";
    const usable = Math.max(0, rightSplitWidth.value - panelResizeTriggerSize);
    return `${Math.max(0, usable - SIDE_PANEL_WIDTH_MAX)}px`;
  });
  const explorerSplitMax = computed(() => {
    if (!rightPanelOpen.value) return "0px";
    const usable = Math.max(0, rightSplitWidth.value - panelResizeTriggerSize);
    return `${Math.max(0, usable - SIDE_PANEL_WIDTH_MIN)}px`;
  });
  const explorerPaneClass = computed(() =>
    [
      "relative h-full overflow-hidden rounded-[6px] border border-border",
      rightPanelOpen.value
        ? "nexterm-surface"
        : "bg-transparent border-transparent",
    ].join(" "),
  );

  function measureRightSplitWidth() {
    rightSplitWidth.value =
      rightSplitHost.value?.getBoundingClientRect().width ?? 0;
  }

  function scheduleSourceControlWidthSave(width: number) {
    sourceControlPanelWidth.value = clampPanelWidth(width);
    if (sourceControlWidthSaveTimer) clearTimeout(sourceControlWidthSaveTimer);
    sourceControlWidthSaveTimer = setTimeout(() => {
      sourceControlWidthSaveTimer = null;
      void prefs.updateSourceControlPanelWidth(sourceControlPanelWidth.value);
    }, saveDelayMs);
  }

  function flushSourceControlWidthSave() {
    if (sourceControlWidthSaveTimer) {
      clearTimeout(sourceControlWidthSaveTimer);
      sourceControlWidthSaveTimer = null;
    }
    if (sourceControlPanelWidth.value !== prefs.sourceControlPanelWidth) {
      void prefs.updateSourceControlPanelWidth(sourceControlPanelWidth.value);
    }
  }

  function scheduleExplorerWidthSave(width: number) {
    explorerPanelWidth.value = clampPanelWidth(width);
    if (explorerWidthSaveTimer) clearTimeout(explorerWidthSaveTimer);
    explorerWidthSaveTimer = setTimeout(() => {
      explorerWidthSaveTimer = null;
      void prefs.updateExplorerPanelWidth(explorerPanelWidth.value);
    }, saveDelayMs);
  }

  function flushExplorerWidthSave() {
    if (explorerWidthSaveTimer) {
      clearTimeout(explorerWidthSaveTimer);
      explorerWidthSaveTimer = null;
    }
    if (explorerPanelWidth.value !== prefs.explorerPanelWidth) {
      void prefs.updateExplorerPanelWidth(explorerPanelWidth.value);
    }
  }

  function updateSourceControlSplitSize(size: string | number) {
    const width = parsePxSize(size);
    if (width !== null) scheduleSourceControlWidthSave(width);
  }

  function updateExplorerSplitSize(size: string | number) {
    const centerWidth = parsePxSize(size);
    const usableWidth = rightSplitWidth.value - panelResizeTriggerSize;
    if (centerWidth === null || usableWidth <= 0) return;
    scheduleExplorerWidthSave(usableWidth - centerWidth);
  }

  function startLayoutObservers() {
    if (
      typeof ResizeObserver === "function" &&
      typeof globalThis.removeEventListener === "function"
    ) {
      rightSplitResizeObserver = new ResizeObserver(measureRightSplitWidth);
      if (rightSplitHost.value) {
        rightSplitResizeObserver.observe(rightSplitHost.value);
      }
      // The split host is bound by the Workbench component via a function ref,
      // which may populate after this observer starts (e.g. on lazy mount or
      // v-show workspace switches). Watch for it so we always begin observing
      // the real element — otherwise the width stays 0 and NSplit locks up.
      stopRightSplitHostWatch = watch(
        rightSplitHost,
        (el, prev) => {
          if (prev) rightSplitResizeObserver?.unobserve(prev);
          if (el) {
            rightSplitResizeObserver?.observe(el);
            void nextTick(measureRightSplitWidth);
          }
        },
        { flush: "post" },
      );
    }
    window.addEventListener("resize", measureRightSplitWidth);
    void nextTick(measureRightSplitWidth);
  }

  function stopLayoutObservers() {
    stopRightSplitHostWatch?.();
    stopRightSplitHostWatch = null;
    rightSplitResizeObserver?.disconnect();
    rightSplitResizeObserver = null;
    window.removeEventListener("resize", measureRightSplitWidth);
    flushSourceControlWidthSave();
    flushExplorerWidthSave();
    if (!hasTauriInternals()) return;
    void setLayoutLeftSidebar({
      activity: visibility.leftSidebar.activity,
      open: visibility.leftSidebar.open,
      width: visibility.leftSidebar.width,
    });
    void setLayoutPanels({ ...visibility.panelVisibility });
  }

  watch(
    () => prefs.sourceControlPanelWidth,
    (width) => {
      if (!sourceControlWidthSaveTimer) {
        sourceControlPanelWidth.value = clampPanelWidth(width);
      }
    },
    { immediate: true },
  );

  watch(
    () => prefs.explorerPanelWidth,
    (width) => {
      if (!explorerWidthSaveTimer) {
        explorerPanelWidth.value = clampPanelWidth(width);
      }
    },
    { immediate: true },
  );

  watch([leftPanelOpen, rightPanelOpen], () => {
    void nextTick(measureRightSplitWidth);
  });

  return {
    explorerPaneClass,
    explorerPanelWidth,
    explorerSplitMax,
    explorerSplitMin,
    explorerSplitSize,
    flushExplorerWidthSave,
    flushSourceControlWidthSave,
    // Live width setter used by the custom card-edge resizer (mirrors the
    // left sidebar's setLeftSidebarWidth). Clamps + schedules a debounced
    // persist; call flushExplorerWidthSave() on drag end to persist immediately.
    setExplorerPanelWidth: scheduleExplorerWidthSave,
    leftPanelOpen,
    // Sidebar width bounds (mirrors of the store constants) so callers such
    // as WorkspaceHost can bind min/max without hardcoding magic numbers.
    leftSidebarWidthMax: LEFT_SIDEBAR_WIDTH_MAX,
    leftSidebarWidthMin: LEFT_SIDEBAR_WIDTH_MIN,
    // Raw writable refs from the shared panel-visibility store, for callers
    // (e.g. useWorkbenchCommands) that need to assign `.value` directly.
    leftPanelOpenRef: storeToRefs(visibility).leftPanelOpen,
    leftSidebar,
    measureRightSplitWidth,
    panelResizeTriggerSize,
    panelVisibility,
    rightPanelOpen,
    rightPanelOpenRef: storeToRefs(visibility).rightPanelOpen,
    rightSplitHost: rightSplitHost as Ref<HTMLElement | null>,
    rightSplitWidth,
    setLeftPanelOpen,
    setLeftSidebarActivity,
    setLeftSidebarWidth,
    setRightPanelOpen,
    sourceControlPaneClass,
    sourceControlPanelWidth,
    sourceControlSplitMax,
    sourceControlSplitMin,
    sourceControlSplitSize,
    startLayoutObservers,
    stopLayoutObservers,
    toggleLeftPanel,
    toggleLeftSidebar,
    togglePanel,
    toggleRightPanel,
    updateExplorerSplitSize,
    updateSourceControlSplitSize,
  };
}
