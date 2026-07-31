<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from "vue";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import {
  readClipboardText,
  writeClipboardText,
} from "@/lib/clipboard";
import { createSession, trackSession, getSessionForLeaf, disposeSession } from "./lib/sessions";
import type { PtySessionHandle, SessionState } from "./lib/sessions";
import { tryWorkspaceContext } from "@/app/workspaceContext";
import {
  applyTerminalTheme,
  watchTerminalTheme,
} from "./lib/theme";
import { attachClipboardShortcuts } from "./lib/shortcuts";
import {
  createTerminalRenderer,
  type TerminalRenderer,
  type TerminalRendererPreferences,
} from "./lib/renderer";
import type { FontPreference } from "./lib/fontStack";
import type { RendererKind } from "./lib/rendererPipeline";
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
  renderer: [RendererKind];
}>();

const container = ref<HTMLElement>();
const state = ref<SessionState>("connecting");

const menu = ref<{ x: number; y: number; selection: string } | null>(null);

const prefs = usePreferencesPiniaStore();

// 终端必须在 WorkspaceHost 内渲染：通过注入的 workspace 上下文拿到
// workspaceId（用于按工作区分片的 session 注册表）与 wsNative（env 绑定的
// native 调用面，pty 会在正确的环境里启动）。
const wsCtx = tryWorkspaceContext();
if (!wsCtx) {
  throw new Error(
    "TerminalPane: no workspace context provided. The terminal must be rendered inside a WorkspaceHost.",
  );
}

let renderer: TerminalRenderer | null = null;
let session: PtySessionHandle | null = null;
let resizeObserver: ResizeObserver | null = null;
let detachThemeWatch: (() => void) | null = null;
let detachClipboardShortcuts: (() => void) | null = null;
let mountRevision = 0;
/**
 * 上一次 ResizeObserver 回调观察到的容器尺寸。用于检测「容器从隐藏
 * (display:none,0 尺寸) 切回可见」的状态跳变 —— 切换工作区靠 v-show
 * 实现,而 isActive prop 依赖的 tabs.activeIdByWorkspace 在工作区切换时
 * 不变,watch(isActive) 不会触发;但 ResizeObserver 会因 0→非0 尺寸跳变
 * 而触发(见 https://github.com/w3c/csswg-drafts/issues/7808),这是检测
 * 工作区切回的可靠信号。
 */
let lastObservedW = 0;
let lastObservedH = 0;

/** 假死重建的最大重试次数（WD 上 WSL 冷启动典型 1~2 次即可成功）。 */
const MAX_DEAD_START_RETRIES = 3;
/** 假死重建之间的退避（ms），让 WSL 上一次的预热有时间生效。 */
const DEAD_START_RETRY_DELAY_MS = 300;
/** 当前会话的冷启动假死重建次数统计。 */
let deadStartRetries = 0;
/** 防重入标志：一次只能有一段重建流程在跑。 */
let deadStartInFlight = false;
/** watch(isActive) 内部使用的延时器句柄，便于组件卸载时清理。 */
let deadStartRetryTimer: ReturnType<typeof setTimeout> | null = null;

