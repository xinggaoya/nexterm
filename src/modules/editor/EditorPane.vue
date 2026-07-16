<script setup lang="ts">
import * as monaco from "monaco-editor";
import { NSpin, useDialog } from "naive-ui";
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { t } from "@/modules/i18n/translate";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
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
const host = ref<HTMLDivElement | null>(null);
const mount = shallowRef<EditorMount | null>(null);
const vimAttachment = shallowRef<VimAttachment | null>(null);
const doc = ref<EditorDocumentState>({ status: "loading" });
const savedContent = ref("");
const buffer = ref("");
const dirty = ref(false);
const externalChangePending = ref(false);
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
  const result = await readEditorDocument(props.path);
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
  if (event.paths.length === 0) {
    const root = normalizePath(event.rootPath);
    return current === root || current.startsWith(`${root}/`);
  }
  return event.paths.some((eventPath) => normalizePath(eventPath) === current);
}

async function reloadExternalChange(force = false) {
  if (dirty.value && !force) {
    externalChangePending.value = true;
    return;
  }
  const currentPath = props.path;
  const result = await readEditorDocument(currentPath);
  if (props.path !== currentPath || (dirty.value && !force)) return;
  doc.value = result;
  externalChangePending.value = false;
  if (result.status === "ready") {
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
  await writeEditorDocument(props.path, buffer.value);
  savedContent.value = buffer.value;
  externalChangePending.value = false;
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
    if (doc.value.status === "ready") void createEditor(buffer.value);
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
