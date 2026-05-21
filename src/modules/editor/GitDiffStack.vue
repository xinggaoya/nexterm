<script setup lang="ts">
import { computed } from "vue";
import type {
  GitCommitFileDiffTab,
  GitDiffTab,
  Tab,
} from "@/modules/tabs/tabsTypes";
import GitDiffPane from "./GitDiffPane.vue";

const props = defineProps<{
  tabs: Tab[];
  activeId: number;
}>();

const active = computed(() =>
  props.tabs.find(
    (tab): tab is GitDiffTab | GitCommitFileDiffTab =>
      (tab.kind === "git-diff" || tab.kind === "git-commit-file") &&
      tab.id === props.activeId,
  ),
);
</script>

<template>
  <div v-if="active" class="h-full w-full">
    <GitDiffPane
      v-if="active.kind === 'git-diff'"
      :key="active.id"
      :active="true"
      :source="{
        kind: 'working',
        repoRoot: active.repoRoot,
        path: active.path,
        mode: active.mode,
        originalPath: active.originalPath,
      }"
    />
    <GitDiffPane
      v-else
      :key="active.id"
      :active="true"
      :source="{
        kind: 'commit',
        repoRoot: active.repoRoot,
        sha: active.sha,
        path: active.path,
        originalPath: active.originalPath,
      }"
      :chip-label="active.shortSha"
    />
  </div>
</template>
