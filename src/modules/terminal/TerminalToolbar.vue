<script setup lang="ts">
import {
  CloseOutline,
  DuplicateOutline,
  RefreshOutline,
  SearchOutline,
  TrashOutline,
} from "@vicons/ionicons5";
import { NIcon, NInput } from "naive-ui";
import { nextTick, ref } from "vue";
import TooltipTitle from "@/components/TooltipTitle.vue";
import { t } from "@/modules/i18n/translate";
import type { SplitDir } from "./lib/panes";
import type { SearchAddon } from "@xterm/addon-search";

defineProps<{
  leafId: number;
  paneCount: number;
}>();

const emit = defineEmits<{
  split: [dir: SplitDir];
  close: [];
  clear: [];
  reset: [];
}>();

const searchVisible = ref(false);
const searchQuery = ref("");
const searchInput = ref<InstanceType<typeof NInput> | null>(null);
let searchAddonRef: SearchAddon | null = null;

function toggleSearch() {
  searchVisible.value = !searchVisible.value;
  if (searchVisible.value) {
    nextTick(() => searchInput.value?.focus());
  } else {
    searchQuery.value = "";
    if (searchAddonRef) searchAddonRef.clearDecorations();
  }
}

function handleSearch() {
  if (!searchAddonRef || !searchQuery.value) return;
  searchAddonRef.findNext(searchQuery.value);
}

function handleSearchPrev() {
  if (!searchAddonRef || !searchQuery.value) return;
  searchAddonRef.findPrevious(searchQuery.value);
}

</script>

<template>
  <div
    class="absolute inset-x-0 top-0 z-10 flex items-center gap-1 bg-panel-bg/90 px-2 py-1 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100"
    @mouseenter="$el.parentElement?.classList.add('force-show')"
  >
    <div class="flex items-center gap-0.5">
      <TooltipTitle :label="t('commands.items.clearTerminal')">
        <button
          type="button"
          class="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          @click="emit('clear')"
        >
          <NIcon :component="TrashOutline" :size="13" />
        </button>
      </TooltipTitle>
      <TooltipTitle :label="t('commands.items.resetTerminal')">
        <button
          type="button"
          class="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          @click="emit('reset')"
        >
          <NIcon :component="RefreshOutline" :size="13" />
        </button>
      </TooltipTitle>
    </div>

    <div class="flex-1" />

    <div class="flex items-center gap-0.5">
      <TooltipTitle :label="t('app.header.splitRight')">
        <button
          type="button"
          class="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          @click="emit('split', 'row')"
        >
          <NIcon :component="DuplicateOutline" :size="13" />
        </button>
      </TooltipTitle>
      <TooltipTitle :label="t('app.header.splitDown')">
        <button
          type="button"
          class="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          @click="emit('split', 'col')"
        >
          <NIcon
            :component="DuplicateOutline"
            :size="13"
            class="rotate-90"
          />
        </button>
      </TooltipTitle>
      <TooltipTitle :label="t('app.header.openCommandCenter')">
        <button
          type="button"
          class="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          :class="searchVisible ? 'bg-accent text-foreground' : ''"
          @click="toggleSearch"
        >
          <NIcon :component="SearchOutline" :size="13" />
        </button>
      </TooltipTitle>
      <TooltipTitle v-if="paneCount > 1" :label="t('app.header.closeTab')">
        <button
          type="button"
          class="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
          @click="emit('close')"
        >
          <NIcon :component="CloseOutline" :size="13" />
        </button>
      </TooltipTitle>
    </div>

    <!-- Inline search bar -->
    <div
      v-if="searchVisible"
      class="absolute inset-x-0 top-full flex items-center gap-1 bg-panel-bg/90 px-2 py-1 backdrop-blur-sm"
    >
      <NInput
        ref="searchInput"
        v-model:value="searchQuery"
        size="tiny"
        :placeholder="t('app.header.openCommandCenter')"
        class="flex-1"
        @keyup.enter="handleSearch"
      />
      <button
        type="button"
        class="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        @click="handleSearchPrev"
      >
        <span class="text-[10px]">↑</span>
      </button>
      <button
        type="button"
        class="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        @click="handleSearch"
      >
        <span class="text-[10px]">↓</span>
      </button>
    </div>
  </div>
</template>
