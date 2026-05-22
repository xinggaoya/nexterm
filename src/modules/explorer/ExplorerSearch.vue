<script setup lang="ts">
import { CloseOutline, SearchOutline } from "@vicons/ionicons5";
import { NIcon, NSpin } from "naive-ui";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { t } from "@/modules/i18n/translate";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import { fileIconUrl, folderIconUrl } from "./lib/iconResolver";
import { searchFileTree, type SearchHit } from "./lib/fileTreeService";

const MIN_QUERY_LEN = 2;
const DEBOUNCE_MS = 300;

const props = defineProps<{
  rootPath: string;
  open: boolean;
}>();

const emit = defineEmits<{
  requestClose: [];
  activeChange: [active: boolean];
  openFile: [path: string, pin: boolean];
}>();

const prefs = usePreferencesPiniaStore();
const inputRef = ref<HTMLInputElement | null>(null);
const query = ref("");
const results = ref<SearchHit[]>([]);
const selectedIndex = ref(0);
const searching = ref(false);
const truncated = ref(false);
let timer: number | null = null;
let requestId = 0;

const active = computed(() => query.value.trim().length > 0);

function clearTimer() {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
}

function resetSearch() {
  clearTimer();
  query.value = "";
  results.value = [];
  selectedIndex.value = 0;
  searching.value = false;
  truncated.value = false;
}

function selectHit(hit: SearchHit) {
  if (!hit.is_dir) emit("openFile", hit.path, false);
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("requestClose");
    return;
  }

  if (results.value.length === 0) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    selectedIndex.value = (selectedIndex.value + 1) % results.value.length;
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    selectedIndex.value =
      (selectedIndex.value - 1 + results.value.length) % results.value.length;
  } else if (event.key === "Enter") {
    event.preventDefault();
    const hit = results.value[selectedIndex.value];
    if (hit) selectHit(hit);
  }
}

watch(active, (value) => emit("activeChange", value), { immediate: true });

watch(
  () => props.open,
  (open) => {
    if (!open) {
      resetSearch();
      return;
    }
    void nextTick(() => inputRef.value?.focus({ preventScroll: true }));
  },
  { immediate: true },
);

watch(
  [query, () => props.rootPath, () => prefs.showHidden],
  ([nextQuery]) => {
    clearTimer();
    const trimmed = nextQuery.trim();
    if (trimmed.length < MIN_QUERY_LEN) {
      results.value = [];
      selectedIndex.value = 0;
      searching.value = false;
      truncated.value = false;
      return;
    }

    const currentId = ++requestId;
    searching.value = true;
    timer = window.setTimeout(async () => {
      try {
        const result = await searchFileTree(
          props.rootPath,
          trimmed,
          prefs.showHidden,
        );
        if (currentId !== requestId) return;
        results.value = result.hits;
        truncated.value = result.truncated;
        selectedIndex.value = 0;
      } catch {
        if (currentId !== requestId) return;
        results.value = [];
        truncated.value = false;
        selectedIndex.value = 0;
      } finally {
        if (currentId === requestId) searching.value = false;
      }
    }, DEBOUNCE_MS);
  },
);

onBeforeUnmount(clearTimer);
</script>

<template>
  <div v-if="open" class="flex min-h-0 flex-col">
    <div class="relative shrink-0 px-2 py-1.5">
      <NIcon
        :component="SearchOutline"
        :size="13"
        class="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref="inputRef"
        v-model="query"
        data-explorer-search-input
        :placeholder="t('explorer.searchFiles')"
        class="h-7 w-full rounded-md border border-border bg-background px-7 text-[12px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
        @keydown="handleKeydown"
      />
      <button
        v-if="query"
        type="button"
        :aria-label="t('explorer.clearSearch')"
        class="absolute right-3.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        @click="query = ''"
      >
        <NIcon :component="CloseOutline" :size="11" />
      </button>
    </div>

    <div v-if="active" class="min-h-0 flex-1 overflow-y-auto py-1">
      <div
        v-if="searching && results.length === 0"
        class="flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground"
      >
        <NSpin size="small" />
        <span>{{ t("explorer.searching") }}</span>
      </div>
      <div
        v-else-if="results.length === 0"
        class="px-3 py-2 text-[11px] text-muted-foreground"
      >
        {{ t("explorer.noMatches") }}
      </div>
      <button
        v-for="(hit, index) in results"
        v-else
        :key="hit.path"
        type="button"
        :data-search-result="hit.path"
        :class="[
          'flex h-7 w-full min-w-0 items-center gap-1.5 px-2 text-left text-[12px] transition-colors',
          index === selectedIndex
            ? 'bg-accent text-foreground'
            : 'text-foreground/80 hover:bg-accent/50',
        ]"
        :title="hit.path"
        @mouseenter="selectedIndex = index"
        @click="selectHit(hit)"
      >
        <img
          :src="hit.is_dir ? folderIconUrl(hit.name, false) : fileIconUrl(hit.name)"
          alt=""
          class="size-3.5 shrink-0"
        />
        <span class="min-w-0 truncate">{{ hit.name }}</span>
        <span class="ml-auto min-w-0 truncate text-[10px] text-muted-foreground">
          {{ hit.rel }}
        </span>
      </button>
      <div
        v-if="truncated && results.length > 0"
        class="px-3 py-1.5 text-[10px] text-muted-foreground"
      >
        {{ t("explorer.partialResults") }}
      </div>
    </div>
  </div>
</template>
