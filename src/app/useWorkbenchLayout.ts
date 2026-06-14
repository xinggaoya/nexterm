import { computed, nextTick, ref, watch, type Ref } from "vue";
import {
  SIDE_PANEL_WIDTH_MAX,
  SIDE_PANEL_WIDTH_MIN,
} from "@/modules/settings/store";

export type WorkbenchLayoutPreferences = {
  sourceControlPanelWidth: number;
  explorerPanelWidth: number;
  updateSourceControlPanelWidth: (value: number) => Promise<void>;
  updateExplorerPanelWidth: (value: number) => Promise<void>;
};

export type WorkbenchLayoutOptions = {
  prefs: WorkbenchLayoutPreferences;
  panelResizeTriggerSize?: number;
  saveDelayMs?: number;
};

const DEFAULT_PANEL_RESIZE_TRIGGER_SIZE = 6;
const DEFAULT_PANEL_WIDTH_SAVE_DELAY_MS = 250;

function clampPanelWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDE_PANEL_WIDTH_MIN;
  return Math.min(
    SIDE_PANEL_WIDTH_MAX,
    Math.max(SIDE_PANEL_WIDTH_MIN, Math.round(value)),
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

  const leftPanelOpen = ref(false);
  const rightPanelOpen = ref(true);
  const sourceControlPanelWidth = ref(
    clampPanelWidth(prefs.sourceControlPanelWidth),
  );
  const explorerPanelWidth = ref(clampPanelWidth(prefs.explorerPanelWidth));
  const rightSplitHost = ref<HTMLElement | null>(null);
  const rightSplitWidth = ref(0);
  let rightSplitResizeObserver: ResizeObserver | null = null;
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
      "h-full overflow-hidden bg-panel-bg",
      leftPanelOpen.value ? "border-r border-border/40" : "",
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
      "h-full overflow-hidden bg-panel-bg",
      rightPanelOpen.value ? "border-l border-border/40" : "",
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
    }
    window.addEventListener("resize", measureRightSplitWidth);
    void nextTick(measureRightSplitWidth);
  }

  function stopLayoutObservers() {
    rightSplitResizeObserver?.disconnect();
    rightSplitResizeObserver = null;
    window.removeEventListener("resize", measureRightSplitWidth);
    flushSourceControlWidthSave();
    flushExplorerWidthSave();
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
    leftPanelOpen,
    measureRightSplitWidth,
    panelResizeTriggerSize,
    rightPanelOpen,
    rightSplitHost: rightSplitHost as Ref<HTMLElement | null>,
    rightSplitWidth,
    sourceControlPaneClass,
    sourceControlPanelWidth,
    sourceControlSplitMax,
    sourceControlSplitMin,
    sourceControlSplitSize,
    startLayoutObservers,
    stopLayoutObservers,
    updateExplorerSplitSize,
    updateSourceControlSplitSize,
  };
}
