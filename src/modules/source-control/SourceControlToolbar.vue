<script setup lang="ts">
import {
  ArrowDownOutline,
  ArrowUpOutline,
  GitBranchOutline,
  RefreshOutline,
  SyncOutline,
  TimeOutline,
} from "@vicons/ionicons5";
import { NButton, NIcon, NTag } from "naive-ui";
import TooltipTitle from "@/components/TooltipTitle.vue";
import type { GitStatusSnapshot } from "@/lib/native";
import { t } from "@/modules/i18n/translate";
import type { BusyAction } from "./useSourceControlState";

const props = defineProps<{
  branchLabel: string;
  changedCount: number;
  repoRoot: string | null;
  status: GitStatusSnapshot | null;
  busyAction: BusyAction | null;
}>();

const emit = defineEmits<{
  fetch: [];
  pull: [];
  push: [];
  refresh: [];
  openHistory: [];
}>();
</script>

<template>
  <div>
    <div class="flex h-9 shrink-0 items-center gap-1 border-b border-border/60 px-2">
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <NIcon :component="GitBranchOutline" :size="14" class="shrink-0 text-muted-foreground" />
        <span class="truncate text-[12px] font-semibold">{{ props.branchLabel }}</span>
      </div>
      <NTag v-if="props.changedCount > 0" size="small" round>{{ props.changedCount }}</NTag>
      <TooltipTitle :label="t('sourceControl.fetch')">
        <NButton
          size="tiny"
          quaternary
          data-git-fetch
          :aria-label="t('sourceControl.fetch')"
          :loading="props.busyAction === 'fetch'"
          :disabled="!props.repoRoot || (props.busyAction !== null && props.busyAction !== 'fetch')"
          @click="emit('fetch')"
        >
          <template #icon><NIcon :component="SyncOutline" /></template>
        </NButton>
      </TooltipTitle>
      <TooltipTitle :label="t('sourceControl.pull')">
        <NButton
          size="tiny"
          quaternary
          data-git-pull
          :aria-label="t('sourceControl.pull')"
          :loading="props.busyAction === 'pull'"
          :disabled="!props.repoRoot || (props.busyAction !== null && props.busyAction !== 'pull')"
          @click="emit('pull')"
        >
          <template #icon><NIcon :component="ArrowDownOutline" /></template>
        </NButton>
      </TooltipTitle>
      <TooltipTitle :label="t('sourceControl.push')">
        <NButton
          size="tiny"
          quaternary
          data-git-push
          :aria-label="t('sourceControl.push')"
          :loading="props.busyAction === 'push'"
          :disabled="!props.repoRoot || (props.busyAction !== null && props.busyAction !== 'push')"
          @click="emit('push')"
        >
          <template #icon><NIcon :component="ArrowUpOutline" /></template>
        </NButton>
      </TooltipTitle>
      <TooltipTitle :label="t('common.refresh')">
        <NButton
          size="tiny"
          quaternary
          :aria-label="t('common.refresh')"
          :loading="props.busyAction === 'refresh'"
          @click="emit('refresh')"
        >
          <template #icon><NIcon :component="RefreshOutline" /></template>
        </NButton>
      </TooltipTitle>
      <TooltipTitle :label="t('common.history')">
        <NButton
          size="tiny"
          quaternary
          data-open-history
          :aria-label="t('common.history')"
          :disabled="!props.repoRoot"
          @click="emit('openHistory')"
        >
          <template #icon><NIcon :component="TimeOutline" /></template>
        </NButton>
      </TooltipTitle>
    </div>

    <div
      v-if="props.repoRoot && props.status"
      class="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-2 py-2"
    >
      <NTag size="small" round type="info">{{ props.branchLabel }}</NTag>
      <NTag v-if="props.status.upstream" size="small" round>{{ props.status.upstream }}</NTag>
      <span class="min-w-0 flex-1 truncate text-right text-[11px] text-muted-foreground">
        <template v-if="props.status.ahead > 0 || props.status.behind > 0">
          ↑{{ props.status.ahead }} ↓{{ props.status.behind }}
        </template>
        <template v-else>{{ t("sourceControl.cleanRemoteState") }}</template>
      </span>
    </div>
  </div>
</template>
