<script setup lang="ts">
import { computed } from "vue";
import type { MarkdownTab, Tab } from "@/modules/tabs/tabsTypes";
import MarkdownPreviewPane from "./MarkdownPreviewPane.vue";

const props = defineProps<{
  tabs: Tab[];
  activeId: number;
}>();

const markdownTabs = computed(() =>
  props.tabs.filter((tab): tab is MarkdownTab => tab.kind === "markdown"),
);
</script>

<template>
  <div v-if="markdownTabs.length > 0" class="relative h-full w-full">
    <div
      v-for="tab in markdownTabs"
      :key="tab.id"
      class="absolute inset-0"
      :style="{
        visibility: tab.id === props.activeId ? 'visible' : 'hidden',
        pointerEvents: tab.id === props.activeId ? 'auto' : 'none',
      }"
      :aria-hidden="tab.id !== props.activeId"
    >
      <MarkdownPreviewPane
        :path="tab.path"
        :visible="tab.id === props.activeId"
      />
    </div>
  </div>
</template>
