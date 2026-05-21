<script setup lang="ts">
import { computed } from "vue";
import type { PreviewTab, Tab } from "@/modules/tabs/tabsTypes";
import PreviewPane from "./PreviewPane.vue";

const props = defineProps<{
  tabs: Tab[];
  activeId: number;
}>();

const emit = defineEmits<{
  urlChange: [id: number, url: string];
}>();

const previewTabs = computed(() =>
  props.tabs.filter((tab): tab is PreviewTab => tab.kind === "preview"),
);
</script>

<template>
  <div v-if="previewTabs.length > 0" class="relative h-full w-full">
    <div
      v-for="tab in previewTabs"
      :key="tab.id"
      class="absolute inset-0"
      :style="{
        visibility: tab.id === props.activeId ? 'visible' : 'hidden',
        pointerEvents: tab.id === props.activeId ? 'auto' : 'none',
      }"
      :aria-hidden="tab.id !== props.activeId"
    >
      <PreviewPane
        :url="tab.url"
        :visible="tab.id === props.activeId"
        @url-change="(url) => emit('urlChange', tab.id, url)"
      />
    </div>
  </div>
</template>
