<script setup lang="ts">
const props = defineProps<{
  languageLabel: string;
  sizeLabel: string;
  dirty: boolean;
  line: number;
  column: number;
  selectionLength: number;
}>();
</script>

<template>
  <div class="flex h-7 shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-background/95 px-3 text-[11px] text-muted-foreground">
    <div class="flex min-w-0 items-center gap-3">
      <span class="truncate">{{ props.languageLabel }}</span>
      <span>{{ props.sizeLabel }}</span>
      <span v-if="props.dirty" class="text-foreground">Unsaved</span>
    </div>
    <div class="flex shrink-0 items-center gap-3 tabular-nums">
      <span v-if="props.selectionLength > 0">Sel {{ props.selectionLength }}</span>
      <span>Ln {{ props.line }}, Col {{ props.column }}</span>
    </div>
  </div>
</template>
