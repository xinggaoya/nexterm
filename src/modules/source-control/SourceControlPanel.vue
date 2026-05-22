<script setup lang="ts">
import {
  AddOutline,
  ArrowDownOutline,
  ArrowUpOutline,
  CheckmarkCircleOutline,
  DocumentOutline,
  GitBranchOutline,
  RefreshOutline,
  RemoveOutline,
  SyncOutline,
  TimeOutline,
  TrashOutline,
} from "@vicons/ionicons5";
import { NButton, NIcon, NInput, NSpin, NTag, useDialog } from "naive-ui";
import { computed, onBeforeUnmount, ref, watch, type TextareaHTMLAttributes } from "vue";
import {
  native,
  type GitCommitResult,
  type GitRepoInfo,
  type GitStatusSnapshot,
  type WorkspaceFsChangedEvent,
} from "@/lib/native";
import {
  buildSourceControlEntries,
  discardEntriesForEntries,
  getPrimaryDiffMode,
  pathsToStage,
  pathsToUnstage,
  type SourceControlFileEntry,
} from "./sourceControlModel";
import { t } from "@/modules/i18n/translate";

type PanelState = "idle" | "loading" | "no-root" | "no-repo" | "ready" | "error";
type BusyAction =
  | "refresh"
  | "commit"
  | "stage-all"
  | "unstage-all"
  | "discard-all"
  | "fetch"
  | "pull"
  | "push"
  | `stage:${string}`
  | `unstage:${string}`
  | `discard:${string}`;

const props = defineProps<{
  rootPath: string | null;
  fsEvent?: WorkspaceFsChangedEvent | null;
}>();

