<script setup lang="ts">
import { computed, type TextareaHTMLAttributes } from "vue";
import { NButton, NInput } from "naive-ui";
import { t } from "@/modules/i18n/translate";
import type { BusyAction } from "./useSourceControlState";

const props = defineProps<{
  modelValue: string;
  stagedCount: number;
  canCommit: boolean;
  busyAction: BusyAction | null;
  inputProps: TextareaHTMLAttributes;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  commit: [];
  commitKeydown: [event: KeyboardEvent];
}>();

const message = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value),
});
</script>

<template>
  <div class="shrink-0 space-y-2 border-t border-border/60 p-2">
    <NInput
      v-model:value="message"
      type="textarea"
      size="small"
      :placeholder="t('sourceControl.commitMessage')"
      :autosize="{ minRows: 2, maxRows: 4 }"
      :input-props="props.inputProps"
      @keydown="(event: KeyboardEvent) => emit('commitKeydown', event)"
    />
    <div class="flex items-center gap-2">
      <span class="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
        {{ t("sourceControl.stagedCount", { count: props.stagedCount }) }}
      </span>
      <NButton
        size="small"
        type="primary"
        data-commit
        :disabled="!props.canCommit"
        :loading="props.busyAction === 'commit'"
        @click="emit('commit')"
      >
        {{ t("common.commit") }}
      </NButton>
    </div>
  </div>
</template>
