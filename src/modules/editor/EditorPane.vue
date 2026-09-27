<script setup lang="ts">
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  undo,
} from "@codemirror/commands";
import { autocompletion, closeBrackets } from "@codemirror/autocomplete";
import { bracketMatching, foldGutter } from "@codemirror/language";
import { linter } from "@codemirror/lint";
import { searchKeymap } from "@codemirror/search";
import {
  EditorState,
  type Extension,
} from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { NSpin, useDialog } from "naive-ui";
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { t } from "@/modules/i18n/translate";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import { useWorkspaceContext } from "@/app/workspaceContext";
import type { WorkspaceFsChangedEvent } from "@/lib/native";
import type { EditorViewMode } from "./editorTypes";
import EditorStatusBar from "./EditorStatusBar.vue";
import EditorToolbar from "./EditorToolbar.vue";
import MarkdownEditorPreview from "./MarkdownEditorPreview.vue";
import {
  readEditorDocument,
  writeEditorDocument,
  type EditorDocumentState,
} from "./lib/documentService";
import {
  buildPrefExtensions,
  buildSharedExtensions,
  languageCompartment,
  optionsCompartment,
  themeCompartment,
  vimCompartment,
} from "./lib/extensions";
import { disposeEditor, mountCodeMirrorEditor, safeReplaceValue } from "./lib/editorRuntime";
import {
  isMarkdownPath,
  languageLabelForPath,
  resolveLanguage,
  resolveLanguageSync,
} from "./lib/languageResolver";
import { themeExtensionFor } from "./lib/themes";
import { vimHandlersExtension, vimModeExtension } from "./lib/vim";
import { attachOrDetachLsp, applyCmDiagnostics } from "./lib/editorPaneLsp";
import {
  lspCompletionExtension,
  lspHoverExtension,
  requestFormattingEdits,
  resolveDefinitionAt,
  resolveDocumentSymbols,
  resolveReferencesAt,
  resolveRenameAt,
} from "@/modules/lsp/lspExtensions";
import type { PendingEdit, ReferenceGroup } from "@/modules/lsp/lspLanguageSupport";
import type { LspDocumentSymbol } from "@/modules/lsp/types";
import {
  applyTextEdits,
  containerPathForOffset,
} from "@/modules/lsp/lspLanguageSupport";
import EditorBreadcrumb from "./EditorBreadcrumb.vue";
import { notifyInfo } from "@/modules/notifications/notificationCenter";
import type { LspEditorHooks } from "./lib/editorPaneLsp";
import {
  notifyLspDocumentChanged,
  notifyLspDocumentSaved,
} from "@/modules/lsp/manager";

const props = defineProps<{
  path: string;
  fsEvent?: WorkspaceFsChangedEvent | null;
}>();

const emit = defineEmits<{
  dirtyChange: [dirty: boolean];
  saved: [];
  /**
   * LSP 跳转定义的结果。编辑器不持有工作区状态，也不知道怎么开标签 ——
   * 只把目标上抛给 Canvas → WorkspaceHost 统一编排。
   */
  "go-to-definition": [target: { path: string; line: number; character: number } | null];
  /**
   * F2 重命名的待改列表。编辑器不写盘也不开标签 —— 它只把"要改哪里、改成
   * 什么"报上去，由 WorkspaceHost 统一确认与应用（跨文件写入要能被用户
   * 看到并有机会反悔）。
   */
  "request-rename": [edits: PendingEdit[]];
  /** 查找引用结果。 */
  "show-references": [groups: ReferenceGroup[]];
  /** 文档符号变化（面包屑 / 大纲）。 */
  "symbols-changed": [symbols: LspDocumentSymbol[]];
}>();

