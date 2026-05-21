<script setup lang="ts">
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { autocompletion, closeBrackets } from "@codemirror/autocomplete";
import { bracketMatching, foldGutter } from "@codemirror/language";
import { lintGutter } from "@codemirror/lint";
import { search, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { NButton, NSpin } from "naive-ui";
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import {
  readEditorDocument,
  writeEditorDocument,
  type EditorDocumentState,
} from "./lib/documentService";
import { resolveLanguage } from "./lib/languageResolver";
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

const fileName = computed(() => {
  const parts = props.path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : props.path;
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

function destroyEditor() {
  view.value?.destroy();
  view.value = null;
  if (host.value) host.value.innerHTML = "";
}

function editorBaseExtensions(): Extension[] {
  const theme = EDITOR_THEME_EXT[prefs.editorTheme] ?? EDITOR_THEME_EXT.atomone;
  return [
    lineNumbers(),
    foldGutter(),
    highlightActiveLineGutter(),
    history(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    search({ top: true }),
    lintGutter(),
    highlightActiveLine(),
    theme,
    EditorState.tabSize.of(2),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      const next = update.state.doc.toString();
      buffer.value = next;
      setDirty(next !== savedContent.value);
    }),
    EditorView.theme({
      "&": { height: "100%" },
      ".cm-scroller": {
        fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
        fontSize: "13px",
        lineHeight: "1.55",
      },
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
  const language = await resolveLanguage(props.path);
  const state = EditorState.create({
    doc: content,
    extensions: [
      ...editorBaseExtensions(),
      ...(language ? [language] : []),
    ],
  });
  view.value = new EditorView({ state, parent: host.value });
}

async function load() {
  destroyEditor();
  doc.value = { status: "loading" };
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
    <div class="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-3">
      <div class="min-w-0">
        <div class="truncate text-[12px] font-medium">{{ fileName }}</div>
      </div>
      <NButton
        size="tiny"
        secondary
        :disabled="!dirty"
        @click="() => void save()"
      >
        Save
      </NButton>
    </div>

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
    <div v-if="doc.status === 'ready'" ref="host" data-editor-host class="min-h-0 flex-1 overflow-hidden" />
  </div>
</template>
