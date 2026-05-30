<script setup lang="ts">
import { NButton, NButtonGroup } from "naive-ui";
import { t } from "@/modules/i18n/translate";
import type { EditorViewMode } from "./editorTypes";

const props = defineProps<{
  fileName: string;
  languageLabel: string;
  dirty: boolean;
  externalChangePending: boolean;
  isMarkdown: boolean;
  mode: EditorViewMode;
}>();

const emit = defineEmits<{
  dismissExternalChange: [];
  reloadExternalChange: [];
  save: [];
  modeChange: [mode: EditorViewMode];
}>();
</script>

<template>
  <div class="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-background/95 px-3">
    <div class="flex min-w-0 items-center gap-2">
      <div class="min-w-0">
        <div class="truncate text-[12px] font-medium leading-4">{{ props.fileName }}</div>
        <div class="truncate text-[10px] leading-3 text-muted-foreground">
          {{ props.languageLabel }}{{ props.dirty ? ` · ${t("editor.unsaved")}` : "" }}
        </div>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-2">
      <div
        v-if="props.externalChangePending"
        class="flex max-w-64 items-center gap-1 rounded border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-200"
        data-editor-external-change
      >
        <span class="truncate">{{ t("editor.externalChangePending") }}</span>
        <NButton
          size="tiny"
          quaternary
          data-editor-reload-external
          @click="emit('reloadExternalChange')"
        >
          {{ t("editor.reloadFromDisk") }}
        </NButton>
        <NButton
          size="tiny"
          quaternary
          data-editor-dismiss-external
          @click="emit('dismissExternalChange')"
        >
          {{ t("common.cancel") }}
        </NButton>
      </div>
      <NButtonGroup v-if="props.isMarkdown" size="tiny" data-editor-mode-controls>
        <NButton
          data-editor-mode-source
          :secondary="props.mode !== 'source'"
          :type="props.mode === 'source' ? 'primary' : 'default'"
          :aria-pressed="props.mode === 'source'"
          @click="emit('modeChange', 'source')"
        >
          {{ t("editor.source") }}
        </NButton>
        <NButton
          data-editor-mode-split
          :secondary="props.mode !== 'split'"
          :type="props.mode === 'split' ? 'primary' : 'default'"
          :aria-pressed="props.mode === 'split'"
          @click="emit('modeChange', 'split')"
        >
          {{ t("editor.split") }}
        </NButton>
        <NButton
          data-editor-mode-preview
          :secondary="props.mode !== 'preview'"
          :type="props.mode === 'preview' ? 'primary' : 'default'"
          :aria-pressed="props.mode === 'preview'"
          @click="emit('modeChange', 'preview')"
        >
          {{ t("preview.preview") }}
        </NButton>
      </NButtonGroup>

      <NButton
        size="tiny"
        secondary
        :disabled="!props.dirty"
        @click="emit('save')"
      >
        {{ t("editor.save") }}
      </NButton>
    </div>
  </div>
</template>
