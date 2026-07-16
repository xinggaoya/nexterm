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
  changeRef: [
    input: { tabId: number; refName: string | null; allRefs: boolean },
  ];
}>();

const active = computed<GitHistoryTab | null>(() => {
  const found = props.tabs.find(
    (tab): tab is GitHistoryTab =>
      tab.kind === "git-history" && tab.id === props.activeId,
  );
  if (!found) return null;
  // Apply defaults here so legacy or partial tab objects (e.g. those
  // constructed before refName/allRefs existed) still surface reasonable
  // values to the pane. Keeps the type contract honest even when the
  // store hasn't backfilled the fields yet.
  return {
    ...found,
    refName: found.refName ?? null,
    allRefs: found.allRefs ?? false,
  };
});

const paneKey = computed(() => {
  if (!active.value) return "";
  const tag = active.value.allRefs ? "all" : "single";
  const ref = active.value.refName ?? "HEAD";
  return `${active.value.id}-${ref}-${tag}`;
});

function onChangeRef(next: { refName: string | null; allRefs: boolean }) {
  if (!active.value) return;
  emit("changeRef", { tabId: active.value.id, ...next });
}
</script>

<template>
  <div v-if="active" class="h-full w-full">
    <GitHistoryPane
      :key="paneKey"
      :repo-root="active.repoRoot"
      :ref-name="active.refName"
      :all-refs="active.allRefs"
      @open-commit-file="(input) => emit('openCommitFile', input)"
      @change-ref="onChangeRef"
    />
  </div>
</template>
