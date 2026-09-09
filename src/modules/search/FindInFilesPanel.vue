<script setup lang="ts">
import { ChevronForwardOutline } from "@vicons/ionicons5";
import { NIcon, NSpin } from "naive-ui";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import type { FsGrepHit } from "@/lib/native";
import { t } from "@/modules/i18n/translate";
import { useWorkspaceContext } from "@/app/workspaceContext";
import { runFindInFiles } from "./lib/findInFilesService";
import {
  buildHighlightSegments,
  type HighlightSegment,
} from "./lib/highlight";

const props = defineProps<{
  rootPath: string | null;
}>();

const emit = defineEmits<{
  "open-result": [path: string, line: number];
}>();

const pattern = ref("");
const include = ref("");
const caseInsensitive = ref(false);
// 默认纯文本子串匹配("全局字符搜索"),.* 切换到正则。
const regexMode = ref(false);
const wsCtx = useWorkspaceContext();
const loading = ref(false);
const hits = ref<FsGrepHit[]>([]);
const truncated = ref(false);
const filesScanned = ref(0);
const errorMessage = ref<string | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);

let debounceHandle: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 250;

const globs = computed(() =>
  include.value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

async function run() {
  if (!props.rootPath || !pattern.value.trim()) {
    hits.value = [];
    truncated.value = false;
    filesScanned.value = 0;
    errorMessage.value = null;
    return;
  }
  loading.value = true;
  errorMessage.value = null;
  try {
    const result = await runFindInFiles(wsCtx.wsNative, {
      root: props.rootPath,
      pattern: pattern.value,
      regex: regexMode.value,
      caseInsensitive: caseInsensitive.value,
      includeGlobs: globs.value,
    });
    hits.value = result.hits;
    truncated.value = result.truncated;
    filesScanned.value = result.filesScanned;
  } catch (error) {
    hits.value = [];
    truncated.value = false;
    filesScanned.value = 0;
    const raw = error instanceof Error ? error.message : String(error);
    // 后端三种路由的正则错误措辞不同,统一收敛成一句可读提示。
    errorMessage.value = /bad regex|regex parse/i.test(raw)
      ? t("findInFiles.invalidRegex")
      : raw;
  } finally {
    loading.value = false;
  }
}

function scheduleRun() {
  if (debounceHandle) clearTimeout(debounceHandle);
  debounceHandle = setTimeout(run, DEBOUNCE_MS);
}

/** Enter 立即执行:取消挂起的防抖,避免紧跟着再跑一次。 */
function runNow() {
  if (debounceHandle) clearTimeout(debounceHandle);
  debounceHandle = null;
  void run();
}

watch([pattern, caseInsensitive, include, regexMode], scheduleRun);
watch(
  () => props.rootPath,
  () => {
    pattern.value = "";
    hits.value = [];
    truncated.value = false;
    filesScanned.value = 0;
    errorMessage.value = null;
  },
);

// ── 结果分组 ────────────────────────────────────────────────────────────
// 后端是并行遍历,不同文件的命中在结果流里可能交错;按"连续相同 path"
// 分组会把同一文件拆成多个组,必须按 path 聚合。
type HitGroup = { path: string; rel: string; lines: FsGrepHit[] };

const groupedHits = computed<HitGroup[]>(() => {
  const byPath = new Map<string, HitGroup>();
  for (const hit of hits.value) {
    let group = byPath.get(hit.path);
    if (!group) {
      group = { path: hit.path, rel: hit.rel, lines: [] };
      byPath.set(hit.path, group);
    }
    if (!group.lines.some((line) => line.line === hit.line)) {
      group.lines.push(hit);
    }
  }
  for (const group of byPath.values()) {
    group.lines.sort((a, b) => a.line - b.line);
  }
  return Array.from(byPath.values());
});

const collapsedPaths = ref<ReadonlySet<string>>(new Set());

function toggleGroup(path: string) {
  const next = new Set(collapsedPaths.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  collapsedPaths.value = next;
}

// 结果分页:命中行高度不一,定高窗口化不可靠,改用「先渲染 N 组 + 触底加载」。
const INITIAL_GROUPS = 40;
const LOAD_STEP = 40;
const renderedGroups = ref(INITIAL_GROUPS);
const visibleGroups = computed(() => groupedHits.value.slice(0, renderedGroups.value));
const hasMoreGroups = computed(() => renderedGroups.value < groupedHits.value.length);

function onResultsScroll(e: Event) {
  const el = e.target as HTMLElement;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 120 && hasMoreGroups.value) {
    renderedGroups.value += LOAD_STEP;
  }
}

// 结果变化时重置分页、折叠态与键盘选中位。
watch(groupedHits, () => {
  renderedGroups.value = INITIAL_GROUPS;
  collapsedPaths.value = new Set();
  selectedIndex.value = 0;
});

function openResult(hit: FsGrepHit) {
  emit("open-result", hit.path, hit.line);
}

// ── 命中高亮 ────────────────────────────────────────────────────────────
const highlightOptions = computed(() => ({
  regex: regexMode.value,
  caseInsensitive: caseInsensitive.value,
}));

function segmentsFor(hit: FsGrepHit): HighlightSegment[] | null {
  return buildHighlightSegments(hit.text, pattern.value.trim(), highlightOptions.value);
}

// ── 键盘导航:↑/↓ 在(展开的)结果间移动,Enter 打开 ─────────────────────
const visibleLines = computed(() =>
  visibleGroups.value.flatMap((group) =>
    group.lines.map((hit) => ({ hit, groupPath: group.path })),
  ),
);
const selectedIndex = ref(0);

watch(visibleLines, (lines) => {
  if (selectedIndex.value >= lines.length) selectedIndex.value = 0;
});

function isEntrySelected(group: HitGroup, hit: FsGrepHit): boolean {
  const entry = visibleLines.value[selectedIndex.value];
  return !!entry && entry.hit === hit && entry.groupPath === group.path;
}

function selectEntry(group: HitGroup, hit: FsGrepHit) {
  const index = visibleLines.value.findIndex(
    (entry) => entry.hit === hit && entry.groupPath === group.path,
  );
  if (index >= 0) selectedIndex.value = index;
}

watch(selectedIndex, async () => {
  await nextTick();
  document
    .querySelector('[data-find-hit][data-selected="true"]')
    ?.scrollIntoView?.({ block: "nearest" });
});

function handlePanelKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    inputRef.value?.focus();
    pattern.value = "";
    return;
  }
  const total = visibleLines.value.length;
  if (total === 0) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    selectedIndex.value = (selectedIndex.value + 1) % total;
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    selectedIndex.value = (selectedIndex.value - 1 + total) % total;
  } else if (event.key === "Enter") {
    event.preventDefault();
    const entry = visibleLines.value[selectedIndex.value];
    if (entry) openResult(entry.hit);
  }
}