function buildPreferences(): TerminalRendererPreferences {
  const fontPref: FontPreference = {
    presetName: prefs.terminalFontFamily,
    nerdFontEnabled: prefs.terminalNerdFontEnabled,
    cjkEnabled: prefs.terminalCjkFontEnabled,
    emojiEnabled: prefs.terminalEmojiFontEnabled,
  };
  return {
    fontFamily: prefs.terminalFontFamily,
    fontSize: prefs.terminalFontSize,
    letterSpacing: prefs.terminalLetterSpacing,
    fontWeight: prefs.terminalFontWeight,
    fontWeightBold: prefs.terminalFontWeightBold,
    scrollback: prefs.terminalScrollback,
    renderer: prefs.terminalRenderer,
    rendererAutoFallback: prefs.terminalRendererAutoFallback,
    watchDpi: true,
    cursorStyle: prefs.terminalCursorStyle,
    cursorBlink: prefs.terminalCursorBlink,
    cursorInactiveStyle: prefs.terminalCursorInactiveStyle,
    fastScrollSensitivity: prefs.terminalFastScrollSensitivity,
    fastScrollModifier: prefs.terminalFastScrollModifier,
    macOptionIsMeta: prefs.terminalMacOptionIsMeta,
    macOptionClickForcesSelection: prefs.terminalMacOptionClickForcesSelection,
    minimumContrastRatio: prefs.terminalMinimumContrastRatio,
    drawBoldTextInBrightColors: prefs.terminalDrawBoldTextInBrightColors,
    customGlyphs: prefs.terminalCustomGlyphs,
    rescaleOverlappingGlyphs: prefs.terminalRescaleOverlappingGlyphs,
    font: fontPref,
    clipboard: {
      readText: () => readClipboardText(),
      writeText: (text) => writeClipboardText(text),
    },
  };
}

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
  const existing = getSessionForLeaf(wsCtx!.workspace.id, props.leafId);
  if (existing) {
    session = existing;
    existing.setCallbacks(sessionCallbacks);
    // split / close-leaf 触发的 TerminalPane remount 会让旧 xterm 被 dispose。
    // 这里把 session 重新挂到当前新 xterm:PTY 输出从下一帧开始落到新 xterm,
    // 新 xterm 的用户键入也重新接回 PTY。PTY 进程本身不变。
    existing.rebindTerm(term);
    state.value = existing.getState();
    existing.resize(term.cols, term.rows);
    return;
  }
  const handle = await createSession({
    term,
    cwd: props.cwd,
    callbacks: sessionCallbacks,
    wsNative: wsCtx!.wsNative,
    // 启动 watchdog 检测到 shell 假死（WSL 冷启动常见）时的回调：销毁坏
    // session 并延迟重建。第二次 pty_open 命中已预热的 WSL，会成功。
    onDeadStart: () => {
      if (deadStartInFlight) return;
      deadStartInFlight = true;
      // 销毁坏 session 并从 registry 移除。dispose() 内部已会清 watchdog。
      disposeSession(wsCtx!.workspace.id, props.leafId);
      session = null;
      state.value = "connecting";
      if (deadStartRetries >= MAX_DEAD_START_RETRIES) {
        console.warn(
          "[terminal] dead-start rebuild exhausted after " +
            `${MAX_DEAD_START_RETRIES} retries`,
        );
        state.value = "exited";
        deadStartInFlight = false;
        return;
      }
      deadStartRetries += 1;
      if (deadStartRetryTimer !== null) clearTimeout(deadStartRetryTimer);
      deadStartRetryTimer = setTimeout(() => {
        deadStartRetryTimer = null;
        if (mountRevision !== currentMountRevision()) return;
        deadStartInFlight = false;
        void ensureSession().catch((err) => {
          console.warn("[terminal] dead-start rebuild failed:", err);
        });
      }, DEAD_START_RETRY_DELAY_MS);
    },
  });
  session = handle;
  trackSession(wsCtx!.workspace.id, props.leafId, handle);
}

/** 读取当前的 mountRevision（用于异步回调里检查 pane 是否已被卸载重建）。 */
function currentMountRevision(): number {
  return mountRevision;
}

function refreshLayout(): void {
  renderer?.fit();
}

