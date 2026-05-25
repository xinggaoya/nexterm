<script setup lang="ts">
import { computed, ref, type InputHTMLAttributes } from "vue";
import { AddOutline, GitBranchOutline, LayersOutline } from "@vicons/ionicons5";
import { NButton, NIcon, NInput, NSpin, NTag } from "naive-ui";
import TooltipTitle from "@/components/TooltipTitle.vue";
import type { GitBranchInfo, GitStashEntry } from "@/lib/native";
import { t } from "@/modules/i18n/translate";
import type { BusyAction } from "./useSourceControlState";

const props = defineProps<{
  branches: GitBranchInfo[];
  stashes: GitStashEntry[];
  loading: boolean;
  busyAction: BusyAction | null;
  changedCount: number;
}>();

const emit = defineEmits<{
  checkoutBranch: [branch: GitBranchInfo];
  createBranch: [branch: string];
  stashSave: [];
  stashPop: [selector: string];
  stashDrop: [selector: string];
}>();

const showCreate = ref(false);
const branchName = ref("");
const branchInputProps = {
  "data-git-create-branch-input": "",
} as unknown as InputHTMLAttributes;

const localBranches = computed(() => props.branches.filter((branch) => !branch.isRemote));
const remoteBranches = computed(() => props.branches.filter((branch) => branch.isRemote));
const busy = computed(() => props.busyAction !== null);

function submitBranch() {
  const value = branchName.value.trim();
  if (!value) return;
  emit("createBranch", value);
  branchName.value = "";
  showCreate.value = false;
}
</script>

<template>
  <div class="shrink-0 border-b border-border/60 px-2 py-2">
    <div class="mb-1.5 flex items-center gap-2">
      <div class="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <NIcon :component="GitBranchOutline" :size="13" />
        <span>{{ t("sourceControl.branches") }}</span>
        <NSpin v-if="props.loading" size="small" />
      </div>
      <TooltipTitle :label="t('sourceControl.newBranch')">
        <NButton
          size="tiny"
          quaternary
          data-git-create-branch-toggle
          :disabled="busy"
          @click="showCreate = !showCreate"
        >
          <template #icon><NIcon :component="AddOutline" /></template>
        </NButton>
      </TooltipTitle>
    </div>

    <div v-if="showCreate" class="mb-2 flex gap-1">
      <NInput
        v-model:value="branchName"
        size="tiny"
        :input-props="branchInputProps"
        :placeholder="t('sourceControl.branchName')"
        @keydown.enter.prevent="submitBranch"
      />
      <NButton
        size="tiny"
        type="primary"
        data-git-create-branch-submit
        :disabled="!branchName.trim() || busy"
        @click="submitBranch"
      >
        {{ t("common.create") }}
      </NButton>
    </div>

    <div class="flex gap-1 overflow-x-auto pb-1">
      <NButton
        v-for="branch in localBranches"
        :key="branch.name"
        size="tiny"
        :type="branch.isCurrent ? 'primary' : 'default'"
        :secondary="branch.isCurrent"
        :quaternary="!branch.isCurrent"
        :disabled="busy || branch.isCurrent"
        :data-git-branch="branch.name"
        @click="emit('checkoutBranch', branch)"
      >
        {{ branch.name }}
      </NButton>
      <NButton
        v-for="branch in remoteBranches"
        :key="branch.name"
        size="tiny"
        quaternary
        :disabled="busy"
        :data-git-branch="branch.name"
        @click="emit('checkoutBranch', branch)"
      >
        {{ branch.name }}
      </NButton>
    </div>

    <div class="mt-2 flex items-center gap-2">
      <div class="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <NIcon :component="LayersOutline" :size="13" />
        <span>{{ t("sourceControl.stashes") }}</span>
        <NTag v-if="props.stashes.length" size="small" round>{{ props.stashes.length }}</NTag>
      </div>
      <NButton
        size="tiny"
        data-git-stash-save
        :disabled="busy || props.changedCount === 0"
        @click="emit('stashSave')"
      >
        {{ t("sourceControl.stashSave") }}
      </NButton>
    </div>

    <div v-if="props.stashes.length" class="mt-1 space-y-1">
      <div
        v-for="stash in props.stashes"
        :key="stash.selector"
        class="flex items-center gap-1 rounded-md bg-muted/35 px-1.5 py-1"
      >
        <div class="min-w-0 flex-1">
          <div class="truncate text-[11px]">{{ stash.message }}</div>
          <div class="truncate font-mono text-[10px] text-muted-foreground">
            {{ stash.selector }} · {{ stash.relativeTime }}
          </div>
        </div>
        <NButton
          size="tiny"
          quaternary
          :disabled="busy"
          :data-git-stash-pop="stash.selector"
          @click="emit('stashPop', stash.selector)"
        >
          {{ t("sourceControl.stashPop") }}
        </NButton>
        <NButton
          size="tiny"
          quaternary
          type="error"
          :disabled="busy"
          :data-git-stash-drop="stash.selector"
          @click="emit('stashDrop', stash.selector)"
        >
          {{ t("sourceControl.stashDrop") }}
        </NButton>
      </div>
    </div>
  </div>
</template>
