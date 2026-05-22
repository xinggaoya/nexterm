<script setup lang="ts">
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { autocompletion, closeBrackets } from "@codemirror/autocomplete";
import { bracketMatching, foldGutter } from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { NSpin } from "naive-ui";
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import type { EditorViewMode } from "./editorTypes";
import EditorStatusBar from "./EditorStatusBar.vue";
import EditorToolbar from "./EditorToolbar.vue";
import MarkdownEditorPreview from "./MarkdownEditorPreview.vue";
import {
  readEditorDocument,
  writeEditorDocument,
  type EditorDocumentState,
} from "./lib/documentService";
import { buildSharedExtensions, languageCompartment } from "./lib/extensions";
import {
  isMarkdownPath,
  languageLabelForPath,
  resolveLanguage,
  resolveLanguageSync,
} from "./lib/languageResolver";
import { EDITOR_THEME_EXT } from "./lib/themes";

const props = defineProps<{
  path: string;
}>();

const emit = defineEmits<{
  dirtyChange: [dirty: boolean];
  saved: [];
}>();

const prefs = usePreferencesPiniaStore();
const host = ref<HTMLDivElement | null>(null);
const view = shallowRef<EditorView | null>(null);
const doc = ref<EditorDocumentState>({ status: "loading" });
const savedContent = ref("");
const buffer = ref("");
const dirty = ref(false);
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
  void nextTick(() => view.value?.requestMeasure());
}

function destroyEditor() {
  view.value?.destroy();
  view.value = null;
  if (host.value) host.value.innerHTML = "";
}

function updateCursorInfo(state: EditorState) {
  const selection = state.selection.main;
  const lineInfo = state.doc.lineAt(selection.head);
  line.value = lineInfo.number;
  column.value = selection.head - lineInfo.from + 1;
  selectionLength.value = Math.abs(selection.to - selection.from);
}

function editorBaseExtensions(language: Extension | null): Extension[] {
  const theme = EDITOR_THEME_EXT[prefs.editorTheme] ?? EDITOR_THEME_EXT.atomone;
  return [
    lineNumbers(),
    foldGutter(),
    highlightActiveLineGutter(),
    history(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    highlightActiveLine(),
    ...buildSharedExtensions(),
    languageCompartment.of(language ?? []),
    theme,
    EditorView.theme({
      "&": { height: "100%" },
      ".cm-scroller": {
        fontSize: "13px",
        lineHeight: "1.55",
      },
    }),
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
    extensions: editorBaseExtensions(initialLanguage),
  });
  view.value = new EditorView({ state, parent: host.value });
  updateCursorInfo(state);

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
    await mountEditor(result.content);
  }
}

async function save() {
  if (!dirty.value) return;
  await writeEditorDocument(props.path, buffer.value);
  savedContent.value = buffer.value;
  setDirty(false);
  emit("saved");
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

function setContentForTest(content: string) {
  const current = view.value;
  if (!current) {
    buffer.value = content;
    setDirty(content !== savedContent.value);
    return;
  }
  current.dispatch({
    changes: { from: 0, to: current.state.doc.length, insert: content },
  });
}

watch(() => props.path, () => void load(), { immediate: true });

watch(
  () => prefs.editorTheme,
  () => {
    if (doc.value.status === "ready") void mountEditor(buffer.value);
  },
);

onBeforeUnmount(() => {
  destroyEditor();
});

defineExpose({
  save,
  focus,
  getSelection,
  setContentForTest,
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-background">
    <EditorToolbar
      :file-name="fileName"
      :language-label="languageLabel"
      :dirty="dirty"
      :is-markdown="markdown"
      :mode="mode"
      @save="() => void save()"
      @mode-change="setMode"
    />

    <div v-if="doc.status === 'loading'" class="grid min-h-0 flex-1 place-items-center">
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <NSpin size="small" />
        <span>Loading...</span>
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
        <div class="text-sm font-medium">Binary file</div>
        <div class="mt-1 text-xs text-muted-foreground">
          {{ formatBytes(doc.size) }} · preview not supported
        </div>
      </div>
    </div>
    <div
      v-else-if="doc.status === 'toolarge'"
      class="grid min-h-0 flex-1 place-items-center p-6 text-center"
    >
      <div>
        <div class="text-sm font-medium">File too large</div>
        <div class="mt-1 text-xs text-muted-foreground">
          {{ formatBytes(doc.size) }} exceeds the {{ formatBytes(doc.limit) }} limit.
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
          <div ref="host" data-editor-host class="h-full min-h-0" />
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
