<script setup lang="ts">
import type { SearchAddon } from "@xterm/addon-search";
import { computed } from "vue";
import type { Tab, TerminalTab } from "@/modules/tabs/tabsTypes";
import PaneTreeV2 from "./PaneTreeV2.vue";

const props = defineProps<{
  tabs: Tab[];
  activeId: number;
}>();

const emit = defineEmits<{
  focusLeaf: [tabId: number, leafId: number];
  searchReady: [leafId: number, addon: SearchAddon];
  cwd: [leafId: number, cwd: string];
  title: [leafId: number, title: string];
  exit: [leafId: number, code: number];
  split: [tabId: number, leafId: number, dir: "row" | "col"];
  close: [tabId: number, leafId: number];
}>();

const terminalTabs = computed(() =>
  props.tabs.filter((tab): tab is TerminalTab => tab.kind === "terminal"),
);
</script>

<template>
  <div class="relative h-full w-full">
    <div
      v-for="tab in terminalTabs"
      :key="tab.id"
      data-terminal-tab
      class="absolute inset-0"
      :style="{
        visibility: tab.id === activeId ? 'visible' : 'hidden',
        pointerEvents: tab.id === activeId ? 'auto' : 'none',
      }"
      :aria-hidden="tab.id !== activeId"
    >
      <PaneTreeV2
        :node="tab.paneTree"
        :tab-visible="tab.id === activeId"
        :active-leaf-id="tab.activeLeafId"
        :tab-id="tab.id"
        @focus-leaf="(leafId) => emit('focusLeaf', tab.id, leafId)"
        @search-ready="(leafId, addon) => emit('searchReady', leafId, addon)"
        @cwd="(leafId, cwd) => emit('cwd', leafId, cwd)"
        @title="(leafId, title) => emit('title', leafId, title)"
        @exit="(_leafId, code) => emit('exit', tab.id, code)"
        @split="(leafId, dir) => emit('split', tab.id, leafId, dir)"
        @close="(leafId) => emit('close', tab.id, leafId)"
      />
    </div>
  </div>
</template>
