<script setup lang="ts">
import { CheckmarkOutline, CloseOutline } from "@vicons/ionicons5";
import { NButton, NIcon, NTag } from "naive-ui";
import { computed } from "vue";
import type { AiDiffStatus } from "@/modules/tabs/tabsTypes";
import DiffCodeMirror from "./DiffCodeMirror.vue";
import { computeLineStats } from "./lib/diffStats";

const props = defineProps<{
  path: string;
  originalContent: string;
  proposedContent: string;
  status: AiDiffStatus;
  isNewFile: boolean;
}>();

const emit = defineEmits<{
  accept: [];
  reject: [];
}>();

const STATUS_LABEL: Record<AiDiffStatus, string> = {
  pending: "Pending review",
  approved: "Applied",
  rejected: "Rejected",
};

const STATUS_TYPE: Record<AiDiffStatus, "default" | "success" | "error"> = {
  pending: "default",
  approved: "success",
  rejected: "error",
};

const stats = computed(() =>
  computeLineStats(props.originalContent, props.proposedContent),
);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col rounded-md border border-border/60 bg-background">
    <div class="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-3">
      <div class="flex min-w-0 items-center gap-2">
        <NTag size="small" :type="STATUS_TYPE[props.status]" :bordered="false">
          {{ STATUS_LABEL[props.status] }}
        </NTag>
        <NTag v-if="props.isNewFile" size="small" :bordered="false">
          New file
        </NTag>
        <span
          class="truncate font-mono text-[11px] text-muted-foreground"
          :title="props.path"
        >
          {{ props.path }}
        </span>
        <span class="flex shrink-0 items-center gap-1.5 text-[10.5px] tabular-nums">
          <span class="text-emerald-600 dark:text-emerald-400">+{{ stats.added }}</span>
          <span class="text-rose-600 dark:text-rose-400">-{{ stats.removed }}</span>
        </span>
      </div>

      <div v-if="props.status === 'pending'" class="flex shrink-0 items-center gap-1.5">
        <NButton
          data-ai-diff-accept
          size="tiny"
          type="primary"
          @click="emit('accept')"
        >
          <template #icon><NIcon :component="CheckmarkOutline" /></template>
          Accept
        </NButton>
        <NButton
          data-ai-diff-reject
          size="tiny"
          quaternary
          @click="emit('reject')"
        >
          <template #icon><NIcon :component="CloseOutline" /></template>
          Reject
        </NButton>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-hidden">
      <DiffCodeMirror
        test-id="ai-diff-host"
        :path="props.path"
        :original-content="props.originalContent"
        :modified-content="props.proposedContent"
      />
    </div>
  </div>
</template>
