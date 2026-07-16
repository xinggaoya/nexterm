<script setup lang="ts">
import * as monaco from "monaco-editor";
import { nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import { buildMonacoDiffOptions } from "./lib/editorConfig";
import { resolveMonacoLanguageId } from "./lib/languageMap";
import { registerMonacoThemes } from "./lib/themes";

registerMonacoThemes(monaco);

const props = defineProps<{
  path: string;
  originalContent: string;
  modifiedContent: string;
  testId: string;
}>();

const prefs = usePreferencesPiniaStore();
const host = ref<HTMLDivElement | null>(null);
const editor = shallowRef<monaco.editor.IStandaloneDiffEditor | null>(null);
const models = shallowRef<{
  original: monaco.editor.ITextModel;
  modified: monaco.editor.ITextModel;
} | null>(null);

async function mountDiff() {
  await nextTick();
  if (!host.value) return;
  if (editor.value) {
    editor.value.dispose();
    editor.value = null;
  }
  if (models.value) {
    models.value.original.dispose();
    models.value.modified.dispose();
    models.value = null;
  }
  host.value.innerHTML = "";
  const lang = resolveMonacoLanguageId(props.path) ?? "plaintext";
  const original = monaco.editor.createModel(props.originalContent, lang);
  const modified = monaco.editor.createModel(props.modifiedContent, lang);
  const fresh = monaco.editor.createDiffEditor(host.value, {
    ...buildMonacoDiffOptions(prefs),
  });
  monaco.editor.setTheme(prefs.editorTheme);
  fresh.setModel({ original, modified });
  editor.value = fresh;
  models.value = { original, modified };
}

watch(
  () => [
    props.path,
    props.originalContent,
    props.modifiedContent,
    prefs.editorTheme,
    prefs.editorFontSize,
  ],
  () => void mountDiff(),
  { immediate: true },
);

onBeforeUnmount(() => {
  editor.value?.dispose();
  editor.value = null;
  if (models.value) {
    models.value.original.dispose();
    models.value.modified.dispose();
    models.value = null;
  }
});
</script>

<template>
  <div
    :data-testid="props.testId"
    class="h-full min-h-0 w-full overflow-hidden"
  >
    <div
      ref="host"
      :data-git-diff-host="props.testId === 'git-diff-host' ? '' : undefined"
      class="nexterm-editor-scrollbar h-full min-h-0"
    />
  </div>
</template>