const emit = defineEmits<{
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

const panelState = ref<PanelState>("idle");
const repo = ref<GitRepoInfo | null>(null);
const status = ref<GitStatusSnapshot | null>(null);
const errorMessage = ref<string | null>(null);
const actionMessage = ref<string | null>(null);
const actionError = ref<string | null>(null);
const busyAction = ref<BusyAction | null>(null);
const commitMessage = ref("");
const requestId = ref(0);
const pendingAutoRefresh = ref(false);
const dialog = useDialog();
const commitInputProps = {
  "data-commit-message": "",
} as unknown as TextareaHTMLAttributes;
let autoRefreshTimer: ReturnType<typeof setTimeout> | null = null;

const entries = computed(() =>
  buildSourceControlEntries(status.value?.changedFiles ?? []),
);
const repoRoot = computed(() => status.value?.repoRoot ?? repo.value?.repoRoot ?? null);
const branchLabel = computed(() => {
  const current = status.value ?? repo.value;
  if (!current) return t("app.header.sourceControl");
  return current.isDetached ? "detached" : current.branch;
});
const stagedCount = computed(
  () => entries.value.filter((entry) => entry.staged).length,
);
const changedCount = computed(() => entries.value.length);
const stageAllPaths = computed(() => pathsToStage(entries.value));
const unstageAllPaths = computed(() => pathsToUnstage(entries.value));
const discardAllEntries = computed(() => discardEntriesForEntries(entries.value));
const canCommit = computed(
  () =>
    !!repoRoot.value &&
    stagedCount.value > 0 &&
    commitMessage.value.trim().length > 0 &&
    busyAction.value === null,
);

function normalizeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return t("sourceControl.unknownError");
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isSameRoot(a: string | null, b: string | null): boolean {
  return !!a && !!b && normalizePath(a) === normalizePath(b);
}

function statusTone(code: string): "default" | "success" | "warning" | "error" | "info" {
  switch (code) {
    case "A":
      return "success";
    case "M":
      return "warning";
    case "D":
      return "error";
    case "R":
      return "info";
    default:
      return "default";
  }
}

function stageLabel(entry: SourceControlFileEntry): string {
  if (entry.checkState === "checked") return t("sourceControl.staged");
  if (entry.checkState === "indeterminate") return t("sourceControl.mixed");
  return t("sourceControl.unstaged");
}

function resetActionFeedback() {
  actionMessage.value = null;
  actionError.value = null;
}

function pushedLabel(remote: string | null, branch: string | null): string {
  if (remote && branch) return `${remote}/${branch}`;
  if (branch) return branch;
  return remote ?? "upstream";
}

async function loadSnapshot(rootPath: string | null) {
  const currentId = ++requestId.value;
  actionMessage.value = null;
  actionError.value = null;

  if (!rootPath) {
    panelState.value = "no-root";
    repo.value = null;
    status.value = null;
    errorMessage.value = null;
    return;
  }

  panelState.value = "loading";
  errorMessage.value = null;
  try {
    await native.workspaceAuthorize(rootPath);
    if (currentId !== requestId.value) return;
    const snapshot = await native.gitPanelSnapshot(rootPath);
    if (currentId !== requestId.value) return;
    repo.value = snapshot.repo;
    status.value = snapshot.status;
    panelState.value = snapshot.repo && snapshot.status ? "ready" : "no-repo";
  } catch (error) {
    if (currentId !== requestId.value) return;
    repo.value = null;
    status.value = null;
    errorMessage.value = normalizeError(error);
    panelState.value = "error";
  }
}

async function refreshStatus() {
  const root = repoRoot.value;
  if (!root) {
    await loadSnapshot(props.rootPath);
    return;
  }
  try {
    const next = await native.gitStatus(root);
    status.value = next;
    repo.value = {
      repoRoot: next.repoRoot,
      branch: next.branch,
      upstream: next.upstream,
      isDetached: next.isDetached,
    };
    panelState.value = "ready";
  } catch (error) {
    actionError.value = normalizeError(error);
  }
}

async function refresh() {
  if (busyAction.value) return;
  busyAction.value = "refresh";
  resetActionFeedback();
  try {
    await refreshStatus();
  } finally {
    busyAction.value = null;
  }
}

async function autoRefresh() {
  if (busyAction.value) {
    pendingAutoRefresh.value = true;
    return;
  }
  if (repoRoot.value) {
    await refreshStatus();
  } else {
    await loadSnapshot(props.rootPath);
  }
}

function scheduleAutoRefresh(delay = 260) {
  if (!props.rootPath) return;
  if (autoRefreshTimer) clearTimeout(autoRefreshTimer);
  autoRefreshTimer = setTimeout(() => {
    autoRefreshTimer = null;
    void autoRefresh();
  }, delay);
}

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
    branch: status.value?.branch ?? repo.value?.branch ?? null,
  });
}

async function stageFile(entry: SourceControlFileEntry) {
  const root = repoRoot.value;
  if (!root || busyAction.value) return;
  busyAction.value = `stage:${entry.path}`;
  resetActionFeedback();
  try {
    await native.gitStage(root, [entry.path]);
    await refreshStatus();
  } catch (error) {
    actionError.value = normalizeError(error);
  } finally {
    busyAction.value = null;
  }
}

async function unstageFile(entry: SourceControlFileEntry) {
  const root = repoRoot.value;
  if (!root || busyAction.value) return;
  busyAction.value = `unstage:${entry.path}`;
  resetActionFeedback();
  try {
    await native.gitUnstage(root, [entry.path]);
    await refreshStatus();
  } catch (error) {
    actionError.value = normalizeError(error);
  } finally {
    busyAction.value = null;
  }
}

async function stageAll() {
  const root = repoRoot.value;
  const paths = stageAllPaths.value;
  if (!root || paths.length === 0 || busyAction.value) return;
  busyAction.value = "stage-all";
  resetActionFeedback();
  try {
    await native.gitStage(root, paths);
    await refreshStatus();
  } catch (error) {
    actionError.value = normalizeError(error);
  } finally {
    busyAction.value = null;
  }
}

async function unstageAll() {
  const root = repoRoot.value;
  const paths = unstageAllPaths.value;
  if (!root || paths.length === 0 || busyAction.value) return;
  busyAction.value = "unstage-all";
  resetActionFeedback();
  try {
    await native.gitUnstage(root, paths);
    await refreshStatus();
  } catch (error) {
    actionError.value = normalizeError(error);
  } finally {
    busyAction.value = null;
  }
}

