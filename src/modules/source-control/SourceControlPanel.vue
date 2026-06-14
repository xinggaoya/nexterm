<script setup lang="ts">
import { NSpin, useDialog } from "naive-ui";
import { computed, ref, toRef, watch } from "vue";
import {
  native,
  type GitCommitResult,
  type GitDiscardEntry,
  type WorkspaceFsChangedEvent,
} from "@/lib/native";
import { t } from "@/modules/i18n/translate";
import SourceControlChangeList from "./SourceControlChangeList.vue";
import SourceControlCommitBox from "./SourceControlCommitBox.vue";
import SourceControlGitWorkflows from "./SourceControlGitWorkflows.vue";
import SourceControlToolbar from "./SourceControlToolbar.vue";
import type {
  SourceControlFileEntry,
  SourceControlGroupId,
} from "./sourceControlModel";
import {
  discardEntriesForEntries,
  getPrimaryDiffMode,
  pathsToStage,
  pathsToUnstage,
} from "./sourceControlModel";
import type { GitDecorationMap } from "./gitDecorations";
import { useSourceControlActions } from "./useSourceControlActions";
import { useSourceControlGitMetadata } from "./useSourceControlGitMetadata";
import { useSourceControlState } from "./useSourceControlState";

const props = defineProps<{
  rootPath: string | null;
  fsEvent?: WorkspaceFsChangedEvent | null;
}>();

const emit = defineEmits<{
  decorationsChange: [decorations: GitDecorationMap];
  openDiff: [
    input: {
      repoRoot: string;
      path: string;
      mode: "+" | "-";
      originalPath: string | null;
      title: string;
    },
  ];
  openHistory: [input: { repoRoot: string; branch: string | null }];
  committed: [result: GitCommitResult];
}>();

const dialog = useDialog();
const state = useSourceControlState({
  rootPath: toRef(props, "rootPath"),
  fsEvent: toRef(props, "fsEvent"),
  native,
  t,
});
const gitMetadata = useSourceControlGitMetadata({
  repoRoot: state.repoRoot,
  native,
});
const actions = useSourceControlActions({
  state,
  native,
  dialog,
  t,
  emitCommitted: (result) => emit("committed", result),
  refreshGitMetadata: gitMetadata.refreshGitMetadata,
});

const {
  panelState,
  status,
  errorMessage,
  busyAction,
  entries,
  repoRoot,
  branchLabel,
  stagedCount,
  changedCount,
  stageAllPaths,
  unstageAllPaths,
  discardAllEntries,
} = state;
const {
  commitMessage,
  commitInputProps,
  canCommit,
  refresh,
  stageFile,
  unstageFile,
  stagePaths,
  unstagePaths,
  confirmDiscardFile,
  confirmDiscardEntries,
  fetchRemote,
  pullRemote,
  pushRemote,
  checkoutBranch,
  createBranch,
  stashChanges,
  popStash,
  dropStash,
  commit,
  handleCommitKeydown,
} = actions;

const selectedKeys = ref<Set<string>>(new Set());
const selectedEntries = computed(() =>
  entries.value.filter((entry) => selectedKeys.value.has(entry.key)),
);
const effectiveStagePaths = computed(() => {
  const selected = pathsToStage(selectedEntries.value);
  return selected.length > 0 ? selected : stageAllPaths.value;
});
const effectiveUnstagePaths = computed(() => {
  const selected = pathsToUnstage(selectedEntries.value);
  return selected.length > 0 ? selected : unstageAllPaths.value;
});
const effectiveDiscardEntries = computed<GitDiscardEntry[]>(() => {
  const selected = discardEntriesForEntries(selectedEntries.value);
  return selected.length > 0 ? selected : discardAllEntries.value;
});

watch(entries, (next) => {
  const valid = new Set(next.map((entry) => entry.key));
  selectedKeys.value = new Set(
    Array.from(selectedKeys.value).filter((key) => valid.has(key)),
  );
});

watch(
  state.gitDecorations,
  (decorations) => {
    emit("decorationsChange", decorations);
  },
  { immediate: true },
);

function openDiff(entry: SourceControlFileEntry) {
  const root = repoRoot.value;
  if (!root) return;
  emit("openDiff", {
    repoRoot: root,
    path: entry.path,
    mode: getPrimaryDiffMode(entry),
    originalPath: entry.originalPath,
    title: entry.path,
  });
}

