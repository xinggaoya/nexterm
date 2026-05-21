<script setup lang="ts">
import type { SearchAddon } from "@xterm/addon-search";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
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
  mountTerminalSession,
  updateTerminalSessionVisibility,
} from "./lib/terminalSessionCore";

const props = withDefaults(
  defineProps<{
    leafId: number;
    visible: boolean;
    focused?: boolean;
    initialCwd?: string;
  }>(),
  {
    focused: true,
    initialCwd: undefined,
  },
);

const emit = defineEmits<{
  searchReady: [leafId: number, addon: SearchAddon];
  exit: [leafId: number, code: number];
  cwd: [leafId: number, cwd: string];
}>();

const prefs = usePreferencesPiniaStore();
const container = ref<HTMLDivElement | null>(null);
let cleanup: (() => void) | undefined;

onMounted(() => {
  if (!container.value) return;
  cleanup = mountTerminalSession({
    leafId: props.leafId,
    container: container.value,
    initialCwd: props.initialCwd,
    callbacks: {
      onSearchReady: (addon) => emit("searchReady", props.leafId, addon),
      onExit: (code) => emit("exit", props.leafId, code),
      onCwd: (cwd) => emit("cwd", props.leafId, cwd),
    },
  });
});

onBeforeUnmount(() => {
  cleanup?.();
});

watch(
  () => [props.leafId, props.visible, props.focused] as const,
  ([leafId, visible, focused]) => {
    updateTerminalSessionVisibility(leafId, visible, focused);
  },
  { immediate: true },
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
  (scrollback) => applyScrollback(scrollback),
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
    ref="container"
    class="zoom-exempt h-full w-full"
    :style="{
      visibility: visible ? 'visible' : 'hidden',
      pointerEvents: visible ? 'auto' : 'none',
    }"
  />
</template>
