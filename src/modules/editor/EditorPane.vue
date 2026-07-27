<script setup lang="ts">
import * as monaco from "monaco-editor";
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
import { buildMonacoEditorOptions } from "./lib/editorConfig";
import {
  disposeEditor,
  mountMonacoEditor,
  safeReplaceValue,
  type EditorMount,
} from "./lib/editorRuntime";
import { isMarkdownPath, resolveMonacoLanguageId } from "./lib/languageMap";
import { registerMonacoThemes } from "./lib/themes";
import { attachVim, type VimAttachment } from "./lib/vim";
import { attachOrDetachLsp } from "./lib/editorPaneLsp";

registerMonacoThemes(monaco);

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
const mount = shallowRef<EditorMount | null>(null);
const vimAttachment = shallowRef<VimAttachment | null>(null);
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
const languageLabel = computed(
  () => resolveMonacoLanguageId(props.path) ?? "Plain Text",
);

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
  void nextTick(() => mount.value?.editor.layout());
}

async function createEditor(content: string) {
  await nextTick();
  if (!host.value) return;
  disposeEditor(mount.value);
  mount.value = null;
  const opts = buildMonacoEditorOptions(
    prefs,
    resolveMonacoLanguageId(props.path),
  );
  const fresh = mountMonacoEditor(host.value, opts, content);
  fresh.disposables.push(
    fresh.editor.onDidChangeModelContent(() => {
      const next = fresh.editor.getValue();
      buffer.value = next;
      setDirty(next !== savedContent.value);
    }),
    fresh.editor.onDidChangeCursorPosition((e) => {
      line.value = e.position.lineNumber;
      column.value = e.position.column;
      const sel = fresh.editor.getSelection();
      const model = fresh.editor.getModel();
      if (sel && model) selectionLength.value = model.getValueLengthInRange(sel);
    }),
  );
  mount.value = fresh;
}

async function load() {
  disposeEditor(mount.value);
  mount.value = null;
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
    await createEditor(result.content);
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
    // 内容相等短路：磁盘内容和当前 buffer 一致时只刷新 size，不做全量替换，
    // 避免无意义的 executeEdits 打断光标/撤销栈。
    if (result.content === buffer.value) {
      savedContent.value = result.content;
      setDirty(false);
      return;
    }
    buffer.value = result.content;
    savedContent.value = result.content;
    setDirty(false);
    if (mount.value) safeReplaceValue(mount.value.editor, result.content);
    else await createEditor(result.content);
  } else {
    savedContent.value = "";
    buffer.value = "";
    disposeEditor(mount.value);
    mount.value = null;
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
  mount.value?.editor.focus();
}

function getSelection(): string | null {
  const editor = mount.value?.editor;
  if (!editor) return null;
  const sel = editor.getSelection();
  if (!sel || sel.isEmpty()) return null;
  return editor.getModel()?.getValueInRange(sel) ?? null;
}

function openGotoLine(): void {
  const editor = mount.value?.editor;
  if (!editor) return;
  editor.focus();
  const raw = window.prompt(t("editor.gotoLinePrompt"), String(line.value));
  if (!raw) return;
  const target = Number.parseInt(raw, 10);
  if (!Number.isFinite(target) || target < 1) return;
  const model = editor.getModel();
  if (!model) return;
  const clamped = Math.min(target, model.getLineCount());
  editor.setPosition({ lineNumber: clamped, column: 1 });
  editor.revealLine(clamped);
  line.value = clamped;
}

function setContentForTest(content: string) {
  const editor = mount.value?.editor;
  if (!editor) {
    buffer.value = content;
    setDirty(content !== savedContent.value);
    return;
  }
  safeReplaceValue(editor, content);
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
  () => {
    if (!mount.value) return;
    monaco.editor.setTheme(prefs.editorTheme);
  },
);

watch(
  () => [prefs.editorFontSize, prefs.editorTabSize, prefs.editorWordWrap],
  () => {
    // 字体/缩进/换行只更新 options，不重建编辑器实例——重建会丢失光标位置和
    // 撤销栈，且会打断正在进行的编辑。
    const editor = mount.value?.editor;
    if (!editor) return;
    editor.updateOptions({
      fontSize: prefs.editorFontSize,
      tabSize: prefs.editorTabSize,
      wordWrap: prefs.editorWordWrap ? "on" : "off",
    });
  },
);

watch(
  () => prefs.vimMode,
  (enabled) => {
    vimAttachment.value?.dispose();
    vimAttachment.value = null;
    if (enabled && mount.value) {
      vimAttachment.value = attachVim(mount.value.editor, {
        save: () => void save(),
        close: () => {
          emit("dirtyChange", false);
        },
      });
    }
  },
  { immediate: true },
);

watch(
  () => [prefs.editorLspTypescriptMode, props.path],
  () => {
    if (!mount.value || doc.value.status !== "ready") return;
    void attachOrDetachLsp(
      mount.value.editor,
      props.path,
      prefs.editorLspTypescriptMode,
    );
  },
);

onBeforeUnmount(() => {
  vimAttachment.value?.dispose();
  vimAttachment.value = null;
  if (mount.value) {
    void attachOrDetachLsp(mount.value.editor, props.path, "builtin").catch(() => undefined);
  }
  disposeEditor(mount.value);
  mount.value = null;
});

defineExpose({
  save,
  focus,
  getSelection,
  setContentForTest,
  openGotoLine,
  reload: () => reloadExternalChange(true),
  undo: () => mount.value?.editor.trigger("keyboard", "undo", null),
  redo: () => mount.value?.editor.trigger("keyboard", "redo", null),
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
          class="min-h-0 overflow-hidden"
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
