<script setup lang="ts">
import {
  AddOutline,
  CheckmarkCircleOutline,
  DocumentOutline,
  GitBranchOutline,
  RefreshOutline,
  RemoveOutline,
  TimeOutline,
} from "@vicons/ionicons5";
import { NButton, NIcon, NInput, NSpin, NTag } from "naive-ui";
import { computed, ref, watch, type TextareaHTMLAttributes } from "vue";
import {
  native,
  type GitCommitResult,
  type GitRepoInfo,
  type GitStatusSnapshot,
} from "@/modules/ai/lib/native";
import {
  buildSourceControlEntries,
  getPrimaryDiffMode,
  type SourceControlFileEntry,
} from "./sourceControlModel";

type PanelState = "idle" | "loading" | "no-root" | "no-repo" | "ready" | "error";
type BusyAction = "refresh" | "commit" | `stage:${string}` | `unstage:${string}`;

const props = defineProps<{
  rootPath: string | null;
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
const commitInputProps = {
  "data-commit-message": "",
} as unknown as TextareaHTMLAttributes;

const entries = computed(() =>
  buildSourceControlEntries(status.value?.changedFiles ?? []),
);
const repoRoot = computed(() => status.value?.repoRoot ?? repo.value?.repoRoot ?? null);
const branchLabel = computed(() => {
  const current = status.value ?? repo.value;
  if (!current) return "Source Control";
  return current.isDetached ? "detached" : current.branch;
});
const stagedCount = computed(
  () => entries.value.filter((entry) => entry.staged).length,
);
const changedCount = computed(() => entries.value.length);
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
  return "Unknown source control error";
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
  if (entry.checkState === "checked") return "Staged";
  if (entry.checkState === "indeterminate") return "Mixed";
  return "Unstaged";
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
  actionMessage.value = null;
  actionError.value = null;
  try {
    await refreshStatus();
  } finally {
    busyAction.value = null;
  }
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
  actionMessage.value = null;
  actionError.value = null;
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
  actionMessage.value = null;
  actionError.value = null;
  try {
    await native.gitUnstage(root, [entry.path]);
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
  actionMessage.value = null;
  actionError.value = null;
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
</script>

<template>
  <aside class="flex h-full min-h-0 flex-col bg-card/55 text-foreground">
    <div class="flex h-9 shrink-0 items-center gap-1 border-b border-border/60 px-2">
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <NIcon :component="GitBranchOutline" :size="14" class="shrink-0 text-muted-foreground" />
        <span class="truncate text-[12px] font-semibold">{{ branchLabel }}</span>
      </div>
      <NTag v-if="changedCount > 0" size="small" round>{{ changedCount }}</NTag>
      <NButton
        size="tiny"
        quaternary
        title="Refresh"
        aria-label="Refresh"
        :loading="busyAction === 'refresh'"
        @click="refresh"
      >
        <template #icon><NIcon :component="RefreshOutline" /></template>
      </NButton>
      <NButton
        size="tiny"
        quaternary
        data-open-history
        title="History"
        aria-label="History"
        :disabled="!repoRoot"
        @click="openHistory"
      >
        <template #icon><NIcon :component="TimeOutline" /></template>
      </NButton>
    </div>

    <div v-if="panelState === 'no-root'" class="grid min-h-0 flex-1 place-items-center p-4 text-center">
      <div class="text-[12px] text-muted-foreground">No current directory</div>
    </div>

    <div v-else-if="panelState === 'loading'" class="flex min-h-0 flex-1 items-center justify-center gap-2 text-[12px] text-muted-foreground">
      <NSpin size="small" />
      <span>Loading source control...</span>
    </div>

    <div v-else-if="panelState === 'error'" class="grid min-h-0 flex-1 place-items-center p-4 text-center">
      <div class="text-[12px] text-destructive">{{ errorMessage }}</div>
    </div>

    <div v-else-if="panelState === 'no-repo'" class="grid min-h-0 flex-1 place-items-center p-4 text-center">
      <div class="text-[12px] text-muted-foreground">No Git repository</div>
    </div>

    <template v-else>
      <div class="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-2 py-2">
        <NTag size="small" round type="info">{{ branchLabel }}</NTag>
        <NTag v-if="status?.upstream" size="small" round>{{ status.upstream }}</NTag>
        <span class="min-w-0 flex-1 truncate text-right text-[11px] text-muted-foreground">
          <template v-if="status && (status.ahead > 0 || status.behind > 0)">
            ↑{{ status.ahead }} ↓{{ status.behind }}
          </template>
          <template v-else>Clean remote state</template>
        </span>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto py-1">
        <div v-if="entries.length === 0" class="grid h-full place-items-center p-4 text-center">
          <div class="space-y-1">
            <NIcon :component="CheckmarkCircleOutline" :size="22" class="text-emerald-500" />
            <div class="text-[12px] text-muted-foreground">No changes</div>
          </div>
        </div>

        <div v-else class="space-y-0.5 px-1">
          <div class="px-1.5 pb-1 pt-0.5 text-[11px] font-medium text-muted-foreground">
            Changes · {{ changedCount }}
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
              v-if="entry.checkState === 'checked'"
              size="tiny"
              quaternary
              :data-unstage-file="entry.path"
              title="Unstage"
              aria-label="Unstage"
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
              title="Stage"
              aria-label="Stage"
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
          placeholder="Commit message"
          :autosize="{ minRows: 2, maxRows: 4 }"
          :input-props="commitInputProps"
          @keydown="handleCommitKeydown"
        />
        <div class="flex items-center gap-2">
          <span class="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            {{ stagedCount }} staged
          </span>
          <NButton
            size="small"
            type="primary"
            data-commit
            :disabled="!canCommit"
            :loading="busyAction === 'commit'"
            @click="commit"
          >
            Commit
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
