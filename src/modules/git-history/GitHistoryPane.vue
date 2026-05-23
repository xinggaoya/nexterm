<script setup lang="ts">
import { CopyOutline, DocumentOutline, OpenOutline, RefreshOutline } from "@vicons/ionicons5";
import { openUrl } from "@tauri-apps/plugin-opener";
import { NButton, NDrawer, NDrawerContent, NIcon, NInput, NSpin, NTag } from "naive-ui";
import { computed, onMounted, reactive, ref, watch } from "vue";
import TooltipTitle from "@/components/TooltipTitle.vue";
import {
  native,
  type GitCommitFileChange,
  type GitLogEntry,
} from "@/lib/native";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import GraphRail from "./GraphRail.vue";
import { layoutGraph, type GraphRow } from "./lib/graph";
import {
  commitWebUrl,
  hostLabel,
  parseRemoteWebUrl,
  type RemoteWebInfo,
} from "./lib/remoteWebUrl";
import { currentLocale, t } from "@/modules/i18n/translate";

type CommitFileDiffOpenInput = {
  repoRoot: string;
  sha: string;
  shortSha: string;
  subject: string;
  path: string;
  originalPath: string | null;
};

type LoadStatus = "idle" | "initial" | "more" | "error";

type FilesEntry =
  | { state: "loading" }
  | { state: "loaded"; files: GitCommitFileChange[] }
  | { state: "error"; error: string };

const props = defineProps<{
  repoRoot: string;
}>();

const emit = defineEmits<{
  openCommitFile: [input: CommitFileDiffOpenInput];
}>();

const PAGE_SIZE = 30;
const ROW_HEIGHT = 32;
const commits = ref<GitLogEntry[]>([]);
const loadStatus = ref<LoadStatus>("idle");
const error = ref<string | null>(null);
const selectedSha = ref<string | null>(null);
const detailOpen = ref(false);
const search = ref("");
const endReached = ref(false);
const remoteWeb = ref<RemoteWebInfo | null>(null);
const filesBySha = reactive(new Map<string, FilesEntry>());

const graphRows = computed(() => {
  const { rows } = layoutGraph(commits.value);
  const byCommit = new Map<string, GraphRow>();
  let maxLaneCount = 1;
  for (const row of rows) {
    byCommit.set(row.sha, row);
    if (row.laneCount > maxLaneCount) maxLaneCount = row.laneCount;
  }
  return { byCommit, maxLaneCount };
});

const activeSearch = computed(() => search.value.trim().toLowerCase());
const filteredCommits = computed(() => {
  const query = activeSearch.value;
  if (query.length < 2) return commits.value;
  return commits.value.filter((commit) => {
    return (
      commit.subject.toLowerCase().includes(query) ||
      commit.author.toLowerCase().includes(query) ||
      commit.authorEmail.toLowerCase().includes(query) ||
      commit.shortSha.toLowerCase().includes(query)
    );
  });
});

const selectedCommit = computed(() =>
  selectedSha.value
    ? commits.value.find((commit) => commit.sha === selectedSha.value) ?? null
    : null,
);
const selectedFiles = computed(() =>
  selectedSha.value ? filesBySha.get(selectedSha.value) ?? null : null,
);
const selectedWebUrl = computed(() =>
  selectedCommit.value && remoteWeb.value
    ? commitWebUrl(remoteWeb.value, selectedCommit.value.sha)
    : null,
);

function normalizeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unknown error";
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return "";
  return normalized.slice(0, index);
}

