<script setup lang="ts">
import type { SearchAddon } from "@xterm/addon-search";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { readClipboardText, writeClipboardText } from "@/lib/clipboard";
import { useTouchDevicePreference } from "@/lib/touchDevice";
import { t as translate } from "@/modules/i18n/translate";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import {
  applyFontFamily,
  applyFontSize,
  applyLetterSpacing,
  applyScrollback,
  applyWebglPreference,
  getLeafTerm,
} from "./lib/rendererPool";
import {
  createTerminalSessionHandle,
  applyTerminalSessionScrollback,
  mountTerminalSession,
  updateTerminalSessionVisibility,
} from "./lib/terminalSessionCore";

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
}>();

const prefs = usePreferencesPiniaStore();
const { effectiveTouch } = useTouchDevicePreference();
const container = ref<HTMLDivElement | null>(null);
const contextMenu = ref<{ x: number; y: number; hasSelection: boolean } | null>(null);
const menuEl = ref<HTMLElement | null>(null);
let cleanup: (() => void) | undefined;
let touchLastY = 0;
const WHEEL_SENSITIVITY = 1;

function syncCurrentVisibility() {
  updateTerminalSessionVisibility(props.leafId, props.visible, props.focused);
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

function handleTouchMove(event: TouchEvent) {
  if (!effectiveTouch.value) return;
  if (event.touches.length !== 1) return;
  const touch = event.touches[0];
  const deltaY = touch.clientY - touchLastY;
  touchLastY = touch.clientY;
  if (Math.abs(deltaY) < 0.5) return;
  event.preventDefault();
  // Touch moves down (clientY increases) should scroll the terminal buffer up,
  // which in wheel semantics is a negative deltaY.
  dispatchWheel(-deltaY);
}

function getSelectionText(): string {
  return getLeafTerm(props.leafId)?.getSelection() ?? "";
}

function handleContextMenu(event: MouseEvent) {
  // When the user disables the custom terminal context menu in settings, let
  // the browser/xterm default menu take over (it ships copy / paste / select
  // all out of the box). We deliberately don't preventDefault so the native
  // menu can render and so the global `preventNativeContextMenu` handler in
  // MainApp.vue doesn't have to know about this preference.
  if (!prefs.terminalContextMenuEnabled) return;
  event.preventDefault();
  const host = container.value;
  if (!host) return;
  const rect = host.getBoundingClientRect();
  contextMenu.value = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    hasSelection: getSelectionText() !== "",
  };
}

function closeContextMenu() {
  contextMenu.value = null;
}

function handleDocumentPointerDown(event: PointerEvent) {
  if (!contextMenu.value) return;
  const target = event.target as Node | null;
  if (target && menuEl.value && menuEl.value.contains(target)) return;
  closeContextMenu();
}

async function handleContextCopy() {
  const text = getSelectionText();
  if (!text) return;
  await writeClipboardText(text);
  closeContextMenu();
}

async function handleContextPaste() {
  const term = getLeafTerm(props.leafId);
  if (!term) return;
  const text = await readClipboardText();
  if (text) term.paste(text);
  closeContextMenu();
}

function handleContextSelectAll() {
  const term = getLeafTerm(props.leafId);
  if (!term) return;
  term.selectAll();
  if (contextMenu.value) {
    contextMenu.value = { ...contextMenu.value, hasSelection: true };
  }
  closeContextMenu();
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
    },
  });
  syncCurrentVisibility();
  host.addEventListener("touchmove", handleTouchMove, { passive: false });
  host.addEventListener("contextmenu", handleContextMenu);
  document.addEventListener("pointerdown", handleDocumentPointerDown, true);
});

onBeforeUnmount(() => {
  cleanup?.();
  closeContextMenu();
  const host = container.value;
  if (host) {
    host.removeEventListener("touchmove", handleTouchMove);
    host.removeEventListener("contextmenu", handleContextMenu);
  }
  document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
});
watch(
  () => [props.leafId, props.visible, props.focused] as const,
  ([leafId, visible, focused]) => {
    updateTerminalSessionVisibility(leafId, visible, focused);
    if (!focused) closeContextMenu();
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
      class="nexterm-terminal-scrollbar zoom-exempt h-full w-full rounded-sm focus-within:ring-1 focus-within:ring-terminal-focus"
    />
    <div
      v-if="contextMenu"
      ref="menuEl"
      data-terminal-context-menu
      role="menu"
      class="pointer-events-auto absolute z-30 min-w-32 rounded-md border border-border/60 bg-card py-1 text-foreground shadow-md"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
    >
      <button
        type="button"
        data-terminal-context-action="copy"
        :disabled="!contextMenu.hasSelection"
        class="block w-full px-3 py-1 text-left text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        @click="handleContextCopy"
      >
        {{ translate("common.copy") }}
      </button>
      <button
        type="button"
        data-terminal-context-action="paste"
        class="block w-full px-3 py-1 text-left text-xs hover:bg-accent"
        @click="handleContextPaste"
      >
        {{ translate("common.paste") }}
      </button>
      <button
        type="button"
        data-terminal-context-action="select-all"
        class="block w-full px-3 py-1 text-left text-xs hover:bg-accent"
        @click="handleContextSelectAll"
      >
        {{ translate("common.selectAll") }}
      </button>
    </div>
  </div>
</template>