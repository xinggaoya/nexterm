<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from "vue";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import { writeClipboardText } from "@/lib/clipboard";
import { createSession, trackSession, getSessionForLeaf } from "./lib/sessions";
import type { PtySessionHandle, SessionState } from "./lib/sessions";
import {
  applyTerminalTheme,
  buildTerminalTheme,
  watchTerminalTheme,
} from "./lib/theme";
import {
  attachClipboardShortcuts,
  pasteClipboardIntoTerminal,
} from "./lib/shortcuts";
import {
  createTerminalRenderer,
  type TerminalRenderer,
} from "./lib/renderer";
import TerminalContextMenu from "./TerminalContextMenu.vue";

const props = defineProps<{
  leafId: string;
  cwd?: string;
  title?: string;
  isActive: boolean;
  isFocused: boolean;
  flex: number;
}>();

const emit = defineEmits<{
  cwd: [string];
  title: [string];
  focus: [];
  split: ["row" | "col"];
  close: [];
}>();

const container = ref<HTMLElement>();
const state = ref<SessionState>("connecting");

const menu = ref<{ x: number; y: number; selection: string } | null>(null);

const prefs = usePreferencesPiniaStore();

let renderer: TerminalRenderer | null = null;
let session: PtySessionHandle | null = null;
let resizeObserver: ResizeObserver | null = null;
let detachThemeWatch: (() => void) | null = null;
let detachClipboardShortcuts: (() => void) | null = null;
let mountRevision = 0;

async function ensureSession(): Promise<void> {
  const term = renderer?.term;
  if (session || !term) return;
  const sessionCallbacks = {
    onCwd: (cwd: string) => emit("cwd", cwd),
    onTitle: (title: string) => emit("title", title),
    onStateChange: (next: SessionState) => {
      state.value = next;
    },
  };
  const existing = getSessionForLeaf(props.leafId);
  if (existing) {
    session = existing;
    existing.setCallbacks(sessionCallbacks);
    state.value = existing.getState();
    existing.resize(term.cols, term.rows);
    return;
  }
  const handle = await createSession({
    term,
    cwd: props.cwd,
    callbacks: sessionCallbacks,
  });
  session = handle;
  trackSession(props.leafId, handle);
}

function refreshLayout(): void {
  renderer?.fit();
}

onMounted(async () => {
  const host = container.value;
  if (!host) return;
  const revision = ++mountRevision;
  const nextRenderer = await createTerminalRenderer({
    container: host,
    preferences: {
      fontFamily: prefs.terminalFontFamily,
      fontSize: prefs.terminalFontSize,
      letterSpacing: prefs.terminalLetterSpacing,
      scrollback: prefs.terminalScrollback,
      webglEnabled: prefs.terminalWebglEnabled,
    },
    theme: buildTerminalTheme(),
    onResize: (cols, rows) => session?.resize(cols, rows),
  });
  if (revision !== mountRevision || container.value !== host) {
    nextRenderer.dispose();
    return;
  }
  renderer = nextRenderer;
  detachClipboardShortcuts = attachClipboardShortcuts({
    term: nextRenderer.term,
  });
  await ensureSession();

  detachThemeWatch = watchTerminalTheme(() => {
    if (renderer) applyTerminalTheme(renderer.term);
  });

  resizeObserver = new ResizeObserver(() => {
    if (props.isActive) refreshLayout();
  });
  resizeObserver.observe(host);
});

onBeforeUnmount(() => {
  mountRevision += 1;
  detachThemeWatch?.();
  detachClipboardShortcuts?.();
  resizeObserver?.disconnect();
  renderer?.dispose();
  renderer = null;
  session = null;
});

watch(
  () => props.isActive,
  (active) => {
    if (active) requestAnimationFrame(refreshLayout);
  },
);

watch(
  () => [
    prefs.terminalFontFamily,
    prefs.terminalFontSize,
    prefs.terminalLetterSpacing,
  ] as const,
  ([fontFamily, fontSize, letterSpacing]) => {
    void renderer?.applyTypography({ fontFamily, fontSize, letterSpacing });
  },
);
watch(
  () => prefs.terminalScrollback,
  (n) => {
    renderer?.setScrollback(n);
  },
);
watch(
  () => prefs.terminalWebglEnabled,
  (enabled) => renderer?.setWebglEnabled(enabled),
);

function handleFocus() {
  emit("focus");
}

function openContextMenu(event: MouseEvent) {
  const term = renderer?.term;
  if (!prefs.terminalContextMenuEnabled || !term) return;
  event.preventDefault();
  menu.value = {
    x: event.clientX,
    y: event.clientY,
    selection: term.getSelection(),
  };
}

function closeContextMenu() {
  menu.value = null;
}

function handleMenuCopy() {
  const selection = menu.value?.selection;
  if (selection) void writeClipboardText(selection).catch(() => {});
  closeContextMenu();
}

function handleMenuPaste() {
  const term = renderer?.term;
  if (term) void pasteClipboardIntoTerminal(term).catch(() => {});
  closeContextMenu();
}

function handleMenuSelectAll() {
  renderer?.term.selectAll();
  closeContextMenu();
}

defineExpose({
  focus: () => renderer?.term.focus(),
  write: (data: string) => session?.write(data),
});
</script>

<template>
  <div
    class="terminal-pane flex flex-col"
    :class="{ focused: isFocused, exited: state === 'exited' }"
    :style="{ flex: String(flex) }"
    @mousedown="handleFocus"
    @contextmenu="openContextMenu"
  >
    <div ref="container" class="terminal-pane-body" />
    <Teleport to="body">
      <TerminalContextMenu
        v-if="menu"
        :x="menu.x"
        :y="menu.y"
        :selection="menu.selection"
        @close="closeContextMenu"
        @copy="handleMenuCopy"
        @paste="handleMenuPaste"
        @select-all="handleMenuSelectAll"
      />
    </Teleport>
  </div>
</template>

<style scoped>
.terminal-pane {
  position: relative;
  overflow: hidden;
  contain: layout style;
  background: var(--term-bg);
  color: var(--term-pane-fg);
  min-width: 0;
  min-height: 0;
}
.terminal-pane.exited .terminal-pane-body {
  opacity: 0.55;
  filter: grayscale(0.4);
}
.terminal-pane-body {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  position: relative;
  background: var(--term-bg);
  overflow: hidden;
  padding: 6px 8px 4px;
}
.terminal-pane.focused .terminal-pane-body {
  outline: 0;
}
</style>

<style>
.terminal-pane-body > .xterm {
  height: 100% !important;
  width: 100% !important;
}
.terminal-pane-body .xterm-viewport {
  background-color: transparent !important;
}
.terminal-pane-body .xterm .xterm-screen canvas {
  outline: none;
}
</style>