async function discardEntries(
  entriesToDiscard: { path: string; untracked: boolean }[],
  busy: BusyAction,
) {
  const root = repoRoot.value;
  if (!root || entriesToDiscard.length === 0 || busyAction.value) return;
  busyAction.value = busy;
  resetActionFeedback();
  try {
    await native.gitDiscard(root, entriesToDiscard);
    await refreshStatus();
  } catch (error) {
    actionError.value = normalizeError(error);
  } finally {
    busyAction.value = null;
  }
}

function confirmDiscardFile(entry: SourceControlFileEntry) {
  if (!entry.unstaged || busyAction.value) return;
  dialog.warning({
    title: t("sourceControl.discardTitle"),
    content: t("sourceControl.discardFileContent", { path: entry.path }),
    positiveText: t("sourceControl.discard"),
    negativeText: t("common.cancel"),
    onPositiveClick: () =>
      discardEntries(
        [{ path: entry.path, untracked: entry.untracked }],
        `discard:${entry.path}`,
      ),
  });
}

function confirmDiscardAll() {
  const discardEntriesValue = discardAllEntries.value;
  if (discardEntriesValue.length === 0 || busyAction.value) return;
  dialog.warning({
    title: t("sourceControl.discardTitle"),
    content: t("sourceControl.discardManyContent", {
      count: discardEntriesValue.length,
      changeWord: discardEntriesValue.length === 1 ? "change" : "changes",
    }),
    positiveText: t("sourceControl.discard"),
    negativeText: t("common.cancel"),
    onPositiveClick: () => discardEntries(discardEntriesValue, "discard-all"),
  });
}

async function fetchRemote() {
  const root = repoRoot.value;
  if (!root || busyAction.value) return;
  busyAction.value = "fetch";
  resetActionFeedback();
  try {
    await native.gitFetch(root);
    actionMessage.value = t("sourceControl.fetchedLatestRefs");
    await refreshStatus();
  } catch (error) {
    actionError.value = normalizeError(error);
  } finally {
    busyAction.value = null;
  }
}

async function pullRemote() {
  const root = repoRoot.value;
  if (!root || busyAction.value) return;
  busyAction.value = "pull";
  resetActionFeedback();
  try {
    await native.gitPullFfOnly(root);
    actionMessage.value = t("sourceControl.pulledLatestChanges");
    await refreshStatus();
  } catch (error) {
    actionError.value = normalizeError(error);
  } finally {
    busyAction.value = null;
  }
}

async function pushRemote() {
  const root = repoRoot.value;
  if (!root || busyAction.value) return;
  busyAction.value = "push";
  resetActionFeedback();
  try {
    const result = await native.gitPush(root);
    actionMessage.value = t("sourceControl.pushedTo", {
      target: pushedLabel(result.remote, result.branch),
    });
    await refreshStatus();
  } catch (error) {
    actionError.value = normalizeError(error);
  } finally {
    busyAction.value = null;
  }
}

async function commit() {
  const root = repoRoot.value;
  const message = commitMessage.value.trim();
  if (!root || !message || busyAction.value) return;
  busyAction.value = "commit";
  resetActionFeedback();
  try {
    const result = await native.gitCommit(root, message);
    commitMessage.value = "";
    actionMessage.value = result.summary;
    emit("committed", result);
    await refreshStatus();
  } catch (error) {
    actionError.value = normalizeError(error);
  } finally {
    busyAction.value = null;
  }
}

function handleCommitKeydown(event: KeyboardEvent) {
  if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
  event.preventDefault();
  void commit();
}

watch(
  () => props.rootPath,
  (rootPath) => {
    void loadSnapshot(rootPath);
  },
  { immediate: true },
);

watch(
  () => props.fsEvent,
  (event) => {
    if (!event || !isSameRoot(event.rootPath, props.rootPath)) return;
    scheduleAutoRefresh();
  },
);

