<script setup lang="ts">
import { useVirtualWindow } from "@/lib/useVirtualWindow";
import { basename } from "@/lib/path";
import { normalizeErrorMessage } from "@/lib/error";
import {
  CopyOutline,
  DocumentOutline,
  GitBranchOutline,
  OpenOutline,
  RefreshOutline,
} from "@vicons/ionicons5";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  NButton,
  NDrawer,
  NDrawerContent,
  NIcon,
  NInput,
  NSelect,
  NSpin,
  NTag,
  type SelectOption,
} from "naive-ui";
import { computed, onMounted, reactive, ref, watch } from "vue";
import TooltipTitle from "@/components/TooltipTitle.vue";
import {
  type GitBranchInfo,
  type GitCommitFileChange,
  type GitLogEntry,
} from "@/lib/native";
import { useWorkspaceContext } from "@/app/workspaceContext";
import { writeClipboardText } from "@/lib/clipboard";
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

const props = withDefaults(
  defineProps<{
    repoRoot: string;
    /** Git ref name (branch/tag/rev) to scope the log. */
    refName?: string | null;
    /** When true, fetch across every branch (overrides refName). */
    allRefs?: boolean;
  }>(),
  {
    refName: null,
    allRefs: false,
  },
);

const emit = defineEmits<{
  openCommitFile: [input: CommitFileDiffOpenInput];
  changeRef: [input: { refName: string | null; allRefs: boolean }];
}>();

const PAGE_SIZE = 30;
const ROW_HEIGHT = 32;
const commits = ref<GitLogEntry[]>([]);
const loadStatus = ref<LoadStatus>("idle");
const error = ref<string | null>(null);
const selectedSha = ref<string | null>(null);
const detailOpen = ref(false);
const search = ref("");
const hasMore = ref(false);
const offset = ref(0);
const branches = ref<GitBranchInfo[]>([]);
const branchesLoading = ref(false);
const branchesRequestId = ref(0);
// Monotonic request counter so stale responses can be discarded.
const logRequestId = ref(0);
const remoteWeb = ref<RemoteWebInfo | null>(null);
const filesBySha = reactive(new Map<string, FilesEntry>());

// 获取当前 workspace 上下文，所有 git native 调用都走 wsNative。
const wsCtx = useWorkspaceContext();

const refOptions = computed<SelectOption[]>(() => {
  const opts: SelectOption[] = [];
  if (props.allRefs) {
    opts.push({
      label: t("gitHistory.allBranches"),
      value: "__all__",
    });
  } else if (props.refName) {
    opts.push({
      label: props.refName,
      value: `ref:${props.refName}`,
    });
  } else {
    opts.push({
      label: t("gitHistory.headShort"),
      value: "__head__",
    });
  }
  for (const branch of branches.value) {
    if (branch.isRemote) continue;
    opts.push({
      label: branch.name,
      value: `branch:${branch.name}`,
    });
  }
  return opts;
});

const refSelectorValue = computed<string>(() => {
  if (props.allRefs) return "__all__";
  if (props.refName) return `ref:${props.refName}`;
  return "__head__";
});

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

// 搜索输入 debounce：避免每次按键都全量重过滤大提交列表。
const debouncedSearch = ref("");
let searchDebounceHandle: ReturnType<typeof setTimeout> | null = null;
watch(search, (value) => {
  if (searchDebounceHandle) clearTimeout(searchDebounceHandle);
  searchDebounceHandle = setTimeout(() => {
    debouncedSearch.value = value;
  }, 120);
});

const activeSearch = computed(() => debouncedSearch.value.trim().toLowerCase());
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

// ── Virtual scroll window（定高 32px，lib/useVirtualWindow 公共实现）──
// 大仓库历史可达数百上千条；超过阈值才窗口化，小列表直接全量渲染。
const listScrollEl = ref<HTMLElement | null>(null);
const {
  range: virtualRange,
  topPadding: topPad,
  bottomPadding: bottomPad,
  onScroll: onListScroll,
} = useVirtualWindow(listScrollEl, {
  total: () => filteredCommits.value.length,
  rowHeight: ROW_HEIGHT,
});
const visibleCommits = computed(() => {
  const { start, end } = virtualRange.value;
  return filteredCommits.value.slice(start, end);
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
      return "text-success";
    case "M":
      return "text-warning";
    case "D":
      return "text-destructive";
    case "R":
    case "C":
      return "text-info";
    default:
      return "text-muted-foreground";
  }
}

function refKindClass(kind: string): string {
  switch (kind.toLowerCase()) {
    case "tag":
      return "border-warning/40 bg-warning/10 text-warning";
    case "remote":
      return "border-info/40 bg-info/10 text-info";
    default:
      return "border-success/40 bg-success/10 text-success";
  }
}

