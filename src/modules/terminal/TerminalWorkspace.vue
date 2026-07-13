<script setup lang="ts">
import { computed } from "vue";
import { useTabsPiniaStore } from "@/modules/tabs/tabsPinia";
import type { TerminalTab } from "@/modules/tabs/tabsTypes";
import TerminalTreeNode from "./TerminalTreeNode.vue";

const props = defineProps<{
  tab: TerminalTab | null;
  isActive: boolean;
}>();

const tabsStore = useTabsPiniaStore();

const tree = computed(() => props.tab?.paneTree ?? null);

function splitActive(dir: "row" | "col") {
  if (!props.tab) return;
  tabsStore.splitActivePane(props.tab.id, dir);
}

function closeLeaf(leafId: string | number) {
  if (!props.tab) return;
  tabsStore.closeLeafInTab(props.tab.id, leafId as number);
}

function focusLeaf(leafId: string | number) {
  if (!props.tab) return;
  tabsStore.focusPane(props.tab.id, leafId as number);
}

function updateCwd(leafId: string | number, cwd: string) {
  tabsStore.setLeafCwd(leafId as number, cwd);
}

function updateTitle(leafId: string | number, title: string) {
  tabsStore.setLeafTitle(leafId as number, title);
}
</script>

<template>
  <div v-if="tree" class="terminal-workspace h-full w-full overflow-hidden">
    <TerminalTreeNode
      :node="tree"
      :tab="tab"
      :is-active="isActive"
      @cwd="updateCwd"
      @title="updateTitle"
      @focus="focusLeaf"
      @close="closeLeaf"
      @split="splitActive"
    />
  </div>
</template>