function openHistory() {
  const root = repoRoot.value;
  if (!root) return;
  emit("openHistory", {
    repoRoot: root,
    branch: status.value?.branch ?? null,
  });
}

function toggleEntrySelected(entry: SourceControlFileEntry, selected: boolean) {
  const next = new Set(selectedKeys.value);
  if (selected) next.add(entry.key);
  else next.delete(entry.key);
  selectedKeys.value = next;
}

function setGroupSelected(group: SourceControlGroupId, selected: boolean) {
  const next = new Set(selectedKeys.value);
  for (const entry of entries.value.filter((item) => item.group === group)) {
    if (selected) next.add(entry.key);
    else next.delete(entry.key);
  }
  selectedKeys.value = next;
}

async function stageEffective() {
  await stagePaths(effectiveStagePaths.value);
}

async function unstageEffective() {
  await unstagePaths(effectiveUnstagePaths.value);
}

function confirmDiscardEffective() {
  confirmDiscardEntries(effectiveDiscardEntries.value);
}
</script>

<template>
  <aside class="flex h-full w-full min-h-0 flex-col bg-panel-bg text-foreground">
    <SourceControlToolbar
      :branch-label="branchLabel"
      :changed-count="changedCount"
      :repo-root="repoRoot"
      :status="status"
      :busy-action="busyAction"
      @fetch="fetchRemote"
      @pull="pullRemote"
      @push="pushRemote"
      @refresh="refresh"
      @open-history="openHistory"
    />

    <div v-if="panelState === 'no-root'" class="grid min-h-0 flex-1 place-items-center p-4 text-center">
      <div class="text-[12px] text-muted-foreground">
        {{ t("common.noCurrentDirectory") }}
      </div>
    </div>

    <div v-else-if="panelState === 'loading'" class="flex min-h-0 flex-1 items-center justify-center gap-2 text-[12px] text-muted-foreground">
      <NSpin size="small" />
      <span>{{ t("sourceControl.loading") }}</span>
    </div>

    <div v-else-if="panelState === 'error'" class="grid min-h-0 flex-1 place-items-center p-4 text-center">
      <div class="text-[12px] text-destructive">{{ errorMessage }}</div>
    </div>

    <div v-else-if="panelState === 'no-repo'" class="grid min-h-0 flex-1 place-items-center p-4 text-center">
      <div class="text-[12px] text-muted-foreground">
        {{ t("sourceControl.noGitRepository") }}
      </div>
    </div>

    <template v-else>
      <div
        v-if="status?.truncated"
        class="border-b border-border/60 px-2 py-1.5 text-[11px] text-amber-600 dark:text-amber-300"
      >
        {{ t("sourceControl.truncatedStatusHint") }}
      </div>
      <SourceControlGitWorkflows
        :branches="gitMetadata.branches.value"
        :stashes="gitMetadata.stashes.value"
        :loading="gitMetadata.loading.value"
        :busy-action="busyAction"
        :changed-count="changedCount"
        @checkout-branch="checkoutBranch"
        @create-branch="createBranch"
        @stash-save="() => stashChanges(null)"
        @stash-pop="popStash"
        @stash-drop="dropStash"
      />
      <SourceControlChangeList
        :entries="entries"
        :selected-keys="Array.from(selectedKeys)"
        :changed-count="changedCount"
        :stage-all-paths="effectiveStagePaths"
        :unstage-all-paths="effectiveUnstagePaths"
        :discard-all-entries="effectiveDiscardEntries"
        :busy-action="busyAction"
        @open-diff="openDiff"
        @stage-file="stageFile"
        @unstage-file="unstageFile"
        @confirm-discard-file="confirmDiscardFile"
        @toggle-entry-selected="toggleEntrySelected"
        @set-group-selected="setGroupSelected"
        @stage-all="stageEffective"
        @unstage-all="unstageEffective"
        @confirm-discard-all="confirmDiscardEffective"
      />
      <SourceControlCommitBox
        v-model="commitMessage"
        :staged-count="stagedCount"
        :can-commit="canCommit"
        :busy-action="busyAction"
        :input-props="commitInputProps"
        @commit="commit"
        @commit-keydown="handleCommitKeydown"
      />
    </template>
  </aside>
</template>
