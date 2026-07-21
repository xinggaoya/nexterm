<script setup lang="ts">
import { computed, nextTick, ref, watch, type InputHTMLAttributes } from "vue";
import { GitBranchOutline, LayersOutline, SearchOutline } from "@vicons/ionicons5";
import {
  NButton,
  NCheckbox,
  NIcon,
  NInput,
  NModal,
  NSpin,
  NTag,
} from "naive-ui";
import type { InputInst } from "naive-ui";
import type { GitBranchInfo, GitStashEntry, GitStashPushOptions } from "@/lib/native";
import { t } from "@/modules/i18n/translate";
import type { BusyAction } from "./useSourceControlState";

const props = defineProps<{
  show: boolean;
  branches: GitBranchInfo[];
  stashes: GitStashEntry[];
  loading: boolean;
  busyAction: BusyAction | null;
  changedCount: number;
}>();

const emit = defineEmits<{
  close: [];
  checkoutBranch: [branch: GitBranchInfo];
  createBranch: [branch: string];
  stashSave: [options: GitStashPushOptions];
  stashApply: [input: { selector: string; fullSha: string }];
  stashPop: [input: { selector: string; fullSha: string }];
  stashDrop: [input: { selector: string; fullSha: string }];
}>();

const branchName = ref("");
const branchSearch = ref("");
const branchSearchRef = ref<InputInst | null>(null);
const showStashComposer = ref(false);
const stashMessage = ref("");
const stashIncludeUntracked = ref(true);
const stashKeepIndex = ref(false);
const branchInputProps = {
  "data-git-create-branch-input": "",
} as unknown as InputHTMLAttributes;
const branchSearchInputProps = {
  "data-git-branch-search": "",
} as unknown as InputHTMLAttributes;
const stashMessageInputProps = {
  "data-git-stash-message": "",
} as unknown as InputHTMLAttributes;

const busy = computed(() => props.busyAction !== null);
const currentBranch = computed(() =>
  props.branches.find((branch) => branch.isCurrent) ?? null,
);

function matchesBranch(branch: GitBranchInfo): boolean {
  const query = branchSearch.value.trim().toLowerCase();
  if (!query) return true;
  return [branch.name, branch.fullRef ?? "", branch.lastCommitSubject ?? ""].some(
    (value) => value.toLowerCase().includes(query),
  );
}

const localBranches = computed(() =>
  props.branches.filter(
    (branch) => !branch.isRemote && !branch.isCurrent && matchesBranch(branch),
  ),
);
const remoteBranches = computed(() =>
  props.branches.filter((branch) => branch.isRemote && matchesBranch(branch)),
);

function branchTitle(branch: GitBranchInfo): string {
  return branch.fullRef ?? branch.name;
}

function stashSha(stash: GitStashEntry): string {
  return stash.fullSha ?? stash.shortSha;
}

function submitBranch() {
  const value = branchName.value.trim();
  if (!value) return;
  emit("createBranch", value);
  branchName.value = "";
}

function openStashComposer() {
  stashMessage.value = "";
  stashIncludeUntracked.value = true;
  stashKeepIndex.value = false;
  showStashComposer.value = true;
}

function closeStashComposer() {
  showStashComposer.value = false;
}

function submitStash() {
  emit("stashSave", {
    message: stashMessage.value.trim() || null,
    includeUntracked: stashIncludeUntracked.value,
    keepIndex: stashKeepIndex.value,
  });
  closeStashComposer();
}

function handleUpdateShow(show: boolean) {
  if (show) return;
  branchName.value = "";
  stashMessage.value = "";
  closeStashComposer();
  emit("close");
}

function focusBranchSearch() {
  void nextTick(() => branchSearchRef.value?.focus());
}

watch(
  () => props.show,
  (show) => {
    if (show) focusBranchSearch();
  },
);
</script>

