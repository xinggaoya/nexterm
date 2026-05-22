<script setup lang="ts">
import { NButton, NButtonGroup } from "naive-ui";
import type { EditorViewMode } from "./editorTypes";

const props = defineProps<{
  fileName: string;
  languageLabel: string;
  dirty: boolean;
  isMarkdown: boolean;
  mode: EditorViewMode;
}>();

const emit = defineEmits<{
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
          {{ props.languageLabel }}{{ props.dirty ? " · Unsaved" : "" }}
        </div>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-2">
      <NButtonGroup v-if="props.isMarkdown" size="tiny" data-editor-mode-controls>
        <NButton
          data-editor-mode-source
          :secondary="props.mode !== 'source'"
          :type="props.mode === 'source' ? 'primary' : 'default'"
          :aria-pressed="props.mode === 'source'"
          @click="emit('modeChange', 'source')"
        >
          Source
        </NButton>
        <NButton
          data-editor-mode-split
          :secondary="props.mode !== 'split'"
          :type="props.mode === 'split' ? 'primary' : 'default'"
          :aria-pressed="props.mode === 'split'"
          @click="emit('modeChange', 'split')"
        >
          Split
        </NButton>
        <NButton
          data-editor-mode-preview
          :secondary="props.mode !== 'preview'"
          :type="props.mode === 'preview' ? 'primary' : 'default'"
          :aria-pressed="props.mode === 'preview'"
          @click="emit('modeChange', 'preview')"
        >
          Preview
        </NButton>
      </NButtonGroup>

      <NButton
        size="tiny"
        secondary
        :disabled="!props.dirty"
        @click="emit('save')"
      >
        Save
      </NButton>
    </div>
  </div>
</template>
