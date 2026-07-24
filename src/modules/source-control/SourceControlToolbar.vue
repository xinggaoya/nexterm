<script setup lang="ts">
import {
  ArrowDownOutline,
  ArrowUpOutline,
  GitBranchOutline,
  GitNetworkOutline,
  RefreshOutline,
  SettingsOutline,
  SyncOutline,
  TimeOutline,
} from "@vicons/ionicons5";
import { NButton, NDropdown, NIcon, NTag, type DropdownOption } from "naive-ui";
import { computed, h } from "vue";
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
  openBranches: [];
  manageRemotes: [];
}>();

const remoteOptions = computed<DropdownOption[]>(() => [
  {
    key: "fetch",
    label: t("sourceControl.fetch"),
    icon: () => h(NIcon, null, { default: () => h(SyncOutline) }),
    disabled: !props.repoRoot || props.busyAction !== null,
  },
  {
    key: "pull",
    label: t("sourceControl.pull"),
    icon: () => h(NIcon, null, { default: () => h(ArrowDownOutline) }),
    disabled: !props.repoRoot || props.busyAction !== null,
  },
  {
    key: "push",
    label: t("sourceControl.push"),
    icon: () => h(NIcon, null, { default: () => h(ArrowUpOutline) }),
    disabled: !props.repoRoot || props.busyAction !== null,
  },
  {
    type: "divider",
    key: "divider-remote",
  },
  {
    key: "manage",
    label: t("sourceControl.manageRemotes"),
    icon: () => h(NIcon, null, { default: () => h(SettingsOutline) }),
    disabled: !props.repoRoot || props.busyAction !== null,
  },
]);

function handleRemoteSelect(key: string | number) {
  if (key === "fetch") emit("fetch");
  if (key === "pull") emit("pull");
  if (key === "push") emit("push");
  if (key === "manage") emit("manageRemotes");
}
</script>

<template>
  <div>
    <div class="nexterm-toolbar flex h-8 shrink-0 items-center gap-1 px-2">
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <NButton
          size="tiny"
          quaternary
          data-open-branches
          class="!min-w-0 !px-1"
          :aria-label="t('sourceControl.openBranchesAria')"
          @click="emit('openBranches')"
        >
          <span class="flex min-w-0 items-center gap-1.5">
            <NIcon :component="GitBranchOutline" :size="14" class="shrink-0 text-muted-foreground" />
            <span class="truncate text-[12px] font-semibold">{{ props.branchLabel }}</span>
          </span>
        </NButton>
      </div>
      <NTag v-if="props.changedCount > 0" size="small" round>{{ props.changedCount }}</NTag>
      <NDropdown
        trigger="click"
        placement="bottom-end"
        :options="remoteOptions"
        @select="handleRemoteSelect"
      >
        <NButton
          size="tiny"
          quaternary
          data-git-remote-actions
          :aria-label="t('sourceControl.remoteActions')"
          :loading="props.busyAction === 'fetch' || props.busyAction === 'pull' || props.busyAction === 'push'"
          :disabled="!props.repoRoot"
        >
          <template #icon><NIcon :component="GitNetworkOutline" /></template>
        </NButton>
      </NDropdown>
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
      class="flex h-7 shrink-0 items-center gap-1.5 border-b border-border/40 px-2"
    >
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
