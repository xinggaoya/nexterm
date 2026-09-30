<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
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
import { t } from "@/modules/i18n/translate";
import { attachTerminalBell } from "./lib/bell";
import { useDialog } from "naive-ui";
import {
  classifyPaste,
  needsPasteConfirmation,
} from "./lib/pasteGuard";
import {
  createTerminalRenderer,
  type TerminalRenderer,
  type TerminalRendererPreferences,
} from "./lib/renderer";
import type { FontPreference } from "./lib/fontStack";
import type { RendererKind } from "./lib/rendererPipeline";
import type { PaneStatus } from "./lib/paneStatus";
import { ArrowDownOutline } from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import TerminalContextMenu from "./TerminalContextMenu.vue";
import TerminalPaneHeader from "./TerminalPaneHeader.vue";
import TerminalSearch from "./TerminalSearch.vue";

const props = defineProps<{
  leafId: string;
  cwd?: string;
  title?: string;
  isActive: boolean;
  isFocused: boolean;
  flex: number;
  /** 整个标签只有这一条分屏（关掉它 = 关掉标签）。 */
  onlyPane?: boolean;
  /** 分屏数是否已达上限（上限时隐藏标题栏的分屏按钮）。 */
  canSplit?: boolean;
}>();

const emit = defineEmits<{
  cwd: [string];
  title: [string];
  focus: [];
  split: ["row" | "col"];
  close: [];
  /** 请求重命名本分屏的标题（复用宿主的 RenameTerminalDialog）。 */
  rename: [];
  renderer: [RendererKind];
  /**
   * 上报本分屏的终端状态摘要（尺寸 / 渲染器 / 会话状态）。
   *
   * 终端的 `cols×rows` 直接决定 TUI 工具的布局，而用户的窗口在画布里只占
   * 一部分，标题栏上没有任何地方能告诉他现在到底是多少列。这里把尺寸、实际
   * 生效的渲染器（设置里选的和 WebGL 回退后真正在跑的可能不同）、会话状态
   * 汇总上抛，宿���填进状态坞。
   */
  "pane-status": [status: PaneStatus];
}>();

const container = ref<HTMLElement>();
const state = ref<SessionState>("connecting");
const exitCode = ref<number | undefined>(undefined);

// ── 回到底部 ──────────────────────────────────────────────────────────
/**
 * 视口距底部多少行。
 *
 * TUI AI 工具（claude code / opencode / aider）会持续吐输出；用户上翻看旧
 * 画面时完全不知道底下已经刷了多少行。没有这个数字就只能反复按 End 试探。
 */
const linesFromBottom = ref(0);
let detachScrollWatch: { dispose: () => void } | null = null;
let detachSearchWatch: { dispose: () => void } | null = null;

function updateLinesFromBottom(): void {
  const next = renderer?.linesFromBottom() ?? 0;
  if (next !== linesFromBottom.value) linesFromBottom.value = next;
}

function scrollToBottom(): void {
  renderer?.scrollToBottom();
  updateLinesFromBottom();
}

// ── 终端内查找（Ctrl+F）───────────────────────────────────────────────
// 组件与 SearchAddon 此前都已存在（addon 装好、index.ts 也导出了），但零引用：
// 终端里 Ctrl+F 根本不工作。
const searchOpen = ref(false);
const searchQuery = ref("");
const searchResult = ref<{ index: number; total: number } | null>(null);
/** 上一次是往前找还是往后找：连按同一个键时应该保持同一个方向。 */
const searchLastDirection = ref(1);
/**
 * 查找高亮配色。
 *
 * SearchAddon 要求 `#RRGGBB`，而主题里的 `--term-selection` 是带 alpha 的
 * oklch/rgb，无法直接喂进去；而 `decorations` 一旦传入就必须给全
 * `matchOverviewRuler` / `activeMatchColorOverviewRuler`（addon 不给默认值，
 * 缺了就抛）。这两个 overviewRuler 颜色在本应用里恒为透明 —— theme.ts 已经
 * 把 OverviewRulerRenderer 抹掉了。
 */
const searchOptions = {
  incremental: false,
  decorations: {
    matchBackground: "#3f6212",
    matchBorder: "#84cc16",
    activeMatchBackground: "#166534",
    matchOverviewRuler: "transparent",
    activeMatchColorOverviewRuler: "transparent",
  },
} as const;