const dialog = useDialog();
const prefs = usePreferencesPiniaStore();
// 获取当前 workspace 上下文（wsNative + workspace），所有 native 调用都走它。
const wsCtx = useWorkspaceContext();
const host = ref<HTMLDivElement | null>(null);
const view = shallowRef<EditorView | null>(null);
const doc = ref<EditorDocumentState>({ status: "loading" });
const savedContent = ref("");
const buffer = ref("");
const dirty = ref(false);
const externalChangePending = ref(false);
// 保存回环抑制：写盘后 fs_write_file 会主动发一次 workspace-fs-changed 事件，
// 路径正是当前文件。用一个短期窗口忽略"自己刚保存的那一次"外部重载事件，
// 避免光标被 safeReplaceValue 重置。窗口取 1.5s 足以覆盖后端 batcher 的去重时延。
const IGNORE_SELF_SAVE_MS = 1500;
const lastSavedPath = ref("");
const lastSavedAt = ref(0);
const mode = ref<EditorViewMode>("source");
const line = ref(1);
const column = ref(1);
const selectionLength = ref(0);

const fileName = computed(() => {
  const parts = props.path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : props.path;
});

const markdown = computed(() => isMarkdownPath(props.path));
const languageLabel = computed(() => languageLabelForPath(props.path));

const sourcePaneClass = computed(() => {
  if (!markdown.value || mode.value === "source") return "h-full w-full";
  if (mode.value === "split") return "h-full w-1/2 border-r border-border/60";
  return "h-full w-0";
});

const previewPaneClass = computed(() =>
  mode.value === "split" ? "h-full w-1/2" : "h-full w-full",
);

const sizeLabel = computed(() => {
  const current = doc.value;
  return "size" in current ? formatBytes(current.size) : "0 B";
});

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function setDirty(next: boolean) {
  if (dirty.value === next) return;
  dirty.value = next;
  emit("dirtyChange", next);
}

function setMode(next: EditorViewMode) {
  if (!markdown.value && next !== "source") return;
  mode.value = next;
  // 分屏切换改变宿主尺寸，通知 CodeMirror 重新测量。
  void nextTick(() => view.value?.requestMeasure());
}

function destroyEditor() {
  disposeEditor(view.value);
  view.value = null;
  if (host.value) host.value.innerHTML = "";
}

function replaceEditorContent(content: string) {
  const current = view.value;
  if (!current) return false;
  safeReplaceValue(current, content);
  return true;
}

function updateCursorInfo(state: EditorState) {
  const selection = state.selection.main;
  const lineInfo = state.doc.lineAt(selection.head);
  line.value = lineInfo.number;
  column.value = selection.head - lineInfo.from + 1;
  selectionLength.value = Math.abs(selection.to - selection.from);
}

