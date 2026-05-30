<script setup lang="ts">
import {
  AddOutline,
  CheckmarkCircleOutline,
  DocumentOutline,
  RemoveOutline,
  SquareOutline,
  TrashOutline,
} from "@vicons/ionicons5";
import { NButton, NCheckbox, NIcon, NTag } from "naive-ui";
import { computed, ref, watch } from "vue";
import TooltipTitle from "@/components/TooltipTitle.vue";
import type { GitDiscardEntry } from "@/lib/native";
import { t } from "@/modules/i18n/translate";
import {
  sourceControlGroupLabel,
  stageLabel,
  statusTone,
} from "./sourceControlFormat";
import {
  groupSourceControlEntries,
  type SourceControlFileEntry,
} from "./sourceControlModel";
import type { BusyAction } from "./useSourceControlState";

type VirtualChangeRow =
  | {
      kind: "group";
      key: string;
      groupKey: ReturnType<typeof groupSourceControlEntries>[number]["key"];
      count: number;
    }
  | {
      kind: "entry";
      key: string;
      entry: SourceControlFileEntry;
    };

type VisibleVirtualChangeRow = {
  row: VirtualChangeRow;
  top: number;
};

const CHANGE_ROW_HEIGHT = 32;
const GROUP_ROW_HEIGHT = 28;
const CHANGE_OVERSCAN_ROWS = 8;

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
  stageSelected: [entries: SourceControlFileEntry[]];
  unstageSelected: [entries: SourceControlFileEntry[]];
  confirmDiscardSelected: [entries: SourceControlFileEntry[]];
}>();

const groupedEntries = computed(() => groupSourceControlEntries(props.entries));
const scrollHost = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportHeight = ref(0);
const selectedPaths = ref<Set<string>>(new Set());
const selectedEntries = computed(() =>
  props.entries.filter((entry) => selectedPaths.value.has(entry.path)),
);
const selectedStageable = computed(() =>
  selectedEntries.value.filter((entry) => entry.unstaged),
);
const selectedUnstageable = computed(() =>
  selectedEntries.value.filter((entry) => entry.staged),
);
const selectedDiscardable = computed(() =>
  selectedEntries.value.filter((entry) => entry.unstaged),
);
const hasSelection = computed(() => selectedEntries.value.length > 0);
const virtualRows = computed<VirtualChangeRow[]>(() =>
  groupedEntries.value.flatMap((group) => [
    {
      kind: "group" as const,
      key: `group:${group.key}`,
      groupKey: group.key,
      count: group.entries.length,
    },
    ...group.entries.map((entry) => ({
      kind: "entry" as const,
      key: `entry:${entry.key}`,
      entry,
    })),
  ]),
);
const virtualRowTops = computed(() => {
  const tops: number[] = [];
  let cursor = 0;
  for (const row of virtualRows.value) {
    tops.push(cursor);
    cursor += virtualRowHeight(row);
  }
  return tops;
});
const totalVirtualHeight = computed(() => {
  const rows = virtualRows.value;
  const tops = virtualRowTops.value;
  if (rows.length === 0) return 0;
  return tops[tops.length - 1] + virtualRowHeight(rows[rows.length - 1]);
});
const visibleRows = computed<VisibleVirtualChangeRow[]>(() => {
  const rows = virtualRows.value;
  if (rows.length === 0) return [];
  const viewport = viewportHeight.value || 480;
  const startY = Math.max(0, scrollTop.value - CHANGE_ROW_HEIGHT * CHANGE_OVERSCAN_ROWS);
  const endY = scrollTop.value + viewport + CHANGE_ROW_HEIGHT * CHANGE_OVERSCAN_ROWS;
  const tops = virtualRowTops.value;
  const visible: VisibleVirtualChangeRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const top = tops[i];
    const bottom = top + virtualRowHeight(row);
    if (bottom < startY) continue;
    if (top > endY) break;
    visible.push({ row, top });
  }
  return visible;
});
const visibleGroupRows = computed(
  () =>
    visibleRows.value.filter(
      (item): item is VisibleVirtualChangeRow & {
        row: Extract<VirtualChangeRow, { kind: "group" }>;
      } => item.row.kind === "group",
    ),
);
const visibleEntryRows = computed(
  () =>
    visibleRows.value.filter(
      (item): item is VisibleVirtualChangeRow & {
        row: Extract<VirtualChangeRow, { kind: "entry" }>;
      } => item.row.kind === "entry",
    ),
);

