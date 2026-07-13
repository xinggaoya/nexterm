<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import { createSession, trackSession, getSessionForLeaf } from "./lib/sessions";
import type { PtySessionHandle, SessionState } from "./lib/sessions";
import { applyTerminalTheme, watchTerminalTheme } from "./lib/theme";
import { attachClipboardShortcuts } from "./lib/shortcuts";
import TerminalPaneHeader from "./TerminalPaneHeader.vue";
import TerminalPaneFooter from "./TerminalPaneFooter.vue";

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
const exitCode = ref<number | null>(null);
const dims = ref<{ cols: number; rows: number }>({ cols: 0, rows: 0 });
const shellName = computed(() => {
  const t = props.title ?? "";
  const slash = Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\"));
  return slash >= 0 ? t.slice(slash + 1) : t;
});

const prefs = usePreferencesPiniaStore();

let term: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let session: PtySessionHandle | null = null;
let resizeObserver: ResizeObserver | null = null;
let detachThemeWatch: (() => void) | null = null;

async function ensureSession(): Promise<void> {
  if (session || !term) return;
  const sessionCallbacks = {
    onCwd: (cwd: string) => emit("cwd", cwd),
    onTitle: (title: string) => emit("title", title),
    onStateChange: (next: SessionState, code?: number) => {
      state.value = next;
      if (code !== undefined) exitCode.value = code;
    },
  };
  const existing = getSessionForLeaf(props.leafId);
  if (existing) {
    session = existing;
    existing.setCallbacks(sessionCallbacks);
    state.value = existing.getState();
    exitCode.value = existing.getExitCode() ?? null;
    syncSessionCallbacks();
    return;
  }
  const handle = await createSession({
    term,
    cwd: props.cwd,
    callbacks: sessionCallbacks,
  });
  session = handle;
  trackSession(props.leafId, handle);
  syncSessionCallbacks();
}

function syncSessionCallbacks() {
  if (!term || !session) return;
  attachClipboardShortcuts({
    term,
    session,
    enabled: prefs.terminalContextMenuEnabled,
  });
}

function attachWebgl() {
  if (!term) return;
  if (!prefs.terminalWebglEnabled) return;
  try {
    const addon = new WebglAddon();
    addon.onContextLoss(() => {
      try {
        addon.dispose();
      } catch {
        // re-attach path tries again below
      }
      requestAnimationFrame(attachWebgl);
    });
    term.loadAddon(addon);
  } catch {
    // WebGL unavailable; canvas addon takes over automatically.
  }
}

function recordDims(): void {
  if (!term) return;
  dims.value = { cols: term.cols, rows: term.rows };
}

async function refreshLayout(): Promise<void> {
  if (!fitAddon || !term) return;
  fitAddon.fit();
  recordDims();
  if (session) session.resize(term.cols, term.rows);
}

onMounted(async () => {
  if (!container.value) return;
  term = new Terminal({
    cursorBlink: true,
    fontSize: prefs.terminalFontSize,
    fontFamily:
      prefs.terminalFontFamily ||
      'JetBrainsMono Nerd Font, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
    scrollback: prefs.terminalScrollback,
    allowProposedApi: true,
    convertEol: false,
  });
  applyTerminalTheme(term);
  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());
  term.loadAddon(new SearchAddon());
  attachWebgl();

  term.open(container.value);
  await refreshLayout();
  await ensureSession();

  detachThemeWatch = watchTerminalTheme(() => {
    if (term) applyTerminalTheme(term);
  });

  resizeObserver = new ResizeObserver(() => {
    if (props.isActive) void refreshLayout();
  });
  resizeObserver.observe(container.value);
});

onBeforeUnmount(() => {
  detachThemeWatch?.();
  resizeObserver?.disconnect();
  term?.dispose();
  term = null;
  fitAddon = null;
  session = null;
});

watch(
  () => props.isActive,
  (active) => {
    if (active) requestAnimationFrame(() => void refreshLayout());
  },
);

watch(
  () => prefs.terminalFontSize,
  () => requestAnimationFrame(() => void refreshLayout()),
);
watch(
  () => prefs.terminalFontFamily,
  () => requestAnimationFrame(() => void refreshLayout()),
);
watch(
  () => prefs.terminalScrollback,
  (n) => {
    if (term) term.options.scrollback = n;
  },
  { immediate: true },
);

function handleFocus() {
  emit("focus");
}

function handleHeaderCwdClick() {
  if (props.cwd) {
    void import("@/lib/clipboard").then((m) =>
      m.writeClipboardText(props.cwd!),
    );
  }
}

function handleHeaderSplit(dir: "row" | "col") {
  emit("split", dir);
}

function handleHeaderRestart() {
  session?.restart();
}

defineExpose({
  focus: () => term?.focus(),
  write: (data: string) => term?.write(data),
});
</script>

<template>
  <div
    class="terminal-pane flex flex-col"
    :class="{ focused: isFocused, exited: state === 'exited' }"
    :style="{ flex: String(flex) }"
    @mousedown="handleFocus"
  >
    <TerminalPaneHeader
      :leaf-id="leafId"
      :cwd="cwd"
      :shell-name="shellName"
      :state="state"
      :exit-code="exitCode"
      @close="emit('close')"
      @split="handleHeaderSplit"
      @restart="handleHeaderRestart"
      @cwd-click="handleHeaderCwdClick"
    />
    <div ref="container" class="terminal-pane-body" />
    <TerminalPaneFooter
      :state="state"
      :exit-code="exitCode"
      :dims="dims"
    />
  </div>
</template>

<style scoped>
.terminal-pane {
  position: relative;
  overflow: hidden;
  contain: layout style;
  background: var(--term-pane-bg);
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
  padding: 4px 8px;
}
.terminal-pane.focused .terminal-pane-body {
  outline: 0;
}
</style>

<style>
.terminal-pane-body .xterm,
.terminal-pane-body .xterm-viewport,
.terminal-pane-body .xterm-screen,
.terminal-pane-body .xterm .xterm-screen {
  height: 100% !important;
  width: 100% !important;
  padding: 0 !important;
}
.terminal-pane-body .xterm-viewport {
  background-color: transparent !important;
}
.terminal-pane-body .xterm .xterm-screen canvas {
  outline: none;
}
</style>
