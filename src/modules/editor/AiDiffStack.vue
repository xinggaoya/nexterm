<script setup lang="ts">
import { computed } from "vue";
import type { AiDiffTab, Tab } from "@/modules/tabs/tabsTypes";
import AiDiffPane from "./AiDiffPane.vue";

const props = defineProps<{
  tabs: Tab[];
  activeId: number;
}>();

const emit = defineEmits<{
  accept: [approvalId: string];
  reject: [approvalId: string];
}>();

const active = computed(() =>
  props.tabs.find(
    (tab): tab is AiDiffTab =>
      tab.kind === "ai-diff" && tab.id === props.activeId,
  ),
);
</script>

<template>
  <div v-if="active" class="h-full w-full">
    <AiDiffPane
      :key="active.id"
      :path="active.path"
      :original-content="active.originalContent"
      :proposed-content="active.proposedContent"
      :status="active.status"
      :is-new-file="active.isNewFile"
      @accept="emit('accept', active.approvalId)"
      @reject="emit('reject', active.approvalId)"
    />
  </div>
</template>
