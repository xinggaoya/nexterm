<script setup lang="ts">
import {
  AddOutline,
  CheckmarkCircleOutline,
  DocumentOutline,
  RemoveOutline,
  TrashOutline,
} from "@vicons/ionicons5";
import { NButton, NIcon, NTag } from "naive-ui";
import TooltipTitle from "@/components/TooltipTitle.vue";
import type { GitDiscardEntry } from "@/lib/native";
import { t } from "@/modules/i18n/translate";
import { stageLabel, statusTone } from "./sourceControlFormat";
import type { SourceControlFileEntry } from "./sourceControlModel";
import type { BusyAction } from "./useSourceControlState";

const props = defineProps<{
  entries: SourceControlFileEntry[];
  changedCount: number;
  stageAllPaths: string[];
  unstageAllPaths: string[];
  discardAllEntries: GitDiscardEntry[];
  busyAction: BusyAction | null;
}>();

const emit = defineEmits<{
  openDiff: [entry: SourceControlFileEntry];
  stageFile: [entry: SourceControlFileEntry];
  unstageFile: [entry: SourceControlFileEntry];
  confirmDiscardFile: [entry: SourceControlFileEntry];
  stageAll: [];
  unstageAll: [];
  confirmDiscardAll: [];
}>();
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto py-1">
    <div v-if="props.entries.length === 0" class="grid h-full place-items-center p-4 text-center">
      <div class="space-y-1">
        <NIcon :component="CheckmarkCircleOutline" :size="22" class="text-emerald-500" />
        <div class="text-[12px] text-muted-foreground">
          {{ t("sourceControl.noChanges") }}
        </div>
      </div>
    </div>

    <div v-else class="space-y-0.5 px-1">
      <div class="flex items-center gap-1 px-1.5 pb-1 pt-0.5">
        <div class="min-w-0 flex-1 truncate text-[11px] font-medium text-muted-foreground">
          {{ t("sourceControl.changes") }} · {{ props.changedCount }}
        </div>
        <TooltipTitle :label="t('sourceControl.stageAll')">
          <NButton
            size="tiny"
            quaternary
            data-stage-all
            :aria-label="t('sourceControl.stageAll')"
            :loading="props.busyAction === 'stage-all'"
            :disabled="props.stageAllPaths.length === 0 || (props.busyAction !== null && props.busyAction !== 'stage-all')"
            @click="emit('stageAll')"
          >
            <template #icon><NIcon :component="AddOutline" /></template>
          </NButton>
        </TooltipTitle>
        <TooltipTitle :label="t('sourceControl.unstageAll')">
          <NButton
            size="tiny"
            quaternary
            data-unstage-all
            :aria-label="t('sourceControl.unstageAll')"
            :loading="props.busyAction === 'unstage-all'"
            :disabled="props.unstageAllPaths.length === 0 || (props.busyAction !== null && props.busyAction !== 'unstage-all')"
            @click="emit('unstageAll')"
          >
            <template #icon><NIcon :component="RemoveOutline" /></template>
          </NButton>
        </TooltipTitle>
        <TooltipTitle :label="t('sourceControl.discardAllUnstaged')">
          <NButton
            size="tiny"
            quaternary
            data-discard-all
            :aria-label="t('sourceControl.discardAllUnstaged')"
            :loading="props.busyAction === 'discard-all'"
            :disabled="props.discardAllEntries.length === 0 || (props.busyAction !== null && props.busyAction !== 'discard-all')"
            @click="emit('confirmDiscardAll')"
          >
            <template #icon><NIcon :component="TrashOutline" /></template>
          </NButton>
        </TooltipTitle>
      </div>

      <div
        v-for="entry in props.entries"
        :key="entry.key"
        class="group flex h-8 min-w-0 items-center gap-1 rounded-md px-1 transition-colors hover:bg-muted/80"
      >
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px]"
          :data-source-file="entry.path"
          @click="emit('openDiff', entry)"
        >
          <NIcon :component="DocumentOutline" :size="14" class="shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1 truncate">{{ entry.path }}</span>
          <NTag size="small" :type="statusTone(entry.statusCode)">
            {{ entry.statusCode }}
          </NTag>
          <span class="w-14 shrink-0 text-right text-[10px] text-muted-foreground">
            {{ stageLabel(entry, t) }}
          </span>
        </button>
        <TooltipTitle v-if="entry.unstaged" :label="t('sourceControl.discardChanges')">
          <NButton
            size="tiny"
            quaternary
            type="error"
            :data-discard-file="entry.path"
            :aria-label="t('sourceControl.discardChanges')"
            :loading="props.busyAction === `discard:${entry.path}`"
            :disabled="props.busyAction !== null && props.busyAction !== `discard:${entry.path}`"
            @click.stop="emit('confirmDiscardFile', entry)"
          >
            <template #icon><NIcon :component="TrashOutline" /></template>
          </NButton>
        </TooltipTitle>
        <TooltipTitle v-if="entry.checkState === 'checked'" :label="t('sourceControl.unstage')">
          <NButton
            size="tiny"
            quaternary
            :data-unstage-file="entry.path"
            :aria-label="t('sourceControl.unstage')"
            :loading="props.busyAction === `unstage:${entry.path}`"
            :disabled="props.busyAction !== null && props.busyAction !== `unstage:${entry.path}`"
            @click.stop="emit('unstageFile', entry)"
          >
            <template #icon><NIcon :component="RemoveOutline" /></template>
          </NButton>
        </TooltipTitle>
        <TooltipTitle v-else :label="t('sourceControl.stage')">
          <NButton
            size="tiny"
            quaternary
            :data-stage-file="entry.path"
            :aria-label="t('sourceControl.stage')"
            :loading="props.busyAction === `stage:${entry.path}`"
            :disabled="props.busyAction !== null && props.busyAction !== `stage:${entry.path}`"
            @click.stop="emit('stageFile', entry)"
          >
            <template #icon><NIcon :component="AddOutline" /></template>
          </NButton>
        </TooltipTitle>
      </div>
    </div>
  </div>
</template>
