<script setup lang="ts">
/**
 * 统一的「搜索 / 过滤」抽屉。
 *
 * 背景：工具栏一行同时挂着「搜索文件」「在文件中查找」「过滤当前视图」三个
 * 搜索类入口（2 个按钮 + 1 个 160px 常驻输入框），在 240px 的最窄面板下
 * 必然把根目录名挤没。这里把三者收进一个分段面板，工具栏只留一个 🔍 入口。
 *
 * 三段的语义差异决定了树的显隐：
 * - `files`   全工作区按文件名搜 → 出结果列表，树让位
 * - `content` 全工作区按内容搜 → 出结果列表，树让位
 * - `filter`  只过滤已加载的树   → 不出结果列表，树继续在下方显示并被过滤
 */
import { CloseOutline, SearchOutline } from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import { computed, nextTick, ref, watch } from "vue";
import { t, type MessageKey } from "@/modules/i18n/translate";
import { FindInFilesPanel } from "@/modules/search";
import ExplorerSearch from "./ExplorerSearch.vue";
import type { ExplorerSearchMode } from "./explorerTypes";

const props = defineProps<{
  rootPath: string;
  mode: ExplorerSearchMode;
  filter: string;
}>();

const emit = defineEmits<{
  "update:mode": [mode: ExplorerSearchMode];
  "update:filter": [value: string];
  requestClose: [];
  openFile: [path: string, pin: boolean];
  openSearchResult: [path: string, line: number];
}>();

const SEGMENTS: Array<{ key: ExplorerSearchMode; labelKey: MessageKey }> = [
  { key: "files", labelKey: "explorer.searchSegmentFiles" },
  { key: "content", labelKey: "explorer.searchSegmentContent" },
  { key: "filter", labelKey: "explorer.searchSegmentFilter" },
];

const filterInputRef = ref<HTMLInputElement | null>(null);

/** 过滤段不产生结果列表，面板只占输入框那一行，树继续吃满剩余高度。 */
const rootClass = computed(() =>
  props.mode === "filter" ? "shrink-0" : "min-h-0 flex-1",
);

function selectMode(mode: ExplorerSearchMode) {
  emit("update:mode", mode);
}

function onFilterKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  // 有内容时先清空，再按一次才关面板——和 ExplorerSearch 的 Esc 语义对齐。
  if (props.filter) emit("update:filter", "");
  else emit("requestClose");
}

watch(
  () => [props.mode, props.rootPath] as const,
  ([mode, rootPath]) => {
    if (!rootPath) return;
    if (mode !== "filter") return;
    void nextTick(() => filterInputRef.value?.focus({ preventScroll: true }));
  },
  { immediate: true },
);
</script>

<template>
  <div
    data-explorer-search-panel
    class="flex flex-col border-b border-border/60"
    :class="rootClass"
  >
    <!-- 分段条：三个搜索入口的唯一落点，视觉沿用面板头部的「文件树 / 更改」 -->
    <div class="nexterm-toolbar flex h-8 shrink-0 items-center gap-1.5 px-2">
      <div
        class="flex min-w-0 flex-1 items-center gap-0.5 rounded-lg bg-surface-subtle p-0.5"
        role="tablist"
        data-explorer-search-segments
      >
        <button
          v-for="segment in SEGMENTS"
          :key="segment.key"
          type="button"
          role="tab"
          :data-search-mode="segment.key"
          :aria-selected="mode === segment.key"
          class="flex h-6 min-w-0 flex-1 items-center justify-center rounded-md px-1 text-[11.5px] transition-colors duration-[var(--dur-fast)]"
          :class="
            mode === segment.key
              ? 'bg-background text-foreground shadow-[0_0_0_1px_var(--border)]'
              : 'text-muted-foreground hover:text-foreground'
          "
          @click="selectMode(segment.key)"
        >
          <span class="truncate">{{ t(segment.labelKey) }}</span>
        </button>
      </div>
      <button
        type="button"
        data-search-close
        :aria-label="t('explorer.closeSearchPanel')"
        :title="t('explorer.closeSearchPanel')"
        class="grid size-5 shrink-0 place-items-center rounded text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:bg-accent hover:text-foreground"
        @click="emit('requestClose')"
      >
        <NIcon :component="CloseOutline" :size="12" />
      </button>
    </div>

    <!-- files / content 段：结果列表接管整块区域 -->
    <ExplorerSearch
      v-if="mode === 'files'"
      :root-path="rootPath"
      :open="true"
      @request-close="emit('requestClose')"
      @open-file="(path, pin) => emit('openFile', path, pin)"
    />
    <FindInFilesPanel
      v-else-if="mode === 'content'"
      :root-path="rootPath"
      @open-result="(path, line) => emit('openSearchResult', path, line)"
    />

    <!-- filter 段：只有一行输入框，下方的文件树继续显示并被过滤 -->
    <div v-else class="relative shrink-0 px-2 py-1.5">
      <NIcon
        :component="SearchOutline"
        :size="13"
        class="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref="filterInputRef"
        :value="filter"
        type="text"
        data-tree-filter-input
        :placeholder="t('explorer.filterTreePlaceholder')"
        class="h-7 w-full rounded-md border border-border bg-background px-7 text-[12px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
        @input="emit('update:filter', ($event.target as HTMLInputElement).value)"
        @keydown="onFilterKeydown"
      />
      <button
        v-if="filter"
        type="button"
        data-clear-tree-filter
        :aria-label="t('explorer.clearSearch')"
        class="absolute right-3.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        @click="emit('update:filter', '')"
      >
        <NIcon :component="CloseOutline" :size="11" />
      </button>
    </div>
  </div>
</template>
