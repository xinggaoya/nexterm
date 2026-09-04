<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import type { FilePreviewTab, Tab } from "@/modules/tabs/tabsTypes";
const FilePreviewPane = defineAsyncComponent(() => import("./FilePreviewPane.vue"));

const props = defineProps<{
  tabs: Tab[];
  activeId: number;
}>();

const filePreviewTabs = computed(() =>
  props.tabs.filter((tab): tab is FilePreviewTab => tab.kind === "file-preview"),
);
</script>

<template>
  <div v-if="filePreviewTabs.length > 0" class="relative h-full w-full">
    <div
      v-for="tab in filePreviewTabs"
      :key="tab.id"
      class="absolute inset-0"
      :style="{
        visibility: tab.id === props.activeId ? 'visible' : 'hidden',
        pointerEvents: tab.id === props.activeId ? 'auto' : 'none',
      }"
      :aria-hidden="tab.id !== props.activeId"
    >
      <FilePreviewPane
        :path="tab.path"
        :visible="tab.id === props.activeId"
      />
    </div>
  </div>
</template>