watch(busyAction, (value) => {
  if (value || !pendingAutoRefresh.value) return;
  pendingAutoRefresh.value = false;
  scheduleAutoRefresh(80);
});

onBeforeUnmount(() => {
  if (autoRefreshTimer) clearTimeout(autoRefreshTimer);
});
</script>

<template>
  <aside class="flex h-full w-full min-h-0 flex-col bg-card text-foreground">
    <div class="flex h-9 shrink-0 items-center gap-1 border-b border-border/60 px-2">
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <NIcon :component="GitBranchOutline" :size="14" class="shrink-0 text-muted-foreground" />
        <span class="truncate text-[12px] font-semibold">{{ branchLabel }}</span>
      </div>
      <NTag v-if="changedCount > 0" size="small" round>{{ changedCount }}</NTag>
      <NButton
        size="tiny"
        quaternary
        data-git-fetch
        :title="t('sourceControl.fetch')"
        :aria-label="t('sourceControl.fetch')"
        :loading="busyAction === 'fetch'"
        :disabled="!repoRoot || (busyAction !== null && busyAction !== 'fetch')"
        @click="fetchRemote"
      >
        <template #icon><NIcon :component="SyncOutline" /></template>
      </NButton>
      <NButton
        size="tiny"
        quaternary
        data-git-pull
        :title="t('sourceControl.pull')"
        :aria-label="t('sourceControl.pull')"
        :loading="busyAction === 'pull'"
        :disabled="!repoRoot || (busyAction !== null && busyAction !== 'pull')"
        @click="pullRemote"
      >
        <template #icon><NIcon :component="ArrowDownOutline" /></template>
      </NButton>
      <NButton
        size="tiny"
        quaternary
        data-git-push
        :title="t('sourceControl.push')"
        :aria-label="t('sourceControl.push')"
        :loading="busyAction === 'push'"
        :disabled="!repoRoot || (busyAction !== null && busyAction !== 'push')"
        @click="pushRemote"
      >
        <template #icon><NIcon :component="ArrowUpOutline" /></template>
      </NButton>
      <NButton
        size="tiny"
        quaternary
        :title="t('common.refresh')"
        :aria-label="t('common.refresh')"
        :loading="busyAction === 'refresh'"
        @click="refresh"
      >
        <template #icon><NIcon :component="RefreshOutline" /></template>
      </NButton>
      <NButton
        size="tiny"
        quaternary
        data-open-history
        :title="t('common.history')"
        :aria-label="t('common.history')"
        :disabled="!repoRoot"
        @click="openHistory"
      >
        <template #icon><NIcon :component="TimeOutline" /></template>
      </NButton>
    </div>

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
      <div class="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-2 py-2">
        <NTag size="small" round type="info">{{ branchLabel }}</NTag>
        <NTag v-if="status?.upstream" size="small" round>{{ status.upstream }}</NTag>
        <span class="min-w-0 flex-1 truncate text-right text-[11px] text-muted-foreground">
          <template v-if="status && (status.ahead > 0 || status.behind > 0)">
            ↑{{ status.ahead }} ↓{{ status.behind }}
          </template>
          <template v-else>{{ t("sourceControl.cleanRemoteState") }}</template>
        </span>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto py-1">
        <div v-if="entries.length === 0" class="grid h-full place-items-center p-4 text-center">
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
              {{ t("sourceControl.changes") }} · {{ changedCount }}
            </div>
            <NButton
              size="tiny"
              quaternary
              data-stage-all
              :title="t('sourceControl.stageAll')"
              :aria-label="t('sourceControl.stageAll')"
              :loading="busyAction === 'stage-all'"
              :disabled="stageAllPaths.length === 0 || (busyAction !== null && busyAction !== 'stage-all')"
              @click="stageAll"
            >
              <template #icon><NIcon :component="AddOutline" /></template>
            </NButton>
            <NButton
              size="tiny"
              quaternary
              data-unstage-all
              :title="t('sourceControl.unstageAll')"
              :aria-label="t('sourceControl.unstageAll')"
              :loading="busyAction === 'unstage-all'"
              :disabled="unstageAllPaths.length === 0 || (busyAction !== null && busyAction !== 'unstage-all')"
              @click="unstageAll"
            >
              <template #icon><NIcon :component="RemoveOutline" /></template>
            </NButton>
            <NButton
              size="tiny"
              quaternary
              data-discard-all
              :title="t('sourceControl.discardAllUnstaged')"
              :aria-label="t('sourceControl.discardAllUnstaged')"
              :loading="busyAction === 'discard-all'"
              :disabled="discardAllEntries.length === 0 || (busyAction !== null && busyAction !== 'discard-all')"
              @click="confirmDiscardAll"
            >
              <template #icon><NIcon :component="TrashOutline" /></template>
            </NButton>
          </div>
          <div
            v-for="entry in entries"
            :key="entry.key"
            class="group flex h-8 min-w-0 items-center gap-1 rounded-md px-1 transition-colors hover:bg-muted/80"
          >
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px]"
              :data-source-file="entry.path"
              @click="openDiff(entry)"
            >
              <NIcon :component="DocumentOutline" :size="14" class="shrink-0 text-muted-foreground" />
              <span class="min-w-0 flex-1 truncate">{{ entry.path }}</span>
              <NTag size="small" :type="statusTone(entry.statusCode)">
                {{ entry.statusCode }}
              </NTag>
              <span class="w-14 shrink-0 text-right text-[10px] text-muted-foreground">
                {{ stageLabel(entry) }}
              </span>
            </button>
            <NButton
              v-if="entry.unstaged"
              size="tiny"
              quaternary
              type="error"
              :data-discard-file="entry.path"
              :title="t('sourceControl.discardChanges')"
              :aria-label="t('sourceControl.discardChanges')"
              :loading="busyAction === `discard:${entry.path}`"
              :disabled="busyAction !== null && busyAction !== `discard:${entry.path}`"
              @click.stop="confirmDiscardFile(entry)"
            >
              <template #icon><NIcon :component="TrashOutline" /></template>
            </NButton>
            <NButton
              v-if="entry.checkState === 'checked'"
              size="tiny"
              quaternary
              :data-unstage-file="entry.path"
              :title="t('sourceControl.unstage')"
              :aria-label="t('sourceControl.unstage')"
              :loading="busyAction === `unstage:${entry.path}`"
              :disabled="busyAction !== null && busyAction !== `unstage:${entry.path}`"
              @click.stop="unstageFile(entry)"
            >
              <template #icon><NIcon :component="RemoveOutline" /></template>
            </NButton>
            <NButton
              v-else
              size="tiny"
              quaternary
              :data-stage-file="entry.path"
              :title="t('sourceControl.stage')"
              :aria-label="t('sourceControl.stage')"
              :loading="busyAction === `stage:${entry.path}`"
              :disabled="busyAction !== null && busyAction !== `stage:${entry.path}`"
              @click.stop="stageFile(entry)"
            >
              <template #icon><NIcon :component="AddOutline" /></template>
            </NButton>
          </div>
        </div>
      </div>

      <div class="shrink-0 space-y-2 border-t border-border/60 p-2">
        <NInput
          v-model:value="commitMessage"
          type="textarea"
          size="small"
          :placeholder="t('sourceControl.commitMessage')"
          :autosize="{ minRows: 2, maxRows: 4 }"
          :input-props="commitInputProps"
          @keydown="handleCommitKeydown"
        />
        <div class="flex items-center gap-2">
          <span class="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            {{ t("sourceControl.stagedCount", { count: stagedCount }) }}
          </span>
          <NButton
            size="small"
            type="primary"
            data-commit
            :disabled="!canCommit"
            :loading="busyAction === 'commit'"
            @click="commit"
          >
            {{ t("common.commit") }}
          </NButton>
        </div>
        <div v-if="actionError" class="text-[11px] text-destructive">{{ actionError }}</div>
        <div v-else-if="actionMessage" class="text-[11px] text-emerald-600 dark:text-emerald-400">
          {{ actionMessage }}
        </div>
      </div>
    </template>
  </aside>
</template>