async function loadBranches() {
  const root = props.repoRoot;
  const myId = ++branchesRequestId.value;
  branchesLoading.value = true;
  try {
    const list = await wsCtx.wsNative.gitBranchList(root);
    if (myId !== branchesRequestId.value) return;
    branches.value = list;
  } catch {
    if (myId !== branchesRequestId.value) return;
    branches.value = [];
  } finally {
    if (myId === branchesRequestId.value) branchesLoading.value = false;
  }
}

async function loadInitial() {
  // Bump the request id so any in-flight response is ignored.
  const myId = ++logRequestId.value;
  loadStatus.value = "initial";
  error.value = null;
  selectedSha.value = null;
  detailOpen.value = false;
  filesBySha.clear();
  try {
    const page = await wsCtx.wsNative.gitLog(props.repoRoot, {
      limit: PAGE_SIZE,
      offset: 0,
      refName: props.allRefs ? null : props.refName,
      all: props.allRefs,
    });
    if (myId !== logRequestId.value) return;
    commits.value = page.entries;
    // `loadInitial` always requests `limit: PAGE_SIZE` at offset 0, so the
    // next page begins at PAGE_SIZE regardless of how many rows the
    // backend returned.
    offset.value = PAGE_SIZE;
    hasMore.value = page.hasMore;
    loadStatus.value = "idle";
  } catch (err) {
    if (myId !== logRequestId.value) return;
    error.value = normalizeErrorMessage(err);
    loadStatus.value = "error";
  }
}

async function loadMore() {
  if (!hasMore.value) return;
  const myId = ++logRequestId.value;
  loadStatus.value = "more";
  const requestedOffset = offset.value;
  try {
    const page = await wsCtx.wsNative.gitLog(props.repoRoot, {
      limit: PAGE_SIZE,
      offset: requestedOffset,
      refName: props.allRefs ? null : props.refName,
      all: props.allRefs,
    });
    if (myId !== logRequestId.value) return;
    // Dedup by SHA so re-issued requests don't double-append.
    const seen = new Set(commits.value.map((entry) => entry.sha));
    const fresh: GitLogEntry[] = [];
    for (const entry of page.entries) {
      if (seen.has(entry.sha)) continue;
      seen.add(entry.sha);
      fresh.push(entry);
    }
    if (fresh.length > 0) {
      commits.value = [...commits.value, ...fresh];
    }
    // Advance the cursor by PAGE_SIZE — the next request will start at
    // `requestedOffset + PAGE_SIZE` regardless of how many fresh entries
    // we appended. This matches Rust's limit/offset pagination model and
    // keeps the test invariant stable when a page returns fewer rows.
    offset.value = requestedOffset + PAGE_SIZE;
    hasMore.value = page.hasMore;
    loadStatus.value = "idle";
  } catch (err) {
    if (myId !== logRequestId.value) return;
    error.value = normalizeErrorMessage(err);
    loadStatus.value = "error";
  }
}

