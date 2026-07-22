<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NSpin } from "naive-ui";
import type { FsGrepHit } from "@/lib/native";
import { t } from "@/modules/i18n/translate";
import { useWorkspaceContext } from "@/app/workspaceContext";
import { runFindInFiles } from "./lib/findInFilesService";

const props = defineProps<{
  rootPath: string | null;
}>();

const emit = defineEmits<{
  "open-result": [path: string, line: number];
}>();

const pattern = ref("");
const include = ref("");
const caseInsensitive = ref(false);
const wsCtx = useWorkspaceContext();
const loading = ref(false);
const hits = ref<FsGrepHit[]>([]);
const truncated = ref(false);
const filesScanned = ref(0);
const errorMessage = ref<string | null>(null);

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
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

function scheduleRun() {
  if (debounceHandle) clearTimeout(debounceHandle);
  debounceHandle = setTimeout(run, DEBOUNCE_MS);
}

watch([pattern, caseInsensitive, include], scheduleRun);
watch(() => props.rootPath, () => {
  pattern.value = "";
  hits.value = [];
  truncated.value = false;
  filesScanned.value = 0;
});

const groupedHits = computed(() => {
  const groups: Array<{ path: string; rel: string; lines: FsGrepHit[] }> = [];
  let current: (typeof groups)[number] | null = null;
  for (const hit of hits.value) {
    if (!current || current.path !== hit.path) {
      current = { path: hit.path, rel: hit.rel, lines: [hit] };
      groups.push(current);
    } else {
      current.lines.push(hit);
    }
  }
  return groups;
});

function openResult(hit: FsGrepHit) {
  emit("open-result", hit.path, hit.line);
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-find-in-files>
    <div class="space-y-2 border-b border-border/60 p-2">
      <input
        v-model="pattern"
        type="text"
        :placeholder="t('findInFiles.searchPlaceholder')"
        data-find-input
        class="h-8 w-full rounded-md border border-border bg-background px-2 text-[12px] outline-none focus:border-primary"
        @keydown.enter.prevent="run"
      />
      <div class="flex items-center gap-2 text-[11px] text-muted-foreground">
        <button
          type="button"
          data-find-case
          class="rounded border border-border px-1.5 py-0.5"
          :class="caseInsensitive ? 'bg-accent text-foreground' : ''"
          @click="caseInsensitive = !caseInsensitive"
        >
          {{ t("findInFiles.caseInsensitive") }}
        </button>
        <input
          v-model="include"
          type="text"
          :placeholder="t('findInFiles.includePlaceholder')"
          data-find-include
          class="h-6 flex-1 rounded-md border border-border bg-background px-1.5 text-[11px] outline-none focus:border-primary"
        />
      </div>
    </div>
    <div class="nexterm-card-header px-3 py-1.5 text-[11px] text-muted-foreground">
      <div class="flex items-center gap-2">
        <NSpin v-if="loading" size="small" />
        <span v-if="!loading && hits.length > 0">
          {{ t("findInFiles.summary", { count: hits.length, files: new Set(hits.map(h => h.path)).size, scanned: filesScanned }) }}
        </span>
        <span v-else-if="!loading && pattern.trim()">
          {{ t("findInFiles.noResults") }}
        </span>
        <span v-else>
          {{ t("findInFiles.prompt") }}
        </span>
      </div>
      <div v-if="truncated" class="mt-1 text-[10px] text-amber-600">
        {{ t("findInFiles.truncated") }}
      </div>
      <div v-if="errorMessage" class="mt-1 text-[10px] text-destructive">
        {{ errorMessage }}
      </div>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto py-1">
      <div
        v-for="group in groupedHits"
        :key="group.path"
        class="mb-1"
        data-find-group
      >
        <div class="px-3 py-1 text-[11px] font-medium text-foreground/80">
          {{ group.rel }}
        </div>
        <button
          v-for="hit in group.lines"
          :key="`${hit.path}:${hit.line}`"
          type="button"
          data-find-hit
          class="flex w-full items-baseline gap-2 rounded px-3 py-0.5 text-left text-[11px] hover:bg-accent/60"
          @click="openResult(hit)"
        >
          <span class="shrink-0 text-muted-foreground">L{{ hit.line }}</span>
          <span class="truncate font-mono">{{ hit.text }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
