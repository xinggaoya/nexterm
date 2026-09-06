<script setup lang="ts">
import { AddOutline, DocumentOutline, RemoveOutline, TrashOutline } from "@vicons/ionicons5";
import { NButton, NCheckbox, NIcon, NTag } from "naive-ui";
import { computed, inject, type Ref } from "vue";
import TooltipTitle from "@/components/TooltipTitle.vue";
import { t, tLoose } from "@/modules/i18n/translate";
import {
  stageLabel,
  statusClass,
  statusTone,
} from "@/modules/source-control/sourceControlFormat";
import type { SourceControlFileEntry } from "@/modules/source-control/sourceControlModel";
import type { BusyAction } from "@/modules/source-control/useSourceControlState";

const props = defineProps<{
  entry: SourceControlFileEntry;
  selected: boolean;
}>();

const emit = defineEmits<{
  openDiff: [entry: SourceControlFileEntry];
  stageFile: [entry: SourceControlFileEntry];
  unstageFile: [entry: SourceControlFileEntry];
  confirmDiscardFile: [entry: SourceControlFileEntry];
  toggleEntrySelected: [entry: SourceControlFileEntry, selected: boolean];
}>();

// Read the global busy action from the panel's provide, scoped to this
// row's path. We avoid prop-drilling the busy action into every virtual
// row so the parent template can stay free of `busyAction` references
// and so non-viewport rows are never even mounted in the Vue tree.
const busyActionRef = inject<Ref<BusyAction | null>>(
  "sourceControlBusyAction",
  null as unknown as Ref<BusyAction | null>,
);

const discardKey = computed(() => `discard:${props.entry.path}`);
const unstageKey = computed(() => `unstage:${props.entry.path}`);
const stageKey = computed(() => `stage:${props.entry.path}`);

const isDiscarding = computed(() => busyActionRef.value === discardKey.value);
const isUnstaging = computed(() => busyActionRef.value === unstageKey.value);
const isStaging = computed(() => busyActionRef.value === stageKey.value);

const hasBusyAction = computed(() => busyActionRef.value !== null);
const canDiscard = computed(
  () => !hasBusyAction.value || isDiscarding.value,
);
const canUnstage = computed(
  () => !hasBusyAction.value || isUnstaging.value,
);
const canStage = computed(
  () => !hasBusyAction.value || isStaging.value,
);

defineOptions({
  name: "SourceControlChangeRow",
});
</script>

<template>
  <div
    :data-source-row-key="entry.key"
    class="nexterm-row group flex h-7 min-w-0 items-center gap-1 px-1"
  >
    <NCheckbox
      size="small"
      :checked="selected"
      :aria-label="entry.path"
      :data-source-entry-check="entry.key"
      @update:checked="(checked) => emit('toggleEntrySelected', entry, checked === true)"
    />
    <button
      type="button"
      class="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px]"
      :data-source-file="entry.path"
      @click="emit('openDiff', entry)"
    >
      <NIcon
        :component="DocumentOutline"
        :size="14"
        :class="['shrink-0', statusClass(entry.statusKind)]"
      />
      <span :class="['min-w-0 flex-1 truncate', statusClass(entry.statusKind)]">
        {{ entry.path }}
      </span>
      <NTag size="small" :type="statusTone(entry.statusCode)">
        {{ entry.statusCode }}
      </NTag>
      <span class="w-14 shrink-0 text-right text-[10px] text-muted-foreground">
        {{ stageLabel(entry, tLoose) }}
      </span>
    </button>
    <TooltipTitle
      v-if="entry.group === 'changes' && entry.unstaged"
      :label="t('sourceControl.discardChanges')"
    >
      <NButton
        size="tiny"
        quaternary
        type="error"
        :data-discard-file="entry.path"
        :aria-label="t('sourceControl.discardChanges')"
        :loading="isDiscarding"
        :disabled="!canDiscard"
        @click.stop="emit('confirmDiscardFile', entry)"
      >
        <template #icon><NIcon :component="TrashOutline" /></template>
      </NButton>
    </TooltipTitle>
    <TooltipTitle
      v-if="entry.group === 'staged'"
      :label="t('sourceControl.unstage')"
    >
      <NButton
        size="tiny"
        quaternary
        :data-unstage-file="entry.path"
        :aria-label="t('sourceControl.unstage')"
        :loading="isUnstaging"
        :disabled="!canUnstage"
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
        :loading="isStaging"
        :disabled="!canStage"
        @click.stop="emit('stageFile', entry)"
      >
        <template #icon><NIcon :component="AddOutline" /></template>
      </NButton>
    </TooltipTitle>
  </div>
</template>
