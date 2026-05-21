<script setup lang="ts">
import { foldGutter } from "@codemirror/language";
import { unifiedMergeView } from "@codemirror/merge";
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  lineNumbers,
} from "@codemirror/view";
import { nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import { buildSharedExtensions, languageCompartment } from "./lib/extensions";
import { resolveLanguage, resolveLanguageSync } from "./lib/languageResolver";
import { EDITOR_THEME_EXT } from "./lib/themes";

const props = defineProps<{
  path: string;
  originalContent: string;
  modifiedContent: string;
  testId: string;
}>();

const prefs = usePreferencesPiniaStore();
const host = ref<HTMLDivElement | null>(null);
const view = shallowRef<EditorView | null>(null);

const READONLY_EXT: Extension[] = [
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
];

const DIFF_THEME = EditorView.theme({
  "&.cm-merge-b .cm-changedText, .cm-changedText": {
    background: "rgba(110, 200, 120, 0.20) !important",
    borderRadius: "3px",
    padding: "0 1px",
  },
  ".cm-deletedChunk .cm-deletedText, &.cm-merge-b .cm-deletedText": {
    background: "rgba(220, 90, 90, 0.22) !important",
    borderRadius: "3px",
    padding: "0 1px",
  },
  "&.cm-merge-b .cm-changedLine, .cm-changedLine, .cm-inlineChangedLine": {
    backgroundColor: "rgba(110, 200, 120, 0.05) !important",
  },
  ".cm-deletedChunk": {
    backgroundColor: "rgba(220, 90, 90, 0.05) !important",
    paddingTop: "1px",
    paddingBottom: "1px",
  },
  "&.cm-merge-b .cm-changedLineGutter, .cm-changedLineGutter": {
    background: "rgba(110, 200, 120, 0.55) !important",
  },
  ".cm-deletedLineGutter, &.cm-merge-a .cm-changedLineGutter": {
    background: "rgba(220, 90, 90, 0.5) !important",
  },
  ".cm-changeGutter": {
    width: "2px !important",
    paddingLeft: "0 !important",
  },
  ".cm-collapsedLines": {
    backgroundColor: "transparent",
    color: "var(--muted-foreground, #9ca3af)",
    fontSize: "10.5px",
    padding: "2px 8px",
    opacity: 0.7,
  },
});

function destroyEditor() {
  view.value?.destroy();
  view.value = null;
  if (host.value) host.value.innerHTML = "";
}

function editorExtensions(language: Extension | null): Extension[] {
  const theme = EDITOR_THEME_EXT[prefs.editorTheme] ?? EDITOR_THEME_EXT.atomone;
  return [
    lineNumbers(),
    foldGutter(),
    ...buildSharedExtensions(),
    languageCompartment.of(language ?? []),
    ...READONLY_EXT,
    unifiedMergeView({
      original: props.originalContent,
      mergeControls: false,
      highlightChanges: true,
      gutter: true,
      syntaxHighlightDeletions: true,
      collapseUnchanged: { margin: 3, minSize: 6 },
    }),
    DIFF_THEME,
    theme,
    EditorView.theme({
      "&": { height: "100%" },
      ".cm-scroller": { overflow: "auto" },
    }),
  ];
}

async function mountEditor() {
  await nextTick();
  if (!host.value) return;
  destroyEditor();
  const initialLanguage = resolveLanguageSync(props.path);
  const state = EditorState.create({
    doc: props.modifiedContent,
    extensions: editorExtensions(initialLanguage),
  });
  view.value = new EditorView({ state, parent: host.value });

  if (initialLanguage) return;
  const currentPath = props.path;
  const language = await resolveLanguage(currentPath);
  if (props.path !== currentPath || !view.value) return;
  view.value.dispatch({
    effects: languageCompartment.reconfigure(language ?? []),
  });
}

watch(
  () => [
    props.path,
    props.originalContent,
    props.modifiedContent,
    prefs.editorTheme,
  ],
  () => void mountEditor(),
  { immediate: true },
);

onBeforeUnmount(destroyEditor);
</script>

<template>
  <div :data-testid="props.testId" class="h-full min-h-0 w-full overflow-hidden">
    <div
      ref="host"
      :data-git-diff-host="props.testId === 'git-diff-host' ? '' : undefined"
      class="h-full min-h-0"
    />
  </div>
</template>