onMounted(() => {
  void nextTick(() => inputRef.value?.focus({ preventScroll: true }));
});

onBeforeUnmount(() => {
  if (debounceHandle) clearTimeout(debounceHandle);
});
</script>

<template>
  <div
    class="flex h-full min-h-0 flex-col"
    data-find-in-files
    @keydown="handlePanelKeydown"
  >
    <div class="space-y-2 border-b border-border/60 p-2">
      <div class="flex items-center gap-1.5">
        <input
          ref="inputRef"
          v-model="pattern"
          type="text"
          :placeholder="t('findInFiles.searchPlaceholder')"
          data-find-input
          class="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[12px] outline-none focus:border-primary"
          @keydown.enter.prevent="runNow"
        />
        <button
          type="button"
          data-find-case
          :aria-pressed="caseInsensitive"
          :title="t('findInFiles.caseInsensitiveTitle')"
          class="h-6 w-6 flex-none rounded border text-[11px] font-medium"
          :class="
            caseInsensitive
              ? 'border-primary bg-accent text-foreground'
              : 'border-border text-muted-foreground hover:text-foreground'
          "
          @click="caseInsensitive = !caseInsensitive"
        >
          {{ t("findInFiles.caseInsensitive") }}
        </button>
        <button
          type="button"
          data-find-regex
          :aria-pressed="regexMode"
          :title="t('findInFiles.regexTitle')"
          class="h-6 w-6 flex-none rounded border font-mono text-[11px]"
          :class="
            regexMode
              ? 'border-primary bg-accent text-foreground'
              : 'border-border text-muted-foreground hover:text-foreground'
          "
          @click="regexMode = !regexMode"
        >
          .*
        </button>
      </div>
      <input
        v-model="include"
        type="text"
        :placeholder="t('findInFiles.includePlaceholder')"
        data-find-include
        class="h-6 w-full rounded-md border border-border bg-background px-1.5 text-[11px] outline-none focus:border-primary"
      />
    </div>
    <div class="nexterm-toolbar px-3 py-1.5 text-[11px] text-muted-foreground">
      <div class="flex items-center gap-2">
        <NSpin v-if="loading" size="small" />
        <span v-if="!loading && hits.length > 0">
          {{ t("findInFiles.summary", { count: hits.length, files: groupedHits.length, scanned: filesScanned }) }}
        </span>
        <span v-else-if="!loading && pattern.trim()">
          {{ t("findInFiles.noResults") }}
        </span>
        <span v-else>
          {{ t("findInFiles.prompt") }}
        </span>
      </div>
      <div v-if="truncated" class="mt-1 text-[10px] text-warning">
        {{ t("findInFiles.truncated") }}
      </div>
      <div v-if="errorMessage" class="mt-1 text-[10px] text-destructive">
        {{ errorMessage }}
      </div>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto py-1" @scroll.passive="onResultsScroll">
      <div
        v-for="group in visibleGroups"
        :key="group.path"
        class="mb-1"
        data-find-group
      >
        <button
          type="button"
          data-find-group-toggle
          class="flex h-6 w-full items-center gap-1.5 px-2 text-left text-[11px] font-medium text-foreground/80 hover:bg-accent/40"
          :title="group.path"
          @click="toggleGroup(group.path)"
        >
          <NIcon
            :component="ChevronForwardOutline"
            :size="10"
            class="shrink-0 text-muted-foreground transition-transform duration-[var(--dur-fast)]"
            :class="collapsedPaths.has(group.path) ? '' : 'rotate-90'"
          />
          <img
            :src="fileIconUrl(group.rel)"
            alt=""
            class="size-3.5 shrink-0"
          />
          <span class="min-w-0 truncate">{{ group.rel }}</span>
          <span class="ml-auto shrink-0 rounded-full bg-surface-hover px-1.5 text-[10px] text-muted-foreground">
            {{ group.lines.length }}
          </span>
        </button>
        <template v-if="!collapsedPaths.has(group.path)">
          <button
            v-for="hit in group.lines"
            :key="`${hit.path}:${hit.line}`"
            type="button"
            data-find-hit
            :data-selected="isEntrySelected(group, hit) ? 'true' : 'false'"
            :aria-selected="isEntrySelected(group, hit)"
            class="flex w-full items-baseline gap-2 rounded px-3 py-0.5 text-left text-[11px] hover:bg-accent/60"
            :class="isEntrySelected(group, hit) ? 'bg-accent' : ''"
            @mouseenter="selectEntry(group, hit)"
            @click="openResult(hit)"
          >
            <span class="w-10 shrink-0 text-right text-muted-foreground" data-find-line>{{ hit.line }}</span>
            <span class="min-w-0 flex-1 truncate font-mono">
              <template v-if="segmentsFor(hit)">
                <template
                  v-for="(segment, si) in segmentsFor(hit)!"
                  :key="`${hit.line}:${si}`"
                >
                  <mark
                    v-if="segment.hit"
                    class="rounded-sm bg-primary/25 text-foreground"
                  >{{ segment.text }}</mark>
                  <template v-else>{{ segment.text }}</template>
                </template>
              </template>
              <template v-else>{{ hit.text }}</template>
            </span>
          </button>
        </template>
      </div>
      <div v-if="hasMoreGroups" class="px-3 py-2 text-[10px] text-muted-foreground">
        {{ t("findInFiles.scrollForMore") }}
      </div>
    </div>
  </div>
</template>
