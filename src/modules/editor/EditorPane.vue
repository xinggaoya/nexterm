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
import type { LspEditorHooks } from "./lib/editorPaneLsp";
import { notifyLspDocumentChanged } from "@/modules/lsp/manager";

const props = defineProps<{
  path: string;
  fsEvent?: WorkspaceFsChangedEvent | null;
}>();

const emit = defineEmits<{
  dirtyChange: [dirty: boolean];
  saved: [];
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
      }
      if (update.docChanged || update.selectionSet) {
        updateCursorInfo(update.state);
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
  // LSP 模式下把保存后的全文推给 server，触发 publishDiagnostics 刷新。
  if (view.value) notifyLspDocumentChanged(view.value, buffer.value);
  emit("saved");
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

watch(() => props.path, () => void load(), { immediate: true });

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

const lspHooks: LspEditorHooks = {
  workspaceRoot: wsCtx.workspace.rootPath,
  getDocumentText: () => view.value?.state.doc.toString() ?? "",
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
    );
  },
);

onBeforeUnmount(() => {
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
