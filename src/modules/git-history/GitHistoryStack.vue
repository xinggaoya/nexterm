<script setup lang="ts">
import { computed } from "vue";
import type { GitCommitFileDiffTab, GitHistoryTab, Tab } from "@/modules/tabs/tabsTypes";
import GitHistoryPane from "./GitHistoryPane.vue";

const props = defineProps<{
  tabs: Tab[];
  activeId: number;
}>();

const emit = defineEmits<{
  openCommitFile: [
    input: Pick<
      GitCommitFileDiffTab,
      "repoRoot" | "sha" | "shortSha" | "subject" | "path" | "originalPath"
    >,
  ];
}>();

const active = computed(() =>
  props.tabs.find(
    (tab): tab is GitHistoryTab =>
      tab.kind === "git-history" && tab.id === props.activeId,
  ),
);
</script>

<template>
  <div v-if="active" class="h-full w-full">
    <GitHistoryPane
      :key="active.id"
      :repo-root="active.repoRoot"
      @open-commit-file="(input) => emit('openCommitFile', input)"
    />
  </div>
</template>