function runSearch(query: string, incremental: boolean): void {
  const addon = renderer?.search;
  searchQuery.value = query;
  if (!addon) return;
  if (!query) {
    // 清空时收掉高亮，但不动用户已有的滚动位置。
    addon.clearDecorations();
    searchResult.value = null;
    return;
  }
  addon.findNext(query, { ...searchOptions, incremental });
}

function findNext(): void {
  const addon = renderer?.search;
  if (!addon) return;
  const forward = searchLastDirection.value >= 0;
  if (forward) addon.findNext(searchQuery.value, searchOptions);
  else addon.findPrevious(searchQuery.value, searchOptions);
}

function findPrevious(): void {
  const addon = renderer?.search;
  if (!addon) return;
  addon.findPrevious(searchQuery.value, searchOptions);
  searchLastDirection.value = -1;
}

function closeSearch(): void {
  searchOpen.value = false;
  renderer?.search?.clearDecorations();
  searchResult.value = null;
}

function toggleSearch(): void {
  if (searchOpen.value) {
    closeSearch();
    return;
  }
  searchOpen.value = true;
}

const menu = ref<{ x: number; y: number; selection: string } | null>(null);

const dialog = useDialog();

/**
 * 多行粘贴守卫。
 *
 * 终端里跑的 TUI AI 编码工具（claude code / aider / opencode）把输入框里的
 * 换行当成提交。从网页/笔记粘一大段 prompt 过去，末尾自带换行 → 一贴就被
 * 执行。命令真的跑起来，事后很难挽回。
 *
 * 拦在 `term.paste` 层面（见 renderer.setPasteInterceptor），所以普通 Ctrl+V、
 * 右键粘贴、中键主选区三条路径一视同仁。
 */
