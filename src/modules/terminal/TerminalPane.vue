<script setup lang="ts">
import type { SearchAddon } from "@xterm/addon-search";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useTouchDevicePreference } from "@/lib/touchDevice";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import {
  applyFontFamily,
  applyFontSize,
  applyLetterSpacing,
  applyScrollback,
  applyWebglPreference,
} from "./lib/rendererPool";
import {
  createTerminalSessionHandle,
  applyTerminalSessionScrollback,
  mountTerminalSession,
  updateTerminalSessionVisibility,
} from "./lib/terminalSessionCore";
import TerminalSelectionToolbar from "./TerminalSelectionToolbar.vue";

const props = withDefaults(
  defineProps<{
    leafId: number;
    visible: boolean;
    focused?: boolean;
    initialCwd?: string;
    startupInput?: string;
  }>(),
  {
    focused: true,
    initialCwd: undefined,
    startupInput: undefined,
  },
);

const emit = defineEmits<{
  searchReady: [leafId: number, addon: SearchAddon];
  exit: [leafId: number, code: number];
  cwd: [leafId: number, cwd: string];
  title: [leafId: number, title: string];
  selectionChange: [leafId: number];
}>();

const prefs = usePreferencesPiniaStore();
const { effectiveTouch } = useTouchDevicePreference();
const container = ref<HTMLDivElement | null>(null);
const toolbarVisible = ref(false);
let cleanup: (() => void) | undefined;
let touchStartY = 0;
let touchLastY = 0;
let touchMoved = false;
let longPressTimer: number | null = null;
const LONG_PRESS_MS = 300;
const SCROLL_MOVE_THRESHOLD = 4;
const WHEEL_SENSITIVITY = 1;

function syncCurrentVisibility() {
  updateTerminalSessionVisibility(props.leafId, props.visible, props.focused);
}

function clearLongPress() {
  if (longPressTimer !== null) {
    window.clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function dispatchWheel(deltaY: number) {
  const host = container.value;
  if (!host) return;
  const wheel = new WheelEvent("wheel", {
    deltaY: deltaY * WHEEL_SENSITIVITY,
    bubbles: true,
    cancelable: true,
  });
  host.dispatchEvent(wheel);
}

function handleTouchStart(event: TouchEvent) {
  if (!effectiveTouch.value) return;
  if (event.touches.length !== 1) {
    clearLongPress();
    return;
  }
  const touch = event.touches[0];
  touchStartY = touch.clientY;
  touchLastY = touch.clientY;
  touchMoved = false;
  clearLongPress();
  longPressTimer = window.setTimeout(() => {
    longPressTimer = null;
    if (touchMoved) return;
    showToolbar();
  }, LONG_PRESS_MS);
}

function handleTouchMove(event: TouchEvent) {
  if (!effectiveTouch.value) return;
  if (event.touches.length !== 1) {
    clearLongPress();
    return;
  }
  const touch = event.touches[0];
  const deltaY = touch.clientY - touchLastY;
  if (!touchMoved) {
    if (Math.abs(touch.clientY - touchStartY) < SCROLL_MOVE_THRESHOLD) return;
    touchMoved = true;
    clearLongPress();
  }
  touchLastY = touch.clientY;
  if (Math.abs(deltaY) < 0.5) return;
  event.preventDefault();
  // Touch moves down (clientY increases) should scroll the terminal buffer up,
  // which in wheel semantics is a negative deltaY.
  dispatchWheel(-deltaY);
}

function handleTouchEnd() {
  clearLongPress();
  touchMoved = false;
}

function showToolbar() {
  toolbarVisible.value = true;
  emit("selectionChange", props.leafId);
}

function hideToolbar() {
  toolbarVisible.value = false;
}

onMounted(() => {
  const host = container.value;
  if (!host) return;
  cleanup = mountTerminalSession({
    leafId: props.leafId,
    container: host,
    initialCwd: props.initialCwd,
    startupInput: props.startupInput,
    callbacks: {
      onSearchReady: (addon) => emit("searchReady", props.leafId, addon),
      onExit: (code) => emit("exit", props.leafId, code),
      onCwd: (cwd) => emit("cwd", props.leafId, cwd),
      onTitle: (title) => emit("title", props.leafId, title),
      onSelectionChange: () => {
        if (toolbarVisible.value) {
          emit("selectionChange", props.leafId);
        }
      },
    },
  });
  syncCurrentVisibility();
  host.addEventListener("touchstart", handleTouchStart, { passive: true });
  host.addEventListener("touchmove", handleTouchMove, { passive: false });
  host.addEventListener("touchend", handleTouchEnd, { passive: true });
  host.addEventListener("touchcancel", handleTouchEnd, { passive: true });
});

onBeforeUnmount(() => {
  clearLongPress();
  cleanup?.();
  const host = container.value;
  if (host) {
    host.removeEventListener("touchstart", handleTouchStart);
    host.removeEventListener("touchmove", handleTouchMove);
    host.removeEventListener("touchend", handleTouchEnd);
    host.removeEventListener("touchcancel", handleTouchEnd);
  }
});

watch(
  () => [props.leafId, props.visible, props.focused] as const,
  ([leafId, visible, focused]) => {
    updateTerminalSessionVisibility(leafId, visible, focused);
    if (!focused) hideToolbar();
  },
);

watch(
  () => [prefs.terminalFontSize, prefs.zoomLevel] as const,
  ([fontSize, zoomLevel]) => {
    applyFontSize(Math.max(4, Math.round(fontSize * zoomLevel)));
  },
  { immediate: true },
);

watch(
  () => prefs.terminalFontFamily,
  (fontFamily) => applyFontFamily(fontFamily),
  { immediate: true },
);

watch(
  () => prefs.terminalLetterSpacing,
  (letterSpacing) => applyLetterSpacing(letterSpacing),
  { immediate: true },
);

watch(
  () => prefs.terminalScrollback,
  (scrollback) => {
    applyScrollback(scrollback);
    applyTerminalSessionScrollback(scrollback);
  },
  { immediate: true },
);

watch(
  () => prefs.terminalWebglEnabled,
  (enabled) => applyWebglPreference(enabled),
  { immediate: true },
);

defineExpose({
  write: (data: string) => createTerminalSessionHandle(props.leafId).write(data),
  focus: () => createTerminalSessionHandle(props.leafId).focus(),
  getBuffer: (maxLines?: number) =>
    createTerminalSessionHandle(props.leafId).getBuffer(maxLines),
  getSelection: () => createTerminalSessionHandle(props.leafId).getSelection(),
  applyTheme: () => createTerminalSessionHandle(props.leafId).applyTheme(),
});

const toolbarHost = computed(() => container.value);
</script>

<template>
  <div
    class="relative h-full w-full"
    :style="{
      visibility: visible ? 'visible' : 'hidden',
      pointerEvents: visible ? 'auto' : 'none',
    }"
  >
    <div
      ref="container"
      class="nexterm-terminal-scrollbar zoom-exempt h-full w-full"
    />
    <TerminalSelectionToolbar
      :leaf-id="leafId"
      :container="toolbarHost"
      :visible="toolbarVisible"
      :focused="focused"
      @close="hideToolbar"
      @select="hideToolbar"
    />
  </div>
</template>