function compactDate(secs: number): string {
  if (!secs) return "";
  const date = new Date(secs * 1000);
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const month = date.toLocaleString(currentLocale(), { month: "short" });
  const day = String(date.getDate()).padStart(2, "0");
  if (sameYear) {
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${month} ${day}  ${hh}:${mm}`;
  }
  return `${month} ${day} ${date.getFullYear()}`;
}

function absoluteTime(secs: number): string {
  if (!secs) return "";
  return new Date(secs * 1000).toLocaleString(currentLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusClass(status: string): string {
  switch (status.toUpperCase()) {
    case "A":
      return "text-emerald-600 dark:text-emerald-400";
    case "M":
      return "text-amber-600 dark:text-amber-300";
    case "D":
      return "text-rose-600 dark:text-rose-400";
    case "R":
    case "C":
      return "text-sky-600 dark:text-sky-300";
    default:
      return "text-muted-foreground";
  }
}

async function loadInitial() {
  loadStatus.value = "initial";
  error.value = null;
  endReached.value = false;
  selectedSha.value = null;
  detailOpen.value = false;
  filesBySha.clear();
  try {
    const entries = await native.gitLog(props.repoRoot, { limit: PAGE_SIZE });
    commits.value = entries;
    endReached.value = entries.length < PAGE_SIZE;
    loadStatus.value = "idle";
  } catch (err) {
    error.value = normalizeError(err);
    loadStatus.value = "error";
  }
}

async function loadRemote() {
  try {
    remoteWeb.value = parseRemoteWebUrl(await native.gitRemoteUrl(props.repoRoot));
  } catch {
    remoteWeb.value = null;
  }
}

async function selectCommit(commit: GitLogEntry) {
  selectedSha.value = commit.sha;
  detailOpen.value = true;
  if (filesBySha.has(commit.sha)) return;
  filesBySha.set(commit.sha, { state: "loading" });
  try {
    const files = await native.gitCommitFiles(props.repoRoot, commit.sha);
    filesBySha.set(commit.sha, { state: "loaded", files });
  } catch (err) {
    filesBySha.set(commit.sha, {
      state: "error",
      error: normalizeError(err),
    });
  }
}

function openCommitFile(commit: GitLogEntry, file: GitCommitFileChange) {
  emit("openCommitFile", {
    repoRoot: props.repoRoot,
    sha: commit.sha,
    shortSha: commit.shortSha,
    subject: commit.subject,
    path: file.path,
    originalPath: file.originalPath,
  });
}

function copySha(sha: string) {
  void navigator.clipboard?.writeText(sha).catch(() => undefined);
}

function openSelectedRemote() {
  if (!selectedWebUrl.value) return;
  void openUrl(selectedWebUrl.value).catch(console.error);
}

watch(
  () => props.repoRoot,
  () => {
    void loadInitial();
    void loadRemote();
  },
);

onMounted(() => {
  void loadInitial();
  void loadRemote();
});
</script>

<template>
  <div data-git-history class="flex h-full min-h-0 flex-col bg-background">
    <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-card/50 px-3">
      <div class="min-w-0 flex-1">
        <div class="truncate text-[12px] font-medium">
          {{ t("gitHistory.commitHistory") }}
        </div>
        <div class="truncate font-mono text-[10.5px] text-muted-foreground">
          {{ props.repoRoot }}
        </div>
      </div>
      <NInput
        v-model:value="search"
        size="tiny"
        class="max-w-56"
        :placeholder="t('gitHistory.filterCommits')"
        clearable
      />
      <TooltipTitle :label="t('common.refresh')">
        <NButton
          size="tiny"
          quaternary
          :aria-label="t('common.refresh')"
          @click="() => void loadInitial()"
        >
          <template #icon><NIcon :component="RefreshOutline" /></template>
        </NButton>
      </TooltipTitle>
    </div>

    <div
      v-if="loadStatus === 'initial' && commits.length === 0"
      class="grid min-h-0 flex-1 place-items-center"
    >
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <NSpin size="small" />
        <span>{{ t("gitHistory.loadingCommits") }}</span>
      </div>
    </div>

    <div
      v-else-if="loadStatus === 'error' && commits.length === 0"
      class="grid min-h-0 flex-1 place-items-center p-6 text-center"
    >
      <div class="space-y-2">
        <div class="text-sm font-medium">{{ t("gitHistory.couldNotLoad") }}</div>
        <div class="max-w-md text-xs text-destructive">{{ error }}</div>
        <NButton size="small" @click="() => void loadInitial()">
          {{ t("common.retry") }}
        </NButton>
      </div>
    </div>

    <div
      v-else-if="commits.length === 0"
      class="grid min-h-0 flex-1 place-items-center p-6 text-center"
    >
      <div>
        <div class="text-sm font-medium">{{ t("gitHistory.noCommitsTitle") }}</div>
        <div class="mt-1 text-xs text-muted-foreground">
          {{ t("gitHistory.noCommitsDescription") }}
        </div>
      </div>
    </div>

    <div v-else class="flex min-h-0 flex-1">
      <div class="min-w-0 flex-1 overflow-auto">
        <div class="grid h-6 items-center gap-3 border-b border-border/40 bg-card/55 px-3 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70 [grid-template-columns:68px_72px_minmax(0,1fr)_160px_96px_116px]">
          <div />
          <div>{{ t("gitHistory.sha") }}</div>
          <div>{{ t("gitHistory.subject") }}</div>
          <div>{{ t("gitHistory.author") }}</div>
          <div class="text-right">{{ t("gitHistory.date") }}</div>
          <div class="text-right">{{ t("gitHistory.changes") }}</div>
        </div>

        <button
          v-for="commit in filteredCommits"
          :key="commit.sha"
          type="button"
          :data-commit-row="commit.sha"
          :class="[
            'grid h-8 w-full items-center gap-3 border-l-2 px-3 text-left transition-colors [grid-template-columns:68px_72px_minmax(0,1fr)_160px_96px_116px]',
            selectedSha === commit.sha
              ? 'border-l-primary/70 bg-accent/45'
              : 'border-l-transparent hover:bg-accent/25',
          ]"
          @click="() => void selectCommit(commit)"
        >
          <div class="flex items-center">
            <GraphRail
              v-if="graphRows.byCommit.get(commit.sha)"
              :row="graphRows.byCommit.get(commit.sha)!"
              :row-height="ROW_HEIGHT"
              :max-lane-count="graphRows.maxLaneCount"
              :active="selectedSha === commit.sha"
            />
          </div>
          <span class="font-mono text-[10.5px] tabular-nums text-muted-foreground">
            {{ commit.shortSha }}
          </span>
          <span class="min-w-0 truncate text-[12px] font-medium">
            {{ commit.subject || t("gitHistory.noSubject") }}
          </span>
          <span class="min-w-0 truncate text-[10.5px] text-muted-foreground">
            {{ commit.author || t("common.unknown") }}
          </span>
          <span class="text-right font-mono text-[10.5px] tabular-nums text-muted-foreground">
            {{ compactDate(commit.timestampSecs) }}
          </span>
          <span class="flex min-w-0 items-center justify-end gap-1.5 font-mono text-[10px] tabular-nums">
            <span class="inline-flex items-center gap-1 text-muted-foreground">
              <NIcon :component="DocumentOutline" :size="11" />
              {{ commit.filesChanged }}
            </span>
            <span v-if="commit.insertions > 0" class="font-semibold text-emerald-600 dark:text-emerald-400">
              +{{ commit.insertions }}
            </span>
            <span v-if="commit.deletions > 0" class="font-semibold text-rose-600 dark:text-rose-400">
              -{{ commit.deletions }}
            </span>
          </span>
        </button>
      </div>

      <NDrawer
        v-model:show="detailOpen"
        placement="right"
        width="min(520px, 92vw)"
        :auto-focus="false"
        :block-scroll="false"
      >
        <NDrawerContent
          closable
          body-content-style="height: 100%; padding: 0;"
          :native-scrollbar="false"
        >
          <template #header>
            <div class="text-[12px] font-semibold">
              {{ t("gitHistory.commitDetails") }}
            </div>
          </template>

          <div
            v-if="selectedCommit"
            data-commit-detail-drawer
            class="flex h-full min-h-0 flex-col bg-background"
          >
            <div class="shrink-0 border-b border-border/50 p-3">
              <div class="flex items-start gap-2">
                <NTag size="small" :bordered="false">{{ selectedCommit.shortSha }}</NTag>
                <div class="min-w-0 flex-1 text-[12.5px] font-semibold leading-snug">
                  {{ selectedCommit.subject || t("gitHistory.noSubject") }}
                </div>
              </div>
              <div class="mt-2 truncate text-[10.5px] text-muted-foreground">
                {{ selectedCommit.author || t("common.unknown") }}
                <span v-if="selectedCommit.authorEmail"> · {{ selectedCommit.authorEmail }}</span>
                · {{ absoluteTime(selectedCommit.timestampSecs) }}
              </div>
              <div class="mt-2 flex items-center gap-1">
                <TooltipTitle :label="t('gitHistory.copySha')">
                  <NButton
                    size="tiny"
                    quaternary
                    :aria-label="t('gitHistory.copySha')"
                    @click="copySha(selectedCommit.sha)"
                  >
                    <template #icon><NIcon :component="CopyOutline" /></template>
                    {{ t("gitHistory.copySha") }}
                  </NButton>
                </TooltipTitle>
                <TooltipTitle
                  v-if="selectedWebUrl && remoteWeb"
                  :label="hostLabel(remoteWeb)"
                >
                  <NButton
                    size="tiny"
                    quaternary
                    :aria-label="hostLabel(remoteWeb)"
                    @click="openSelectedRemote"
                  >
                    <template #icon><NIcon :component="OpenOutline" /></template>
                    {{ hostLabel(remoteWeb) }}
                  </NButton>
                </TooltipTitle>
              </div>
            </div>

            <div class="min-h-0 flex-1 overflow-auto p-2">
              <div v-if="!selectedFiles || selectedFiles.state === 'loading'" class="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                <NSpin size="small" />
                <span>{{ t("gitHistory.loadingFiles") }}</span>
              </div>
              <div v-else-if="selectedFiles.state === 'error'" class="px-2 py-3 text-xs text-destructive">
                {{ selectedFiles.error }}
              </div>
              <div v-else-if="selectedFiles.files.length === 0" class="px-2 py-3 text-xs text-muted-foreground">
                {{ t("gitHistory.noFileChanges") }}
              </div>
              <button
                v-for="file in selectedFiles.files"
                v-else
                :key="file.path"
                type="button"
                :data-commit-file="file.path"
                class="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-accent/45"
                @click="openCommitFile(selectedCommit, file)"
              >
                <img :src="fileIconUrl(basename(file.path))" alt="" class="size-3.5 shrink-0" />
                <div class="flex min-w-0 flex-1 items-baseline gap-1.5">
                  <span class="truncate text-[11.5px] font-medium">{{ basename(file.path) }}</span>
                  <span v-if="dirname(file.path)" class="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
                    {{ dirname(file.path) }}
                  </span>
                </div>
                <span v-if="file.isBinary" class="text-[10px] text-muted-foreground">
                  {{ t("gitHistory.binary") }}
                </span>
                <template v-else>
                  <span v-if="file.added > 0" class="font-mono text-[10px] text-emerald-600 dark:text-emerald-400">+{{ file.added }}</span>
                  <span v-if="file.removed > 0" class="font-mono text-[10px] text-rose-600 dark:text-rose-400">-{{ file.removed }}</span>
                </template>
                <span :class="['w-4 text-center text-[9.5px] font-bold', statusClass(file.status)]">
                  {{ file.status.toUpperCase() }}
                </span>
              </button>
            </div>
          </div>
        </NDrawerContent>
      </NDrawer>
    </div>
  </div>
</template>
