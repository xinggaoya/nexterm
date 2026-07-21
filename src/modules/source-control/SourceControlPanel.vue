<script setup lang="ts">
import { NSelect, NSpin, useDialog, type SelectOption } from "naive-ui";
import { computed, h, shallowRef, toRef, watch, type Ref } from "vue";
import {
  native,
  type GitBranchInfo,
  type GitCommitResult,
  type GitDiscardEntry,
  type GitWorkspaceRepo,
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
import { getPrimaryDiffMode } from "./sourceControlModel";
import type { GitDecorationMap } from "./gitDecorations";
import { useGitRepositoryRegistry } from "./useGitRepositoryRegistry";
import { useSourceControlActions } from "./useSourceControlActions";
import { useSourceControlGitMetadata } from "./useSourceControlGitMetadata";
import { useSourceControlState } from "./useSourceControlState";

const props = withDefaults(
  defineProps<{
    rootPath: string | null;
    activeRepoRoot?: string | null;
    workspaceScope?: string;
    fsEvent?: WorkspaceFsChangedEvent | null;
    showBranchesModal?: Ref<boolean>;
  }>(),
  { activeRepoRoot: null, workspaceScope: "local" },
);

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
  openHistory: [
    input: {
      repoRoot: string;
      /** @deprecated Use `refName` + `allRefs` instead. */
      branch: string | null;
      refName: string | null;
      allRefs: boolean;
    },
  ];
  committed: [result: GitCommitResult];
  "repo-selected": [repoRoot: string | null];
}>();

