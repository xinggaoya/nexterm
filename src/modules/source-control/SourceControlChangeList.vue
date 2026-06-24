<script setup lang="ts">
import {
  AddOutline,
  CheckmarkCircleOutline,
  RemoveOutline,
  TrashOutline,
} from "@vicons/ionicons5";
import { NButton, NCheckbox, NIcon, NVirtualList } from "naive-ui";
import { computed, provide, readonly, toRef } from "vue";
import TooltipTitle from "@/components/TooltipTitle.vue";
import type { GitDiscardEntry } from "@/lib/native";
import { t } from "@/modules/i18n/translate";
import { statusKindLabel } from "./sourceControlFormat";
import {
  groupSourceControlEntries,
  type SourceControlEntryGroup,
  type SourceControlFileEntry,
  type SourceControlGroupId,
  type SourceControlStatusKind,
} from "./sourceControlModel";
import type { BusyAction } from "./useSourceControlState";
import SourceControlChangeRow from "./SourceControlChangeRow.vue";

const props = defineProps<{
  entries: SourceControlFileEntry[];
  selectedKeys: string[];
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
  toggleEntrySelected: [entry: SourceControlFileEntry, selected: boolean];
  setGroupSelected: [group: SourceControlGroupId, selected: boolean];
  stageAll: [];
  unstageAll: [];
  confirmDiscardAll: [];
}>();

// Expose the current busy action to every virtual row via provide so the
// list template can stay free of `busyAction` references. Without this,
// every change to the global busy action would force the list component
// (and therefore the NVirtualList slot) to re-render even though only a
// single row's button should be in a loading state.
provide("sourceControlBusyAction", readonly(toRef(props, "busyAction")));

type VirtualItem =
  | { kind: "groupHeader"; key: string; group: SourceControlEntryGroup }
  | {
      kind: "sectionHeader";
      key: string;
      groupId: SourceControlGroupId;
      statusKind: SourceControlStatusKind;
    }
  | { kind: "entry"; key: string; entry: SourceControlFileEntry };

const selectedKeySet = computed(() => {
  const set = new Set<string>();
  for (const k of props.selectedKeys) set.add(k);
  return set;
});

const groups = computed(() => groupSourceControlEntries(props.entries));

const virtualItems = computed<VirtualItem[]>(() => {
  const items: VirtualItem[] = [];
  for (const group of groups.value) {
    items.push({ kind: "groupHeader", key: `group:${group.id}`, group });
    for (const section of group.sections) {
      items.push({
        kind: "sectionHeader",
        key: `section:${group.id}:${section.statusKind}`,
        groupId: group.id,
        statusKind: section.statusKind,
      });
      for (const entry of section.entries) {
        items.push({ kind: "entry", key: entry.key, entry });
      }
    }
  }
  return items;
});

const groupCheckValue = (
  group: SourceControlEntryGroup,
): boolean | "mixed" => {
  const set = selectedKeySet.value;
  let selected = 0;
  for (const entry of group.entries) {
    if (set.has(entry.key)) selected++;
  }
  if (selected === 0) return false;
  if (selected === group.entries.length) return true;
  return "mixed";
};

const groupTitle = (group: SourceControlEntryGroup): string => {
  return group.id === "staged"
    ? t("sourceControl.stagedChanges")
    : t("sourceControl.changes");
};

const sectionTitle = (statusKind: SourceControlStatusKind): string => {
  return statusKindLabel(statusKind, t);
};
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col py-1">
    <div v-if="props.entries.length === 0" class="grid h-full place-items-center p-4 text-center">
      <div class="space-y-1">
        <NIcon :component="CheckmarkCircleOutline" :size="22" class="text-emerald-500" />
        <div class="text-[12px] text-muted-foreground">
          {{ t("sourceControl.noChanges") }}
        </div>
      </div>
    </div>

    <template v-else>
      <div class="flex items-center gap-1 px-2.5 pb-1 pt-0.5">
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

      <NVirtualList
        :items="virtualItems"
        :item-size="32"
        item-resizable
        class="source-control-virtual-list min-h-0 flex-1"
        data-source-control-list
      >
        <template #default="{ item }">
          <div
            v-if="item.kind === 'groupHeader'"
            class="flex h-7 items-center gap-1 rounded-sm px-1.5"
          >
            <NCheckbox
              size="small"
              :checked="groupCheckValue(item.group) === true"
              :indeterminate="groupCheckValue(item.group) === 'mixed'"
              :aria-label="groupTitle(item.group)"
              :data-source-group-check="item.group.id"
              @update:checked="(checked) => emit('setGroupSelected', item.group.id, checked === true)"
            />
            <div class="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-normal text-muted-foreground">
              {{ groupTitle(item.group) }} · {{ item.group.entries.length }}
            </div>
          </div>
          <div
            v-else-if="item.kind === 'sectionHeader'"
            class="flex h-5 items-center px-7 text-[10px] font-medium uppercase tracking-normal text-muted-foreground/80"
          >
            {{ sectionTitle(item.statusKind) }}
          </div>
          <SourceControlChangeRow
            v-else
            :entry="item.entry"
            :selected="selectedKeySet.has(item.entry.key)"
            @open-diff="emit('openDiff', $event)"
            @stage-file="emit('stageFile', $event)"
            @unstage-file="emit('unstageFile', $event)"
            @confirm-discard-file="emit('confirmDiscardFile', $event)"
            @toggle-entry-selected="(entry, checked) => emit('toggleEntrySelected', entry, checked)"
          />
        </template>
      </NVirtualList>
    </template>
  </div>
</template>

<style scoped>
.source-control-virtual-list {
  /* Allow the virtual list to take all remaining vertical space. */
  min-height: 0;
}
</style>