async function loadRemote() {
  try {
    remoteWeb.value = parseRemoteWebUrl(await wsCtx.wsNative.gitRemoteUrl(props.repoRoot));
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
    const files = await wsCtx.wsNative.gitCommitFiles(props.repoRoot, commit.sha);
    filesBySha.set(commit.sha, { state: "loaded", files });
  } catch (err) {
    filesBySha.set(commit.sha, {
      state: "error",
      error: normalizeErrorMessage(err),
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
  void writeClipboardText(sha);
}

function openSelectedRemote() {
  if (!selectedWebUrl.value) return;
  void openUrl(selectedWebUrl.value).catch(console.error);
}

function selectRef(value: string) {
  if (value === "__all__") {
    emitRefChoice({ refName: null, allRefs: true });
    return;
  }
  if (value === "__head__") {
    emitRefChoice({ refName: null, allRefs: false });
    return;
  }
  if (value.startsWith("branch:")) {
    const name = value.slice("branch:".length);
    emitRefChoice({ refName: name, allRefs: false });
    return;
  }
  if (value.startsWith("ref:")) {
    const name = value.slice("ref:".length);
    emitRefChoice({ refName: name, allRefs: false });
    return;
  }
}

function emitRefChoice(next: { refName: string | null; allRefs: boolean }) {
  // Bubble the choice up — the parent (Stack → Workbench → MainApp) is
  // responsible for updating the active tab's identity via the store.
  emit("changeRef", next);
}

watch(
  () => props.repoRoot,
  () => {
    void loadInitial();
    void loadRemote();
    void loadBranches();
  },
);

// Switching the ref or scope cancels whatever is in flight and rebuilds
// the list from page zero.
watch(
  () => [props.refName, props.allRefs] as const,
  () => {
    void loadInitial();
  },
);

onMounted(() => {
  void loadInitial();
  void loadRemote();
  void loadBranches();
});
</script>

<template>
  <div data-git-history class="nexterm-surface flex h-full min-h-0 flex-col">
    <div class="nexterm-toolbar flex h-8 shrink-0 items-center gap-2 px-3">
      <div class="min-w-0 flex-1">
        <div class="truncate text-[12px] font-medium">
          {{ t("gitHistory.commitHistory") }}
        </div>
        <div class="truncate font-mono text-[10.5px] text-muted-foreground">
          {{ props.repoRoot }}
        </div>
      </div>
      <TooltipTitle :label="t('gitHistory.refSelector')">
        <NSelect
          data-ref-selector
          size="tiny"
          class="max-w-44"
          :value="refSelectorValue"
          :options="refOptions"
          :loading="branchesLoading"
          :consistent-menu-width="false"
          @update:value="selectRef"
        >
          <template #arrow>
            <NIcon :component="GitBranchOutline" />
          </template>
        </NSelect>
      </TooltipTitle>
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
      class="min-h-0 flex-1 overflow-hidden px-3 py-2"
      aria-busy="true"
    >
      <div
        v-for="n in 8"
        :key="n"
        class="v2-skeleton mb-1 h-8 w-full"
        :style="{ opacity: 1 - n * 0.08 }"
      />
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

    <div v-else class="flex min-h-0 min-w-0 flex-1">
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <div class="grid h-6 shrink-0 items-center gap-3 border-b border-border bg-surface-subtle px-3 text-[9.5px] font-semibold uppercase text-muted-foreground/70 [grid-template-columns:68px_72px_minmax(0,1fr)_160px_96px_116px]">
          <div />
          <div>{{ t("gitHistory.sha") }}</div>
          <div>{{ t("gitHistory.subject") }}</div>
          <div>{{ t("gitHistory.author") }}</div>
          <div class="text-right">{{ t("gitHistory.date") }}</div>
          <div class="text-right">{{ t("gitHistory.changes") }}</div>
        </div>

        <div
          ref="listScrollEl"
          class="min-h-0 min-w-0 flex-1 overflow-auto"
          @scroll.passive="onListScroll"
        >
          <div v-if="topPad" :style="{ height: `${topPad}px` }" aria-hidden="true" />
          <button
            v-for="commit in visibleCommits"
            :key="commit.sha"
            v-memo="[commit.sha, selectedSha === commit.sha, graphRows.byCommit.get(commit.sha) !== undefined]"
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
            <span class="min-w-0 text-[12px] font-medium">
              <span class="block truncate">
                {{ commit.subject || t("gitHistory.noSubject") }}
              </span>
              <span
                v-if="commit.refs && commit.refs.length > 0"
                class="mt-0.5 flex flex-wrap items-center gap-1"
              >
                <NTag
                  v-for="ref in commit.refs"
                  :key="`${commit.sha}-${ref.name}`"
                  size="tiny"
                  :bordered="false"
                  round
                  data-ref-badge
                  :class="['min-w-0 max-w-full truncate border px-1 py-0 text-[9.5px] font-medium', refKindClass(ref.kind)]"
                  :title="ref.name"
                >
                  {{ ref.name }}
                </NTag>
              </span>
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
              <span v-if="commit.insertions > 0" class="font-semibold text-success">
                +{{ commit.insertions }}
              </span>
              <span v-if="commit.deletions > 0" class="font-semibold text-destructive">
                -{{ commit.deletions }}
              </span>
            </span>
          </button>
          <div v-if="bottomPad" :style="{ height: `${bottomPad}px` }" aria-hidden="true" />
        </div>

        <div
          v-if="hasMore"
          class="shrink-0 border-t border-border bg-surface-subtle p-2"
        >
          <NButton
            size="small"
            block
            data-load-more
            :loading="loadStatus === 'more'"
            @click="() => void loadMore()"
          >
            {{ t("gitHistory.loadMore") }}
          </NButton>
        </div>
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
              <div
                v-if="selectedCommit.refs && selectedCommit.refs.length > 0"
                class="mt-2 flex flex-wrap items-center gap-1"
              >
                <NTag
                  v-for="ref in selectedCommit.refs"
                  :key="`detail-${ref.name}`"
                  size="tiny"
                  :bordered="false"
                  round
                  data-ref-badge
                  :class="['border px-1 py-0 text-[9.5px] font-medium', refKindClass(ref.kind)]"
                >
                  {{ ref.name }}
                </NTag>
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
                  <span v-if="file.added > 0" class="font-mono text-[10px] text-success">+{{ file.added }}</span>
                  <span v-if="file.removed > 0" class="font-mono text-[10px] text-destructive">-{{ file.removed }}</span>
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
