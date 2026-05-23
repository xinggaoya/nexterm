<script setup lang="ts">
import {
  DocumentOutline,
  FlashOutline,
  SearchOutline,
} from "@vicons/ionicons5";
import { NIcon, NSpin } from "naive-ui";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { IS_MAC } from "@/lib/platform";
import { fileIconUrl, folderIconUrl } from "@/modules/explorer/lib/iconResolver";
import {
  searchFileTree,
  type SearchHit,
} from "@/modules/explorer/lib/fileTreeService";
import { t } from "@/modules/i18n/translate";
import { formatKeybinding } from "./keybindings";
import { filterCommands } from "./registry";
import type {
  CommandContext,
  CommandDefinition,
  CommandId,
  ResolvedKeybindings,
} from "./types";

export type CommandPaletteMode = "commands" | "files";

const props = withDefaults(
  defineProps<{
    show: boolean;
    mode: CommandPaletteMode;
    commands: CommandDefinition[];
    keybindings: Partial<ResolvedKeybindings>;
    context: CommandContext;
    workspaceRoot: string | null;
    showHidden: boolean;
    searchDelayMs?: number;
  }>(),
  {
    searchDelayMs: 160,
  },
);

const emit = defineEmits<{
  close: [];
  executeCommand: [id: CommandId];
  openFile: [path: string];
}>();

type Result =
  | { kind: "command"; command: CommandDefinition }
  | { kind: "file"; hit: SearchHit };

const inputRef = ref<HTMLInputElement | null>(null);
const query = ref("");
const selectedIndex = ref(0);
const fileResults = ref<SearchHit[]>([]);
const searchingFiles = ref(false);
const fileSearchError = ref<string | null>(null);
const fileResultsTruncated = ref(false);
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let searchRequestId = 0;

const title = computed(() =>
  props.mode === "files"
    ? t("commands.quickOpenTitle")
    : t("commands.commandCenterTitle"),
);

const placeholder = computed(() =>
  props.mode === "files"
    ? t("commands.searchFiles")
    : t("commands.searchCommands"),
);

const commandResults = computed(() =>
  props.mode === "commands"
    ? filterCommands(props.commands, query.value, props.context)
    : [],
);

const results = computed<Result[]>(() =>
  props.mode === "files"
    ? fileResults.value.map((hit) => ({ kind: "file", hit }))
    : commandResults.value.map((command) => ({ kind: "command", command })),
);

const showEmptyState = computed(
  () =>
    props.show &&
    !searchingFiles.value &&
    results.value.length === 0 &&
    (props.mode === "commands" || query.value.trim().length > 0),
);

function clearSearchTimer() {
  if (searchTimer) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
}

function resetState() {
  clearSearchTimer();
  query.value = "";
  selectedIndex.value = 0;
  fileResults.value = [];
  searchingFiles.value = false;
  fileSearchError.value = null;
  fileResultsTruncated.value = false;
  searchRequestId += 1;
}

function close() {
  emit("close");
}

function selectResult(result: Result | undefined) {
  if (!result) return;
  if (result.kind === "command") {
    emit("executeCommand", result.command.id);
    return;
  }
  if (!result.hit.is_dir) emit("openFile", result.hit.path);
}

function moveSelection(delta: number) {
  if (results.value.length === 0) return;
  selectedIndex.value =
    (selectedIndex.value + delta + results.value.length) % results.value.length;
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveSelection(1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    moveSelection(-1);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    selectResult(results.value[selectedIndex.value]);
  }
}

async function runFileSearch(requestId: number, nextQuery: string) {
  const root = props.workspaceRoot;
  if (!root) {
    searchingFiles.value = false;
    fileResults.value = [];
    fileResultsTruncated.value = false;
    return;
  }
  try {
    const result = await searchFileTree(root, nextQuery, props.showHidden);
    if (requestId !== searchRequestId) return;
    fileResults.value = result.hits;
    fileResultsTruncated.value = result.truncated;
    selectedIndex.value = 0;
  } catch (error) {
    if (requestId !== searchRequestId) return;
    fileSearchError.value =
      error instanceof Error ? error.message : String(error);
    fileResults.value = [];
    fileResultsTruncated.value = false;
  } finally {
    if (requestId === searchRequestId) searchingFiles.value = false;
  }
}

watch(
  () => props.show,
  (show) => {
    if (!show) {
      resetState();
      return;
    }
    void nextTick(() => inputRef.value?.focus({ preventScroll: true }));
  },
  { immediate: true },
);