async function guardPaste(text: string): Promise<string | null> {
  const risk = classifyPaste(text, {
    isBracketedSelection: Boolean(renderer?.term.hasSelection?.()),
  });
  if (!needsPasteConfirmation(risk)) return text;
  if (risk.kind !== "multiline") return text;

  return new Promise<string | null>((resolve) => {
    const confirm = dialog.warning({
      title: t("terminal.pasteGuardTitle"),
      content: t("terminal.pasteGuardBody", { lines: risk.lines }),
      positiveText: t("terminal.pasteGuardConfirm"),
      negativeText: t("common.cancel"),
      // 关掉对话框（Esc / 点遮罩）一律当作取消：宁可让用户重粘一次，
      // 也不能在一个“不确定发生了什么”的动作上默认往下走。
      onPositiveClick: () => resolve(text),
      onNegativeClick: () => resolve(null),
      onClose: () => resolve(null),
      onMaskClick: () => false,
    });
    // 用户可能先按了“不再询问”类的快捷操作；对话框被外部销毁时也走 onClose。
    void confirm;
  });
}

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
let detachBell: (() => void) | null = null;
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
    onStateChange: (next: SessionState, code?: number) => {
      state.value = next;
      exitCode.value = code;
      reportPaneStatus();
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
    exitCode.value = existing.getExitCode();
    existing.resize(term.cols, term.rows);
    return;
  }
  const handle = await createSession({
    term,
    cwd: props.cwd,
    callbacks: sessionCallbacks,
    wsNative: wsCtx!.wsNative,
    // 本地 shell profile（设置里的"默认 Shell"），"auto" 走后端默认顺序。
    shellProfileId: prefs.terminalShellId,
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
    onFind: toggleSearch,
  });
  // 滚动位置变化时更新“距底部 N 行”。xterm 的 onScroll 在用户上翻、
  // 程序输出、查找跳转三种情况下都会触发，足够。
  detachScrollWatch = nextRenderer.term.onScroll(() => {
    updateLinesFromBottom();
  });
  // 命中数由 addon 自己在搜索后派发（findNext 只返回布尔"是否找到"）。
  detachScrollWatch = nextRenderer.search.onDidChangeResults((event) => {
    const total = event.resultCount;
    searchResult.value =
      total === 0
        ? null
        : { index: Math.max(1, event.resultIndex + 1), total };
  });
  updateLinesFromBottom();

  // 粘贴守卫：仅在偏好打开时安装，否则完全走原生路径（零开销）。
  if (prefs.terminalConfirmMultilinePaste) {
    nextRenderer.setPasteInterceptor(guardPaste);
  }
  reportPaneStatus();
  detachBell = attachTerminalBell(nextRenderer.term, {
    enabled: () => prefs.terminalNotificationEnabled,
    soundEnabled: () => prefs.terminalNotificationSoundEnabled,
    title: () => props.title || props.leafId,
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
    lastObservedW = w;
    lastObservedH = h;

    // 容器不可见(0 尺寸,即工作区被 v-show 隐藏)时绝不调 fit:FitAddon 在
    // display:none 下会读 getComputedStyle().height='auto' → 算出 cols=2
    // (其 MINIMUM_COLS) → term.resize(2,1) → xterm buffer reflow 把每行
    // 文字按 2 列折行,提示符被不可逆切碎。必须从源头拦住 fit 调用。
    // (renderer.fit() 内部还有第二层 getBoundingClientRect 守卫做纵深防御。)
    if (w === 0 || h === 0) return;

    refreshLayout();
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
  detachScrollWatch?.dispose();
  detachScrollWatch = null;
  detachSearchWatch?.dispose();
  detachSearchWatch = null;
  detachBell?.();
  detachBell = null;
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
    // xterm 不会自动补画。顺序非常关键:
    // 1) 先 flush session 待写入的 PTY 数据(rAF 批次可能还没触发)。
    //    不 flush 的话,redraw 只能画到 flush 时刻的 buffer,看起来"画面
    //    缺一段直到下一波 PTY 输出"。这一步必须同步执行,不能放进 rAF。
    // 2) 下一帧 rAF 一次性 fit + redraw,让浏览器先把布局落定(fit 下界
    //    守卫沿用 8a6605e,避免 2x1 透传到 shell),再把 buffer 刷到
    //    canvas/WebGL 纹理上,避免"切回后内容缺失、需输入字符才补出"
    //    的视觉故障。
    session?.flushPendingData();
    requestAnimationFrame(() => {
      refreshLayout();
      renderer?.redraw();
      reportPaneStatus();
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
    reportPaneStatus();
  },
);

// 粘贴守卫开关要在运行中的终端上即时生效（用户刚在设置里改的）。
watch(
  () => prefs.terminalConfirmMultilinePaste,
  (enabled) => {
    renderer?.setPasteInterceptor(enabled ? guardPaste : null);
  },
);

/** 尺寸只在真的变了才上抛：fit 会在拖窗口时高频触发，状态坞不需要跟着抖。 */
let lastStatusKey = "";
function reportPaneStatus(): void {
  const term = renderer?.term;
  if (!term) return;
  const key = `${term.cols}x${term.rows}:${renderer?.activeRenderer()}:${state.value}`;
  if (key === lastStatusKey) return;
  lastStatusKey = key;
  emit("pane-status", {
    cols: term.cols,
    rows: term.rows,
    renderer: renderer?.activeRenderer() ?? "dom",
    state: state.value,
  });
}

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
  if (term) {
    // 走 term.paste 而不是 readClipboardText().then(...) 绕过拦截器 ——
    // 否则右键粘贴会漏掉多行守卫。
    void readClipboardText().then((text) => text && term.paste(text)).catch(() => {});
  }
  closeContextMenu();
}

function handleMenuSelectAll() {
  renderer?.term.selectAll();
  closeContextMenu();
}

/** 清屏：只清 xterm 自己的 buffer，不发任何字节给 PTY。 */
function handleMenuClear() {
  renderer?.term.clear();
  closeContextMenu();
}

/** 重置：向 PTY 发 RIS（ESC c），让 shell 重新初始化。 */
function handleMenuReset() {
  session?.write("\x1bc");
  closeContextMenu();
}

const fontSize = computed(() => prefs.terminalFontSize);

/** 字号 ±1：走全局偏好，renderer 上的 watch 会重新加载字体并重画。 */
function changeFontSize(delta: number) {
  const next = Math.max(8, Math.min(32, prefs.terminalFontSize + delta));
  if (next === prefs.terminalFontSize) return;
  void prefs.updateTerminalFontSize(next);
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
    data-terminal-pane
    :data-focused="isFocused ? 'true' : 'false'"
    @mousedown="handleFocus"
    @contextmenu="openContextMenu"
  >
    <TerminalPaneHeader
      :title="title"
      :cwd="cwd"
      :state="state"
      :exit-code="exitCode"
      :is-focused="isFocused"
      :can-split="canSplit ?? true"
      :only-pane="onlyPane ?? false"
      @focus="emit('focus')"
      @close="emit('close')"
      @split="(d: 'row' | 'col') => emit('split', d)"
    />
    <div ref="container" class="terminal-pane-body" />

    <!-- 终端内查找：Ctrl+F。面板自身不占布局宽度，浮在右上角。 -->
    <TerminalSearch
      v-if="searchOpen"
      :visible="searchOpen"
      @close="closeSearch"
      @search="(q: string) => runSearch(q, true)"
      @next="findNext"
      @previous="findPrevious"
    >
      <template #status>
        <span
          v-if="searchQuery && searchResult"
          class="shrink-0 px-1 text-[10px] tabular-nums text-muted-foreground"
          data-terminal-search-count
        >
          {{ t("terminal.searchResults", searchResult) }}
        </span>
        <span
          v-else-if="searchQuery"
          class="shrink-0 px-1 text-[10px] text-destructive"
          data-terminal-search-empty
        >
          {{ t("terminal.searchNoResults") }}
        </span>
      </template>
    </TerminalSearch>

    <!--
      回到底部：上翻之后新内容还在往下涌，底部的“末尾”既看不见也不知道
      差多少行。与其让用户反复按 End 试探，不如把差距直接告诉他。
      仅在确实有差距时出现，不占布局。
    -->
    <button
      v-if="linesFromBottom > 0"
      type="button"
      class="scroll-latest"
      data-terminal-scroll-latest
      :title="t('terminal.scrollToBottom', { count: linesFromBottom })"
      @click="scrollToBottom"
    >
      <span class="tabular-nums">{{ linesFromBottom }}</span>
      <NIcon :component="ArrowDownOutline" :size="12" />
    </button>

    <!--
      TerminalContextMenu 内部使用 NDropdown，NDropdown 默认 Teleport 到 body，
      此处不必再额外包一层 Teleport，避免与 NDropdown 的 teleport 重复造成双重定位。
    -->
    <TerminalContextMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :selection="menu.selection"
      :can-split="canSplit ?? true"
      :only-pane="onlyPane ?? false"
      :font-size="fontSize"
      @close="closeContextMenu"
      @copy="handleMenuCopy"
      @paste="handleMenuPaste"
      @select-all="handleMenuSelectAll"
      @clear="handleMenuClear"
      @reset="handleMenuReset"
      @split="(d: 'row' | 'col') => emit('split', d)"
      @close-pane="emit('close')"
      @rename="emit('rename')"
      @zoom-in="() => changeFontSize(1)"
      @zoom-out="() => changeFontSize(-1)"
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
}
.terminal-pane.focused .terminal-pane-body {
  outline: 0;
}
/* 回到底部悬浮按钮：绝对定位，不参与布局，避免把 xterm 推出 fit 计算。 */
.scroll-latest {
  position: absolute;
  right: 14px;
  bottom: 10px;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 10px;
  color: var(--muted-foreground);
  background: var(--term-pane-header-bg);
  border: 1px solid var(--term-pane-divider);
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.18);
  transition: background-color 120ms, color 120ms, border-color 120ms;
}
.scroll-latest:hover {
  color: var(--foreground);
  border-color: var(--term-pane-divider-active);
}
@media (hover: none) {
  /* 触屏上 hover 不到，按钮必须是常驻的。 */
  .scroll-latest {
    opacity: 1;
  }
}
</style>

<style>
.terminal-pane-body > .xterm {
  height: 100% !important;
  width: 100% !important;
  /*
   * 内边距必须挂在 .xterm 自身而不是 .terminal-pane-body:FitAddon 用父容器
   * getComputedStyle().width 推列数,Tailwind preflight 的 border-box 会让该值
   * 连 padding 一起计入,父容器上的 padding 就不会被扣掉,多算出的两列会把
   * 内容顶到滚动条下面。而 .xterm 自身的 padding 是 FitAddon 公式显式读取并
   * 减去的项(elementPadding),挂在它上面才能正确为滚动条留出沟槽。
   */
  padding: var(--term-padding-y, 4px) var(--term-padding-x, 8px);
}
.terminal-pane-body .xterm-viewport {
  background-color: transparent !important;
}
.terminal-pane-body .xterm .xterm-screen canvas {
  outline: none;
}
</style>