function virtualRowHeight(row: VirtualChangeRow): number {
  return row.kind === "group" ? GROUP_ROW_HEIGHT : CHANGE_ROW_HEIGHT;
}

function updateViewport() {
  const host = scrollHost.value;
  if (!host) return;
  scrollTop.value = host.scrollTop;
  viewportHeight.value = host.clientHeight;
}

function isSelected(entry: SourceControlFileEntry): boolean {
  return selectedPaths.value.has(entry.path);
}

function toggleEntrySelection(entry: SourceControlFileEntry, checked: boolean) {
  const next = new Set(selectedPaths.value);
  if (checked) next.add(entry.path);
  else next.delete(entry.path);
  selectedPaths.value = next;
}

function clearSelection() {
  selectedPaths.value = new Set();
}

watch(
  () => props.entries.map((entry) => entry.path),
  (paths) => {
    const next = new Set<string>();
    for (const path of paths) {
      if (selectedPaths.value.has(path)) next.add(path);
    }
    selectedPaths.value = next;
  },
);

watch(scrollHost, (host) => {
  if (host) updateViewport();
});
</script>

<template>
  <div
    ref="scrollHost"
    class="min-h-0 flex-1 overflow-y-auto py-1"
    data-source-list-scroll
    @scroll.passive="updateViewport"
  >
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
          <template v-if="hasSelection">
            {{ t("sourceControl.selectedCount", { count: selectedEntries.length }) }}
          </template>
          <template v-else>
            {{ t("sourceControl.changes") }} · {{ props.changedCount }}
          </template>
        </div>
        <TooltipTitle v-if="hasSelection" :label="t('common.cancel')">
          <NButton
            size="tiny"
            quaternary
            data-clear-selection
            :aria-label="t('common.cancel')"
            @click="clearSelection"
          >
            <template #icon><NIcon :component="SquareOutline" /></template>
          </NButton>
        </TooltipTitle>
        <TooltipTitle :label="t('sourceControl.stageAll')">
          <NButton
            size="tiny"
            quaternary
            data-stage-all
            :aria-label="hasSelection ? t('sourceControl.stageSelected') : t('sourceControl.stageAll')"
            :loading="props.busyAction === 'stage-all'"
            :disabled="(hasSelection ? selectedStageable.length === 0 : props.stageAllPaths.length === 0) || (props.busyAction !== null && props.busyAction !== 'stage-all')"
            @click="hasSelection ? emit('stageSelected', selectedStageable) : emit('stageAll')"
          >
            <template #icon><NIcon :component="AddOutline" /></template>
          </NButton>
        </TooltipTitle>
        <TooltipTitle :label="t('sourceControl.unstageAll')">
          <NButton
            size="tiny"
            quaternary
            data-unstage-all
            :aria-label="hasSelection ? t('sourceControl.unstageSelected') : t('sourceControl.unstageAll')"
            :loading="props.busyAction === 'unstage-all'"
            :disabled="(hasSelection ? selectedUnstageable.length === 0 : props.unstageAllPaths.length === 0) || (props.busyAction !== null && props.busyAction !== 'unstage-all')"
            @click="hasSelection ? emit('unstageSelected', selectedUnstageable) : emit('unstageAll')"
          >
            <template #icon><NIcon :component="RemoveOutline" /></template>
          </NButton>
        </TooltipTitle>
        <TooltipTitle :label="t('sourceControl.discardAllUnstaged')">
          <NButton
            size="tiny"
            quaternary
            data-discard-all
            :aria-label="hasSelection ? t('sourceControl.discardSelected') : t('sourceControl.discardAllUnstaged')"
            :loading="props.busyAction === 'discard-all'"
            :disabled="(hasSelection ? selectedDiscardable.length === 0 : props.discardAllEntries.length === 0) || (props.busyAction !== null && props.busyAction !== 'discard-all')"
            @click="hasSelection ? emit('confirmDiscardSelected', selectedDiscardable) : emit('confirmDiscardAll')"
          >
            <template #icon><NIcon :component="TrashOutline" /></template>
          </NButton>
        </TooltipTitle>
      </div>

      <div
        class="relative"
        :style="{ height: `${totalVirtualHeight}px` }"
        data-source-list-virtual
      >
        <div
          v-for="item in visibleGroupRows"
          :key="item.row.key"
          class="absolute inset-x-0"
          :style="{
            top: `${item.top}px`,
            height: `${virtualRowHeight(item.row)}px`,
          }"
        >
          <div
            class="flex h-7 items-center gap-2 px-1.5 pt-1"
            :data-source-group="item.row.groupKey"
          >
            <span class="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {{ sourceControlGroupLabel(item.row.groupKey, t) }}
            </span>
            <span class="shrink-0 text-[10px] tabular-nums text-muted-foreground">
              {{ item.row.count }}
            </span>
          </div>
        </div>
        <div
          v-for="item in visibleEntryRows"
          :key="item.row.key"
          class="absolute inset-x-0"
          :style="{
            top: `${item.top}px`,
            height: `${CHANGE_ROW_HEIGHT}px`,
          }"
        >
          <div
            :class="[
              'group flex h-8 min-w-0 items-center gap-1 rounded-md px-1 transition-colors hover:bg-muted/80',
              isSelected(item.row.entry) ? 'bg-accent/70' : '',
            ]"
          >
            <NCheckbox
              size="small"
              :checked="isSelected(item.row.entry)"
              :data-source-select="item.row.entry.path"
              :aria-label="t('sourceControl.selectFile', { path: item.row.entry.path })"
              @update:checked="(checked) => toggleEntrySelection(item.row.entry, checked)"
              @click.stop
            />
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px]"
              :data-source-file="item.row.entry.path"
              @click="emit('openDiff', item.row.entry)"
            >
              <NIcon :component="DocumentOutline" :size="14" class="shrink-0 text-muted-foreground" />
              <span class="min-w-0 flex-1 truncate">{{ item.row.entry.path }}</span>
              <NTag size="small" :type="statusTone(item.row.entry.statusCode)">
                {{ item.row.entry.statusCode }}
              </NTag>
              <span class="w-14 shrink-0 text-right text-[10px] text-muted-foreground">
                {{ stageLabel(item.row.entry, t) }}
              </span>
            </button>
            <TooltipTitle v-if="item.row.entry.unstaged" :label="t('sourceControl.discardChanges')">
              <NButton
                size="tiny"
                quaternary
                type="error"
                :data-discard-file="item.row.entry.path"
                :aria-label="t('sourceControl.discardChanges')"
                :loading="props.busyAction === `discard:${item.row.entry.path}`"
                :disabled="props.busyAction !== null && props.busyAction !== `discard:${item.row.entry.path}`"
                @click.stop="emit('confirmDiscardFile', item.row.entry)"
              >
                <template #icon><NIcon :component="TrashOutline" /></template>
              </NButton>
            </TooltipTitle>
            <TooltipTitle v-if="item.row.entry.checkState === 'checked'" :label="t('sourceControl.unstage')">
              <NButton
                size="tiny"
                quaternary
                :data-unstage-file="item.row.entry.path"
                :aria-label="t('sourceControl.unstage')"
                :loading="props.busyAction === `unstage:${item.row.entry.path}`"
                :disabled="props.busyAction !== null && props.busyAction !== `unstage:${item.row.entry.path}`"
                @click.stop="emit('unstageFile', item.row.entry)"
              >
                <template #icon><NIcon :component="RemoveOutline" /></template>
              </NButton>
            </TooltipTitle>
            <TooltipTitle v-else :label="t('sourceControl.stage')">
              <NButton
                size="tiny"
                quaternary
                :data-stage-file="item.row.entry.path"
                :aria-label="t('sourceControl.stage')"
                :loading="props.busyAction === `stage:${item.row.entry.path}`"
                :disabled="props.busyAction !== null && props.busyAction !== `stage:${item.row.entry.path}`"
                @click.stop="emit('stageFile', item.row.entry)"
              >
                <template #icon><NIcon :component="AddOutline" /></template>
              </NButton>
            </TooltipTitle>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