watch(
  () => props.mode,
  () => {
    resetState();
    if (props.show) void nextTick(() => inputRef.value?.focus({ preventScroll: true }));
  },
);

watch(
  [query, () => props.workspaceRoot, () => props.showHidden, () => props.mode],
  ([nextQuery]) => {
    if (!props.show || props.mode !== "files") return;
    clearSearchTimer();
    fileSearchError.value = null;
    const trimmed = nextQuery.trim();
    if (!trimmed) {
      fileResults.value = [];
      fileResultsTruncated.value = false;
      searchingFiles.value = false;
      selectedIndex.value = 0;
      return;
    }
    const currentId = ++searchRequestId;
    searchingFiles.value = true;
    if (props.searchDelayMs <= 0) {
      void runFileSearch(currentId, trimmed);
      return;
    }
    searchTimer = setTimeout(() => {
      void runFileSearch(currentId, trimmed);
    }, props.searchDelayMs);
  },
);

watch(results, () => {
  if (selectedIndex.value >= results.value.length) selectedIndex.value = 0;
});

onBeforeUnmount(clearSearchTimer);
</script>

<template>
  <div
    v-if="show"
    data-command-palette
    class="fixed inset-0 z-40 flex items-start justify-center bg-black/30 px-4 pt-[12vh] backdrop-blur-[2px]"
    @mousedown.self="close"
  >
    <section
      class="flex max-h-[70vh] w-full max-w-170 flex-col overflow-hidden rounded-lg border border-border/70 bg-card text-foreground shadow-2xl ring-1 ring-black/10"
      role="dialog"
      :aria-label="title"
    >
      <header class="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <NIcon
          :component="mode === 'files' ? DocumentOutline : FlashOutline"
          :size="16"
          class="text-muted-foreground"
        />
        <input
          ref="inputRef"
          v-model="query"
          data-command-palette-input
          class="h-8 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          :placeholder="placeholder"
          @keydown="handleKeydown"
        />
        <kbd
          class="rounded border border-border/70 bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
        >
          Esc
        </kbd>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto py-1">
        <div
          v-if="mode === 'files' && searchingFiles && results.length === 0"
          class="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground"
        >
          <NSpin size="small" />
          <span>{{ t("commands.searchingFiles") }}</span>
        </div>

        <div
          v-else-if="showEmptyState"
          class="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground"
        >
          <NIcon :component="SearchOutline" :size="14" />
          <span>
            {{
              fileSearchError ||
              (mode === "files"
                ? t("commands.noFilesFound")
                : t("commands.noCommandsFound"))
            }}
          </span>
        </div>

        <button
          v-for="(result, index) in results"
          v-else
          :key="result.kind === 'command' ? result.command.id : result.hit.path"
          type="button"
          :data-command-result="result.kind === 'command' ? result.command.id : undefined"
          :data-file-result="result.kind === 'file' ? result.hit.path : undefined"
          :class="[
            'flex h-10 w-full min-w-0 items-center gap-2 px-3 text-left transition-colors',
            index === selectedIndex
              ? 'bg-accent text-foreground'
              : 'text-foreground/85 hover:bg-accent/60 hover:text-foreground',
          ]"
          @mouseenter="selectedIndex = index"
          @click="selectResult(result)"
        >
          <template v-if="result.kind === 'command'">
            <NIcon :component="FlashOutline" :size="15" class="shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1 truncate text-sm">
              {{ result.command.title }}
            </span>
            <span class="shrink-0 text-[11px] capitalize text-muted-foreground">
              {{ t(`commands.categories.${result.command.category}`) }}
            </span>
            <kbd
              v-if="formatKeybinding(keybindings[result.command.id], IS_MAC)"
              class="shrink-0 rounded border border-border/70 bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {{ formatKeybinding(keybindings[result.command.id], IS_MAC) }}
            </kbd>
          </template>

          <template v-else>
            <img
              :src="result.hit.is_dir ? folderIconUrl(result.hit.name, false) : fileIconUrl(result.hit.name)"
              alt=""
              class="size-4 shrink-0"
            />
            <span class="min-w-0 flex-1 truncate text-sm">{{ result.hit.name }}</span>
            <span class="min-w-0 truncate text-[11px] text-muted-foreground">
              {{ result.hit.rel }}
            </span>
          </template>
        </button>

        <div
          v-if="mode === 'files' && fileResultsTruncated && results.length > 0"
          class="px-3 py-1.5 text-[10px] text-muted-foreground"
        >
          {{ t("commands.partialFileResults") }}
        </div>
      </div>
    </section>
  </div>
</template>