onMounted(async () => {
  const host = container.value;
  if (!host) return;
  const revision = ++mountRevision;
  // await 期间用户可能改了 prefs(例如快速切到 settings 切回渲染器),
  // 因此在挂上 renderer 后立即用最新 prefs 重应用一次,避免用旧快照创建。
  const nextRenderer = await createTerminalRenderer({
    container: host,
    preferences: buildPreferences(),
    onResize: (cols, rows) => session?.resize(cols, rows),
  });
  if (revision !== mountRevision || container.value !== host) {
    nextRenderer.dispose();
    return;
  }
  renderer = nextRenderer;
  // 用最新的偏好覆盖 renderer 创建时的快照
  if (prefs.terminalRenderer !== nextRenderer.activeRenderer()) {
    nextRenderer.setRenderer(prefs.terminalRenderer);
  }
  emit("renderer", nextRenderer.activeRenderer());

  detachClipboardShortcuts = attachClipboardShortcuts({
    term: nextRenderer.term,
  });
  // ensureSession 失败(如冷启动工作区授权竞态、shell 启动失败)以往是静默
  // unhandled rejection,导致 session 永远为 null、键盘输入无处可去、面板
  // 卡在空白。这里捕获并把状态标记为 exited;watch(isActive) 会在面板再次
  // 激活时重试一次。
  try {
    await ensureSession();
  } catch (err) {
    state.value = "exited";
    console.warn(
      "[terminal] ensureSession failed, will retry on next activation:",
      err,
    );
  }

  detachThemeWatch = watchTerminalTheme(() => {
    if (renderer) applyTerminalTheme(renderer.term);
  });

  resizeObserver = new ResizeObserver((entries) => {
    // 切换工作区靠 MainApp.vue 的 v-show 实现,display:none 时容器尺寸归 0,
    // 切回时尺寸恢复。但 TerminalPane 的 isActive prop 依赖的
    // tabs.activeIdByWorkspace 在工作区切换时不变 —— 所以 watch(isActive)
    // 不会因工作区切换而触发,无法作为补画信号。ResizeObserver 会因
    // 0→非0 尺寸跳变触发(往返两次:隐藏报 0,切回报原尺寸),这是检测工作区
    // 切回的可靠信号。见 https://github.com/w3c/csswg-drafts/issues/7808。
    const rect = entries[0]?.contentRect;
    const w = rect ? rect.width : 0;
    const h = rect ? rect.height : 0;
    const becameVisible = lastObservedW === 0 && lastObservedH === 0 && w > 0 && h > 0;
    console.log("[diag] ResizeObserver w", w, "h", h, "prev", lastObservedW, lastObservedH, "becameVisible", becameVisible, "isActive", props.isActive);
    lastObservedW = w;
    lastObservedH = h;

    if (props.isActive) refreshLayout();
    // 容器从隐藏切回可见:display:none 期间 canvas 被浏览器跳过绘制,xterm
    // (WebGL 状态化)切回后不会自动补画 buffer。这里在 rAF 里(等布局落定)
    // 强制 redraw,把 buffer 刷到 canvas/WebGL 纹理上,避免"切回后内容缺失、
    // 需输入字符才补出"。分屏里所有 pane 都可能受影响,故不看 isActive。
    if (becameVisible) {
      requestAnimationFrame(() => {
        renderer?.redraw();
      });
    }
  });
  resizeObserver.observe(host);
});

onBeforeUnmount(() => {
  mountRevision += 1;
  // 清理假死重建延时器,避免在 pane 已卸载后 setTimeout 回调访问空 renderer/session。
  if (deadStartRetryTimer !== null) {
    clearTimeout(deadStartRetryTimer);
    deadStartRetryTimer = null;
  }
  deadStartInFlight = false;
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
    if (!active) return;
    // 容器从 display:none 切回可见时,canvas 在隐藏期间被浏览器跳过绘制,
    // xterm 不会自动补画。顺序：先 fit（让 cols/rows 落定,rAF 一次让浏览器
    // 完成布局,沿用 8a6605e 的 fit 下界守卫避免 2x1 透传到 shell）,
    // 再 redraw 强制把 buffer 一次性刷到 canvas/WebGL 纹理上,避免
    // "切回后内容缺失、需输入字符才补出"的视觉故障。
    requestAnimationFrame(() => {
      refreshLayout();
      renderer?.redraw();
    });
    // 注:不再在此处重试 ensureSession —— 对于首个终端(生来 active),
    // isActive 不会发生 false→true 跳变,watch 永远不触发,重试无效。
    // 真正的恢复路径是 createSession 内的启动 watchdog + onDeadStart 重建。
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
  () => prefs.terminalRenderer,
  (kind) => {
    renderer?.setRenderer(kind);
    emit("renderer", renderer?.activeRenderer() ?? "dom");
  },
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
  if (term) void readClipboardText().then((text) => text && term.paste(text)).catch(() => {});
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
    <!--
      TerminalContextMenu 内部使用 NDropdown，NDropdown 默认 Teleport 到 body，
      此处不必再额外包一层 Teleport，避免与 NDropdown 的 teleport 重复造成双重定位。
    -->
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
  padding: var(--term-padding-y, 4px) var(--term-padding-x, 8px);
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