<script setup lang="ts">
import { computed } from "vue";
import type { Tab, TerminalTab } from "@/modules/tabs/tabsTypes";
import PaneTreeV2 from "./PaneTreeV2.vue";

const props = defineProps<{
  tabs: Tab[];
  activeId: number;
}>();

const emit = defineEmits<{
  focusLeaf: [tabId: number, leafId: number];
  cwd: [leafId: number, cwd: string];
  title: [leafId: number, title: string];
  exit: [tabId: number, code: number];
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
        @cwd="(leafId, cwd) => emit('cwd', leafId, cwd)"
        @title="(leafId, title) => emit('title', leafId, title)"
        @exit="(_leafId, code) => emit('exit', tab.id, code)"
      />
    </div>
  </div>
</template>