function editorBaseExtensions(): Extension[] {
  return [
    lineNumbers(),
    foldGutter(),
    highlightActiveLineGutter(),
    history(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    // LSP 补全 source：override 里只有它，未 attach（builtin 模式 / 无
    // server）时返回 null，补全面板不会出现。
    lspCompletionExtension(),
    lspHoverExtension(),
    // Ctrl/Cmd + 点击 = 跳转定义。用 DOM 事件而不是 CM 扩展：需要的是
    // "鼠标位置 → 文档偏移"，CM 的 domEventHandlers 正好直接给 pos。
    EditorView.domEventHandlers({
      mousedown: (event, view) => {
        const mouse = event as MouseEvent;
        if (!(mouse.ctrlKey || mouse.metaKey) || mouse.button !== 0) return false;
        // 同步阻止默认，异步请求；这里不 await 避免阻塞 CM 的事件分发。
        mouse.preventDefault();
        const pos = view.posAtCoords({ x: mouse.clientX, y: mouse.clientY }) ?? -1;
        if (pos < 0) return true;
        void handleEditorPointerDown(mouse, pos);
        return true;
      },
    }),
    highlightActiveLine(),
    // LSP 诊断的宿主扩展：真正的诊断由 manager 经 setDiagnostics 效果
    // 推入；这里挂空 source 的 linter 作为面板/gutter 的载体。
    linter(() => []),
    ...buildSharedExtensions(),
    optionsCompartment.of(buildPrefExtensions(prefs)),
    themeCompartment.of(themeExtensionFor(prefs.editorTheme)),
    languageCompartment.of(resolveLanguageSync(props.path) ?? []),
    vimCompartment.of(prefs.vimMode ? [vimModeExtension()] : []),
    vimHandlersExtension(() => ({
      save: () => void save(),
      close: () => {
        emit("dirtyChange", false);
      },
    })),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const next = update.state.doc.toString();
        buffer.value = next;
        setDirty(next !== savedContent.value);
        // 每次编辑后都要把新文本推给 server：只靠"保存时推"的话，server
        // 手里的文档会停留在上次保存的内容，补全/悬浮全在旧文本上算。
        // 逐击键都发一次太吵（一次击键 = 一次全量文本 + 一次重新分析），
        // 因此防抖到用户停手。
        scheduleLspSync(next);
      }
      if (update.docChanged || update.selectionSet) {
        updateCursorInfo(update.state);
        if (update.selectionSet) recomputeBreadcrumb();
      }
    }),
    keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          void save();
          return true;
        },
      },
      indentWithTab,
      ...searchKeymap,
      ...historyKeymap,
      ...defaultKeymap,
    ]),
  ];
}

async function mountEditor(content: string) {
  await nextTick();
  if (!host.value) return;
  destroyEditor();
  const initialLanguage = resolveLanguageSync(props.path);
  const state = EditorState.create({
    doc: content,
    extensions: editorBaseExtensions(),
  });
  view.value = mountCodeMirrorEditor(host.value, state);
  updateCursorInfo(view.value.state);

  if (initialLanguage) return;
  const currentPath = props.path;
  const language = await resolveLanguage(currentPath);
  if (props.path !== currentPath || !view.value) return;
  view.value.dispatch({
    effects: languageCompartment.reconfigure(language ?? []),
  });
}

