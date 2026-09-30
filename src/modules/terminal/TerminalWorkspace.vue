<script setup lang="ts">
import { computed } from "vue";
import { useTabsPiniaStore } from "@/modules/tabs/tabsPinia";
import type { TerminalTab } from "@/modules/tabs/tabsTypes";
import type { LeafId } from "./lib/layout";
import TerminalTreeNode from "./TerminalTreeNode.vue";

const props = defineProps<{
  tab: TerminalTab | null;
  isActive: boolean;
}>();

const emit = defineEmits<{
  /** 请求重命名某条分屏的标题（宿主持有 RenameTerminalDialog）。 */
  rename: [leafId: LeafId];
}>();

const tabsStore = useTabsPiniaStore();

const tree = computed(() => props.tab?.paneTree ?? null);

function splitActive(dir: "row" | "col") {
  if (!props.tab) return;
  tabsStore.splitActivePane(props.tab.id, dir);
}

function closeLeaf(leafId: LeafId) {
  if (!props.tab) return;
  tabsStore.closeLeafInTab(props.tab.id, leafId as number);
}

function focusLeaf(leafId: LeafId) {
  if (!props.tab) return;
  tabsStore.focusPane(props.tab.id, leafId as number);
}

function updateCwd(leafId: LeafId, cwd: string) {
  tabsStore.setLeafCwd(leafId as number, cwd);
}

function updateTitle(leafId: LeafId, title: string) {
  tabsStore.setLeafTitle(leafId as number, title);
}

/**
 * 拖动分屏把手 → 调整相邻两块的比例。
 *
 * 这条链路此前是断的：`TerminalResizer` 有完整手势并 emit `resize`，但树里
 * 没有任何监听者，`resizeSplit` 也从未被调用 —— 把手画得出来、hover 有高亮，
 * 拖下去却什么都不发生。
 */
function resizePane(leafId: LeafId, delta: number, containerSize: number) {
  if (!props.tab) return;
  tabsStore.resizePane(props.tab.id, leafId as number, delta, containerSize);
}

/** 双击把手 → 该分屏恢复等分。 */
function resetPaneSizes(leafId: LeafId) {
  if (!props.tab) return;
  tabsStore.resetPaneSizes(props.tab.id, leafId as number);
}
</script>

<template>
  <div v-if="tree" class="terminal-workspace flex h-full w-full overflow-hidden">
    <TerminalTreeNode
      :node="tree"
      :tab="tab"
      :is-active="isActive"
      @cwd="updateCwd"
      @title="updateTitle"
      @focus="focusLeaf"
      @close="closeLeaf"
      @split="splitActive"
      @resize="resizePane"
      @reset="resetPaneSizes"
      @rename="(leafId: LeafId) => emit('rename', leafId)"
    />
  </div>
</template>