<template>
  <NModal
    :show="props.show"
    preset="card"
    :bordered="false"
    :mask-closable="true"
    class="max-w-[520px]"
    @update:show="handleUpdateShow"
    @after-enter="focusBranchSearch"
  >
    <template #header>
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <NIcon :component="GitBranchOutline" :size="16" class="shrink-0 text-muted-foreground" />
        <span class="truncate text-sm font-medium">{{ t("sourceControl.branches") }}</span>
        <NSpin v-if="props.loading" size="small" />
        <div class="ml-auto flex min-w-0 gap-2">
          <NInput
            v-model:value="branchName"
            class="min-w-0 w-44"
            size="small"
            :input-props="branchInputProps"
            :placeholder="t('sourceControl.branchName')"
            @keydown.enter.prevent="submitBranch"
          />
          <NButton
            size="small"
            type="primary"
            data-git-create-branch-submit
            :disabled="!branchName.trim() || busy"
            @click="submitBranch"
          >
            {{ t("common.create") }}
          </NButton>
        </div>
      </div>
    </template>

    <div class="space-y-4">
      <section class="space-y-2">
        <div class="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
          <NIcon :component="GitBranchOutline" :size="13" />
          <span>{{ t("sourceControl.branches") }}</span>
        </div>
        <NInput
          ref="branchSearchRef"
          v-model:value="branchSearch"
          class="min-w-0"
          size="small"
          clearable
          :input-props="branchSearchInputProps"
          :placeholder="t('sourceControl.branchSearch')"
        >
          <template #prefix><NIcon :component="SearchOutline" /></template>
        </NInput>

        <div class="max-h-72 min-w-0 space-y-2 overflow-y-auto overscroll-contain">
          <section v-if="currentBranch" data-git-branch-group="current" class="min-w-0">
        <div class="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {{ t("sourceControl.branchCurrent") }}
        </div>
        <div class="flex min-w-0 items-center gap-2">
          <NButton
            class="min-w-0 flex-1 justify-start"
            size="small"
            type="primary"
            secondary
            :disabled="true"
            :title="branchTitle(currentBranch)"
            :data-git-branch="currentBranch.name"
          >
            <span class="min-w-0 flex-1 truncate text-left" :title="branchTitle(currentBranch)">
              {{ currentBranch.name }}
            </span>
          </NButton>
        </div>
      </section>

          <section v-if="localBranches.length" data-git-branch-group="local" class="min-w-0">
        <div class="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {{ t("sourceControl.branchLocal") }}
        </div>
        <div class="space-y-0.5">
          <div
            v-for="branch in localBranches"
            :key="branch.name"
            class="flex min-w-0 items-center gap-2"
          >
            <NButton
              class="min-w-0 flex-1 justify-start"
              size="small"
              quaternary
              :disabled="busy"
              :title="branchTitle(branch)"
              :data-git-branch="branch.name"
              @click="emit('checkoutBranch', branch)"
            >
              <span class="min-w-0 flex-1 text-left">
                <span class="block min-w-0 truncate" :title="branchTitle(branch)">
                  {{ branch.name }}
                </span>
                <span
                  v-if="branch.lastCommitSubject?.trim()"
                  data-git-branch-subject
                  class="block min-w-0 truncate text-[10.5px] text-muted-foreground"
                  :title="branch.lastCommitSubject"
                >
                  {{ branch.lastCommitSubject }}
                </span>
              </span>
              <NTag v-if="branch.ahead" size="tiny" :title="t('sourceControl.branchAhead', { count: branch.ahead })">
                {{ t("sourceControl.branchAhead", { count: branch.ahead }) }}
              </NTag>
              <NTag v-if="branch.behind" size="tiny" :title="t('sourceControl.branchBehind', { count: branch.behind })">
                {{ t("sourceControl.branchBehind", { count: branch.behind }) }}
              </NTag>
            </NButton>
          </div>
        </div>
      </section>

          <section v-if="remoteBranches.length" data-git-branch-group="remote" class="min-w-0">
        <div class="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {{ t("sourceControl.branchRemote") }}
        </div>
        <div class="space-y-0.5">
          <div
            v-for="branch in remoteBranches"
            :key="branch.name"
            class="flex min-w-0 items-center gap-2"
          >
            <NButton
              class="min-w-0 flex-1 justify-start"
              size="small"
              quaternary
              :disabled="busy"
              :title="branchTitle(branch)"
              :data-git-branch="branch.name"
              @click="emit('checkoutBranch', branch)"
            >
              <span class="min-w-0 flex-1 text-left">
                <span class="block min-w-0 truncate" :title="branchTitle(branch)">
                  {{ branch.name }}
                </span>
                <span
                  v-if="branch.lastCommitSubject?.trim()"
                  data-git-branch-subject
                  class="block min-w-0 truncate text-[10.5px] text-muted-foreground"
                  :title="branch.lastCommitSubject"
                >
                  {{ branch.lastCommitSubject }}
                </span>
              </span>
              <NTag v-if="branch.ahead" size="tiny" :title="t('sourceControl.branchAhead', { count: branch.ahead })">
                {{ t("sourceControl.branchAhead", { count: branch.ahead }) }}
              </NTag>
              <NTag v-if="branch.behind" size="tiny" :title="t('sourceControl.branchBehind', { count: branch.behind })">
                {{ t("sourceControl.branchBehind", { count: branch.behind }) }}
              </NTag>
            </NButton>
          </div>
        </div>
          </section>

          <div
        v-if="!localBranches.length && !remoteBranches.length"
        class="px-1 text-[11px] text-muted-foreground"
      >
        {{ t("sourceControl.branchSearchEmpty") }}
          </div>
        </div>
      </section>

      <section class="space-y-2">
        <div class="flex min-w-0 items-center gap-2">
          <div class="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <NIcon :component="LayersOutline" :size="13" />
            <span class="min-w-0 truncate">{{ t("sourceControl.stashes") }}</span>
            <NTag v-if="props.stashes.length" size="small" round>{{ props.stashes.length }}</NTag>
          </div>
          <NButton
            size="tiny"
            class="shrink-0"
            data-git-stash-save
            :disabled="busy || props.changedCount === 0"
            @click="openStashComposer"
          >
            {{ t("sourceControl.stashSave") }}
          </NButton>
        </div>

        <div v-if="props.stashes.length" class="min-w-0 space-y-1">
          <div
        v-for="stash in props.stashes"
        :key="stash.selector"
        class="flex min-w-0 flex-wrap items-center gap-1 rounded-md bg-muted/35 px-1.5 py-1"
      >
        <div class="min-w-0 flex-1 basis-32">
          <div class="truncate text-[11px]" :title="stash.message">{{ stash.message }}</div>
          <div class="truncate font-mono text-[10px] text-muted-foreground" :title="stash.fullSha ?? stash.shortSha">
            {{ stash.selector }} · {{ stash.relativeTime }}
          </div>
        </div>
        <NButton
          size="tiny"
          class="shrink-0"
          quaternary
          :disabled="busy"
          :data-git-stash-apply="stash.selector"
          @click="emit('stashApply', { selector: stash.selector, fullSha: stashSha(stash) })"
        >
          {{ t("sourceControl.stashApply") }}
        </NButton>
        <NButton
          size="tiny"
          class="shrink-0"
          quaternary
          :disabled="busy"
          :data-git-stash-pop="stash.selector"
          @click="emit('stashPop', { selector: stash.selector, fullSha: stashSha(stash) })"
        >
          {{ t("sourceControl.stashPop") }}
        </NButton>
        <NButton
          size="tiny"
          class="shrink-0"
          quaternary
          type="error"
          :disabled="busy"
          :data-git-stash-drop="stash.selector"
          @click="emit('stashDrop', { selector: stash.selector, fullSha: stashSha(stash) })"
        >
          {{ t("sourceControl.stashDrop") }}
        </NButton>
          </div>
        </div>
      </section>
    </div>

    <NModal
      :show="showStashComposer"
      preset="card"
      :title="t('sourceControl.stashSaveTitle')"
      :bordered="false"
      :mask-closable="true"
      class="max-w-[420px]"
      @update:show="(show) => { if (!show) closeStashComposer(); }"
    >
      <div v-if="showStashComposer" data-git-stash-modal="true" class="space-y-3">
        <NInput
          v-model:value="stashMessage"
          :input-props="stashMessageInputProps"
          :placeholder="t('sourceControl.stashMessage')"
        />
        <div class="space-y-2">
          <NCheckbox
            v-model:checked="stashIncludeUntracked"
            data-git-stash-include-untracked
          >
            {{ t("sourceControl.stashIncludeUntracked") }}
          </NCheckbox>
          <NCheckbox v-model:checked="stashKeepIndex" data-git-stash-keep-index>
            {{ t("sourceControl.stashKeepIndex") }}
          </NCheckbox>
        </div>
        <div class="flex justify-end gap-2">
          <NButton size="small" data-git-stash-cancel @click="closeStashComposer">
            {{ t("common.cancel") }}
          </NButton>
          <NButton size="small" type="primary" data-git-stash-submit @click="submitStash">
            {{ t("sourceControl.stashSave") }}
          </NButton>
        </div>
      </div>
    </NModal>
  </NModal>
</template>