const dialog = useDialog();
const rootPath = toRef(props, "rootPath");
const workspaceScope = toRef(props, "workspaceScope");
const fsEvent = toRef(props, "fsEvent");
const selectedRepoRoot = toRef(props, "activeRepoRoot");
const repositoryRegistry = useGitRepositoryRegistry({
  rootPath,
  workspaceScope,
  fsEvent,
  native,
});
const state = useSourceControlState({
  rootPath,
  repoRoot: selectedRepoRoot,
  fsEvent,
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

const localShowBranchesModal = ref(false);
const showBranchesModal = computed({
  get: () => props.showBranchesModal?.value ?? localShowBranchesModal.value,
  set: (value: boolean) => {
    if (props.showBranchesModal) {
      props.showBranchesModal.value = value;
    } else {
      localShowBranchesModal.value = value;
    }
  },
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
  applyStash,
  commit,
  handleCommitKeydown,
} = actions;

type RepositoryOption = SelectOption & { repository: GitWorkspaceRepo };

const repositoryOptions = computed<RepositoryOption[]>(() =>
  repositoryRegistry.repositories.value.map((repository) => ({
    label: repository.relativePath,
    value: repository.repoRoot,
    repository,
  })),
);

function renderRepositoryLabel(option: SelectOption) {
  const repository = (option as RepositoryOption).repository;
  if (!repository) return String(option.label ?? "");
  return h("div", { class: "flex min-w-0 items-center justify-between gap-2" }, [
    h(
      "span",
      { class: "min-w-0 truncate text-[12px] text-foreground" },
      repository.relativePath,
    ),
    h(
      "span",
      { class: "shrink-0 truncate text-[10px] text-muted-foreground" },
      repository.isDetached ? "detached" : repository.branch,
    ),
  ]);
}

function selectRepository(value: string | number | null) {
  if (typeof value === "string") emit("repo-selected", value);
}

watch(
  [
    repositoryRegistry.repositories,
    repositoryRegistry.loading,
    selectedRepoRoot,
  ],
  ([repositories, loading, selected]) => {
    if (!repositoryRegistry.isCurrentWorkspaceList()) {
      if (!loading && selected !== null) emit("repo-selected", null);
      return;
    }
    if (loading) return;
    const next = repositoryRegistry.isValidRepoRoot(selected)
      ? selected
      : repositories[0]?.repoRoot ?? null;
    if (next !== selected) emit("repo-selected", next);
  },
  { immediate: true },
);

// Selection state. `selectedKeySet` is the live source of truth — the
// child list reads an array view of it for prop stability. The two are
// kept in sync via `syncSelectedKeys` rather than re-deriving, so the
// list never sees a fresh Set on every render.
const selectedKeySet = shallowRef<Set<string>>(new Set());
const selectedKeys = computed(() => Array.from(selectedKeySet.value));

function syncSelectedKeys(next: Set<string>) {
  selectedKeySet.value = next;
}

watch(selectedRepoRoot, () => {
  if (selectedKeySet.value.size > 0) syncSelectedKeys(new Set());
});

const effectiveStagePaths = computed<string[]>(() => {
  const set = selectedKeySet.value;
  if (set.size > 0) {
    const out: string[] = [];
    for (const entry of entries.value) {
      if (entry.group === "changes" && entry.unstaged && set.has(entry.key)) {
        out.push(entry.path);
      }
    }
    if (out.length > 0) return out;
  }
  return stageAllPaths.value;
});

const effectiveUnstagePaths = computed<string[]>(() => {
  const set = selectedKeySet.value;
  if (set.size > 0) {
    const out: string[] = [];
    for (const entry of entries.value) {
      if (entry.group === "staged" && entry.staged && set.has(entry.key)) {
        out.push(entry.path);
      }
    }
    if (out.length > 0) return out;
  }
  return unstageAllPaths.value;
});

const effectiveDiscardEntries = computed<GitDiscardEntry[]>(() => {
  const set = selectedKeySet.value;
  if (set.size > 0) {
    const out: GitDiscardEntry[] = [];
    for (const entry of entries.value) {
      if (
        entry.group === "changes" &&
        entry.unstaged &&
        set.has(entry.key)
      ) {
        out.push({ path: entry.path, untracked: entry.untracked });
      }
    }
    if (out.length > 0) return out;
  }
  return discardAllEntries.value;
});

// Prune stale selection keys when the entry list changes. The previous
// implementation re-allocated the full Set on every change, which
// forced a deep patch on the child list even when nothing meaningful
// changed. We fast-path the common no-op case and only allocate a new
// Set when at least one key is actually dropped.
watch(entries, (next) => {
  const current = selectedKeySet.value;
  if (current.size === 0) return;
  if (next.length === 0) {
    if (current.size > 0) syncSelectedKeys(new Set());
    return;
  }
  let needsUpdate = false;
  for (const key of current) {
    let found = false;
    for (const entry of next) {
      if (entry.key === key) {
        found = true;
        break;
      }
    }
    if (!found) {
      needsUpdate = true;
      break;
    }
  }
  if (!needsUpdate) return;
  const valid = new Set<string>();
  for (const entry of next) valid.add(entry.key);
  const next2 = new Set<string>();
  for (const key of current) if (valid.has(key)) next2.add(key);
  syncSelectedKeys(next2);
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
  const branch = status.value?.branch ?? null;
  emit("openHistory", {
    repoRoot: root,
    branch,
    refName: branch,
    allRefs: false,
  });
}

function toggleEntrySelected(entry: SourceControlFileEntry, selected: boolean) {
  const current = selectedKeySet.value;
  const has = current.has(entry.key);
  if (selected === has) return;
  const next = new Set(current);
  if (selected) next.add(entry.key);
  else next.delete(entry.key);
  syncSelectedKeys(next);
}

function setGroupSelected(group: SourceControlGroupId, selected: boolean) {
  const current = selectedKeySet.value;
  const next = new Set(current);
  let changed = false;
  for (const entry of entries.value) {
    if (entry.group !== group) continue;
    const has = next.has(entry.key);
    if (selected && !has) {
      next.add(entry.key);
      changed = true;
    } else if (!selected && has) {
      next.delete(entry.key);
      changed = true;
    }
  }
  if (changed) syncSelectedKeys(next);
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

async function handleCheckoutBranch(branch: GitBranchInfo) {
  await checkoutBranch(branch);
  if (actions.actionError.value === null) {
    showBranchesModal.value = false;
  }
}
</script>

<template>
  <aside class="flex h-full w-full min-h-0 flex-col bg-transparent text-foreground">
    <div
      v-if="repositoryRegistry.repositories.value.length >= 2"
      class="flex min-w-0 border-b border-border/60 px-2 py-1.5"
    >
      <NSelect
        data-repository-selector
        :aria-label="t('sourceControl.repositorySelector')"
        class="w-full min-w-0 max-w-[280px]"
        size="small"
        :value="activeRepoRoot"
        :options="repositoryOptions"
        :render-label="renderRepositoryLabel"
        :disabled="busyAction !== null"
        @update:value="selectRepository"
      />
    </div>
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
      @open-branches="showBranchesModal = true"
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
      <SourceControlGitWorkflows
        v-if="showBranchesModal"
        :show="showBranchesModal"
        :branches="gitMetadata.branches.value"
        :stashes="gitMetadata.stashes.value"
        :loading="gitMetadata.loading.value"
        :busy-action="busyAction"
        :changed-count="changedCount"
        @close="showBranchesModal = false"
        @checkout-branch="handleCheckoutBranch"
        @create-branch="createBranch"
        @stash-save="stashChanges"
        @stash-pop="({ selector, fullSha }) => popStash(selector, fullSha)"
        @stash-drop="({ selector, fullSha }) => dropStash(selector, fullSha)"
        @stash-apply="({ selector, fullSha }) => applyStash(selector, fullSha)"
      />
    </template>
  </aside>
</template>