async function load() {
  destroyEditor();
  doc.value = { status: "loading" };
  externalChangePending.value = false;
  mode.value = isMarkdownPath(props.path) ? "split" : "source";
  line.value = 1;
  column.value = 1;
  selectionLength.value = 0;
  setDirty(false);
  emit("dirtyChange", false);
  const result = await readEditorDocument(wsCtx.wsNative, props.path);
  doc.value = result;
  if (result.status === "ready") {
    savedContent.value = result.content;
    buffer.value = result.content;
    await mountEditor(result.content);
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function fsEventTouchesPath(event: WorkspaceFsChangedEvent, path: string): boolean {
  const current = normalizePath(path);
  // 空 paths 的 root-refresh 事件（WSL/polling watcher 周期性发送）语义上是
  // 给 Explorer/SourceControl 刷新目录树用的，单文件编辑器只关心显式命中本
  // 文件路径的事件，否则会导致工作区内任意打开的文件被周期性全量重载、光标重置。
  if (event.paths.length === 0) return false;
  return event.paths.some((eventPath) => normalizePath(eventPath) === current);
}

async function reloadExternalChange(force = false) {
  if (dirty.value && !force) {
    externalChangePending.value = true;
    return;
  }
  // 抑制"自己刚保存的那一次"外部事件回环：保存后短期内到达的同路径事件
  // 内容就是我们刚写下去的，重载只会把光标挤回 (1,1)。
  if (
    !force &&
    props.path === lastSavedPath.value &&
    Date.now() - lastSavedAt.value < IGNORE_SELF_SAVE_MS
  ) {
    return;
  }
  const currentPath = props.path;
  const result = await readEditorDocument(wsCtx.wsNative, currentPath);
  if (props.path !== currentPath || (dirty.value && !force)) return;
  doc.value = result;
  externalChangePending.value = false;
  if (result.status === "ready") {
    // 内容相等短路：磁盘内容和当前 buffer 一致时只刷新 savedContent，不做全量
    // 替换，避免无意义的 dispatch 打断光标/撤销栈。
    if (result.content === buffer.value) {
      savedContent.value = result.content;
      setDirty(false);
      return;
    }
    buffer.value = result.content;
    savedContent.value = result.content;
    setDirty(false);
    if (!replaceEditorContent(result.content)) {
      await mountEditor(result.content);
    }
  } else {
    savedContent.value = "";
    buffer.value = "";
    destroyEditor();
  }
}

async function saveConfirmed() {
  if (!dirty.value) return;
  await writeEditorDocument(wsCtx.wsNative, props.path, buffer.value);
  savedContent.value = buffer.value;
  externalChangePending.value = false;
  // 记录本次保存，供 reloadExternalChange 在短期内忽略同路径的回环事件。
  lastSavedPath.value = props.path;
  lastSavedAt.value = Date.now();
  setDirty(false);
  await formatBeforeSave();
  // 先 flush 掉还挂在防抖窗口里的那次推送（否则会有两次内容相同的
  // didChange），再发 didSave —— capabilities 里声明了 didSave: true，
  // rust-analyzer / gopls 依赖它触发重算。
  flushLspSync();
  if (view.value) notifyLspDocumentSaved(view.value, buffer.value);
  emit("saved");
}

/**
 * 保存时格式化。
 *
 * 走 LSP 的 `textDocument/formatting` 而不是内置 formatter：零新依赖，
 * 而且用的是**用户自己项目的** formatter 配置（rustfmt.toml、.editorconfig），
 * 而不是我们硬编码的一套规则。server 不支持时静默跳过 —— 格式化是锦上添花，
 * 不该因为它失败而阻塞保存。
 */
async function formatBeforeSave(): Promise<void> {
  if (!prefs.editorFormatOnSave) return;
  const current = view.value;
  if (!current) return;
  const edits = await requestFormattingEdits(current);
  if (!edits || edits.length === 0) return;
  const before = current.state.doc.toString();
  const formatted = applyTextEdits(before, edits);
  if (formatted === before) return;
  // 整篇替换：格式化本质就是重排全文，逐条 dispatch 会让撤销栈变得无法使用。
  current.dispatch({
    changes: { from: 0, to: current.state.doc.length, insert: formatted },
    selection: { anchor: current.state.selection.main.head },
  });
}

async function save() {
  if (!dirty.value) return;
  if (!externalChangePending.value) {
    await saveConfirmed();
    return;
  }
  dialog.warning({
    title: t("editor.externalChangeSaveTitle"),
    content: t("editor.externalChangeSaveContent"),
    positiveText: t("editor.save"),
    negativeText: t("common.cancel"),
    onPositiveClick: () => void saveConfirmed(),
  });
}

function focus() {
  view.value?.focus();
}

function getSelection(): string | null {
  const current = view.value;
  if (!current) return null;
  const { from, to } = current.state.selection.main;
  if (from === to) return null;
  return current.state.sliceDoc(from, to);
}

/**
 * LSP 跳转定义。两种触发：
 * - F12（命令 `editor.goToDefinition`）
 * - Ctrl/Cmd + 点击（光标下的符号）
 *
 * 结果只上抛给宿主（Canvas → WorkspaceHost）去开标签：编辑器不持有
 * 工作区状态。
 */
async function goToDefinition(pos?: number): Promise<void> {
  const current = view.value;
  if (!current) return;
  const at = pos ?? current.state.selection.main.head;
  const target = await resolveDefinitionAt(current, at);
  if (!target) {
    notifyInfo(t("lsp.noDefinition"));
    return;
  }
  emit("go-to-definition", target);
}

/** Ctrl/Cmd + 点击：命中则跳转，否则把点击让给正常的光标定位。 */
async function handleEditorPointerDown(event: MouseEvent, pos: number): Promise<void> {
  if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return;
  // 修饰键 + 点击可能被其他扩展（如 vim 的块选择）用掉，先阻止默认再试。
  event.preventDefault();
  await goToDefinition(pos);
}

/** F2 重命名：问 server 要 WorkspaceEdit，摊平后上抛给宿主确认。 */
async function renameSymbol(pos?: number): Promise<void> {
  const current = view.value;
  if (!current) return;
  const at_ = pos ?? current.state.selection.main.head;
  // 用光标处的标识符做初值：多数情况下这就是用户想要的新名字。
  const line = current.state.doc.lineAt(at_);
  const text = line.text.slice(0, at_ - line.from);
  const word = /[A-Za-z_$][A-Za-z0-9_$]*$/.exec(text)?.[0] ?? "";
  const newName = window.prompt(t("lsp.renamePrompt"), word);
  if (!newName) return;
  const edits = await resolveRenameAt(current, at_, newName);
  if (!edits) {
    notifyInfo(t("lsp.renameUnavailable"));
    return;
  }
  emit("request-rename", edits);
}

/** 查找引用：结果上抛，UI 负责列出来。 */
async function findReferences(pos?: number): Promise<void> {
  const current = view.value;
  if (!current) return;
  const groups = await resolveReferencesAt(
    current,
    pos ?? current.state.selection.main.head,
    true,
  );
  if (!groups) {
    notifyInfo(t("lsp.noReferences"));
    return;
  }
  emit("show-references", groups);
}

async function refreshSymbols(): Promise<void> {
  const current = view.value;
  if (!current) return;
  const symbols = await resolveDocumentSymbols(current);
  emit("symbols-changed", symbols ?? []);
}

/** 符号位置偏移 → 跳转。 */
async function gotoSymbol(pos: number): Promise<void> {
  const current = view.value;
  if (!current) return;
  current.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  current.focus();
}

/** 行号（1-based）→ 文档偏移。面包屑点击走这条。 */
function offsetOfLine(line: number): number {
  const current = view.value;
  if (!current) return 0;
  const clamped = Math.min(Math.max(Math.round(line), 1), current.state.doc.lines);
  return current.state.doc.line(clamped).from;
}

function openGotoLine(): void {
  const current = view.value;
  if (!current) return;
  current.focus();
  const raw = window.prompt(t("editor.gotoLinePrompt"), String(line.value));
  if (!raw) return;
  const target = Number.parseInt(raw, 10);
  if (!Number.isFinite(target) || target < 1) return;
  const lineCount = current.state.doc.lines;
  const clamped = Math.min(target, lineCount);
  const lineInfo = current.state.doc.line(clamped);
  current.dispatch({
    selection: { anchor: lineInfo.from },
    scrollIntoView: true,
  });
  line.value = clamped;
}

function setContentForTest(content: string) {
  const current = view.value;
  if (!current) {
    buffer.value = content;
    setDirty(content !== savedContent.value);
    return;
  }
  safeReplaceValue(current, content);
}

/**
 * 面包屑：光标所在的符号容器链。
 *
 * 符号树从 LSP 拿（只有 LSP 模式下才有），容器链由光标偏移现算 —— 光标一动
 * 就重算，比"订阅光标变化重新请求 server"快得多（server 根本不需要知道）。
 */
const documentSymbols = ref<LspDocumentSymbol[]>([]);
const breadcrumbPath = ref<string[]>([]);

async function loadDocumentSymbols(): Promise<void> {
  const current = view.value;
  if (!current) {
    documentSymbols.value = [];
    return;
  }
  const symbols = await resolveDocumentSymbols(current);
  documentSymbols.value = symbols ?? [];
  recomputeBreadcrumb();
}

function recomputeBreadcrumb(): void {
  const current = view.value;
  if (!current || documentSymbols.value.length === 0) {
    breadcrumbPath.value = [];
    return;
  }
  breadcrumbPath.value = containerPathForOffset(
    current.state.doc,
    documentSymbols.value,
    current.state.selection.main.head,
  );
}

watch(
  () => props.path,
  () => {
    // 换文件 → 符号与面包屑立即失效（不能拿上一个文件的符号树渲染新文件）
    documentSymbols.value = [];
    breadcrumbPath.value = [];
    void load();
  },
  { immediate: true },
);

watch(
  () => props.fsEvent,
  (event) => {
    if (!event || !fsEventTouchesPath(event, props.path)) return;
    void reloadExternalChange();
  },
);

watch(
  () => prefs.editorTheme,
  (themeId) => {
    view.value?.dispatch({
      effects: themeCompartment.reconfigure(themeExtensionFor(themeId)),
    });
  },
);

watch(
  () => [prefs.editorFontSize, prefs.editorTabSize, prefs.editorWordWrap],
  () => {
    // 字体/缩进/换行只重配置 optionsCompartment，不重建编辑器实例——重建会
    // 丢失光标位置和撤销栈，且会打断正在进行的编辑。
    view.value?.dispatch({
      effects: optionsCompartment.reconfigure(buildPrefExtensions(prefs)),
    });
  },
);

watch(
  () => prefs.vimMode,
  (enabled) => {
    view.value?.dispatch({
      effects: vimCompartment.reconfigure(enabled ? [vimModeExtension()] : []),
    });
  },
);

/**
 * 把编辑内容防抖推给 LSP server。
 *
 * 停手 LSP_SYNC_DEBOUNCE_MS 后推一次全量文本。逐击键推送会让 server 每次都
 * 重新分析整个文件（rust-analyzer 会做增量分析，但全量文本传输 + 重新
 * 请求的开销仍在），而完全不发则 server 看到的是过期文档。
 */
const LSP_SYNC_DEBOUNCE_MS = 300;
let lspSyncTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleLspSync(text: string): void {
  if (lspSyncTimer) clearTimeout(lspSyncTimer);
  lspSyncTimer = setTimeout(() => {
    lspSyncTimer = null;
    if (view.value) notifyLspDocumentChanged(view.value, text);
  }, LSP_SYNC_DEBOUNCE_MS);
}

function flushLspSync(): void {
  if (!lspSyncTimer) return;
  clearTimeout(lspSyncTimer);
  lspSyncTimer = null;
  if (view.value) notifyLspDocumentChanged(view.value, buffer.value);
}

const lspHooks: LspEditorHooks = {
  workspaceRoot: wsCtx.workspace.rootPath,
  getDocumentText: () => view.value?.state.doc.toString() ?? "",
  getTabSize: () => prefs.editorTabSize,
  getInsertSpaces: () => true,
  applyDiagnostics: (diagnostics) => {
    const current = view.value;
    if (current) applyCmDiagnostics(current, diagnostics);
  },
  // no-server-binary 是"没装对应语言服务器"的常态，静默即可。
  onAttachFailed: (reason) => {
    if (reason !== "no-server-binary") {
      console.warn("[lsp] attach failed:", reason);
    }
  },
};

watch(
  () => [prefs.editorLspTypescriptMode, props.path],
  () => {
    if (!view.value || doc.value.status !== "ready") return;
    void attachOrDetachLsp(
      view.value,
      props.path,
      prefs.editorLspTypescriptMode,
      lspHooks,
    ).then(() => loadDocumentSymbols());
  },
);

onBeforeUnmount(() => {
  if (lspSyncTimer) {
    clearTimeout(lspSyncTimer);
    lspSyncTimer = null;
  }
  if (view.value) {
    void attachOrDetachLsp(view.value, props.path, "builtin").catch(
      () => undefined,
    );
  }
  destroyEditor();
});

  /** 跳到指定行（1-based）并滚动到可见区域（Find in Files 跳转用）。 */
  function revealLine(line: number): void {
    const current = view.value;
    if (!current) return;
    const lineNo = Math.min(Math.max(Math.round(line), 1), current.state.doc.lines);
    const lineInfo = current.state.doc.line(lineNo);
    current.dispatch({
      selection: { anchor: lineInfo.from },
      scrollIntoView: true,
    });
    current.focus();
  }

defineExpose({
  save,
  focus,
  getSelection,
  setContentForTest,
  openGotoLine,
  goToDefinition,
  renameSymbol,
  findReferences,
  refreshSymbols,
  loadDocumentSymbols,
  gotoSymbol,
  revealLine,
  reload: () => reloadExternalChange(true),
  undo: () => {
    const current = view.value;
    if (current) void undo(current);
  },
  redo: () => {
    const current = view.value;
    if (current) void redo(current);
  },
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-background">
    <EditorToolbar
      :file-name="fileName"
      :language-label="languageLabel"
      :dirty="dirty"
      :external-change-pending="externalChangePending"
      :is-markdown="markdown"
      :mode="mode"
      @dismiss-external-change="externalChangePending = false"
      @reload-external-change="() => void reloadExternalChange(true)"
      @save="() => void save()"
      @mode-change="setMode"
    />

    <EditorBreadcrumb
      v-if="doc.status === 'ready'"
      :file-name="fileName"
      :container-path="breadcrumbPath"
      :symbols="documentSymbols"
      @go-to-symbol="(line) => gotoSymbol(offsetOfLine(line))"
    />

    <div
      v-if="doc.status === 'loading'"
      class="grid min-h-0 flex-1 place-items-center"
    >
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <NSpin size="small" />
        <span>{{ t("editor.loadingFile") }}</span>
      </div>
    </div>
    <div
      v-else-if="doc.status === 'error'"
      class="grid min-h-0 flex-1 place-items-center p-6 text-center text-xs text-destructive"
    >
      {{ doc.message }}
    </div>
    <div
      v-else-if="doc.status === 'binary'"
      class="grid min-h-0 flex-1 place-items-center p-6 text-center"
    >
      <div>
        <div class="text-sm font-medium">{{ t("editor.binaryFile") }}</div>
        <div class="mt-1 text-xs text-muted-foreground">
          {{ formatBytes(doc.size) }} · {{ t("editor.previewNotSupported") }}
        </div>
      </div>
    </div>
    <div
      v-else-if="doc.status === 'toolarge'"
      class="grid min-h-0 flex-1 place-items-center p-6 text-center"
    >
      <div>
        <div class="text-sm font-medium">{{ t("editor.fileTooLarge") }}</div>
        <div class="mt-1 text-xs text-muted-foreground">
          {{
            t("editor.exceedsLimit", {
              size: formatBytes(doc.size),
              limit: formatBytes(doc.limit),
            })
          }}
        </div>
      </div>
    </div>
    <div
      v-else
      data-editor-mode-root
      class="min-h-0 flex-1 overflow-hidden"
      :data-mode="mode"
    >
      <div class="flex h-full min-h-0">
        <div
          v-show="!markdown || mode !== 'preview'"
          data-editor-source-panel
          class="relative min-h-0 overflow-hidden"
          :class="sourcePaneClass"
        >
          <div
            ref="host"
            data-editor-host
            class="nexterm-editor-scrollbar h-full min-h-0"
          />
        </div>
        <div
          v-if="markdown"
          v-show="mode !== 'source'"
          data-editor-preview-panel
          class="min-h-0 overflow-hidden"
          :class="previewPaneClass"
        >
          <MarkdownEditorPreview :content="buffer" />
        </div>
      </div>
    </div>

    <EditorStatusBar
      v-if="doc.status === 'ready'"
      :language-label="languageLabel"
      :size-label="sizeLabel"
      :dirty="dirty"
      :line="line"
      :column="column"
      :selection-length="selectionLength"
    />
  </div>
</template>
