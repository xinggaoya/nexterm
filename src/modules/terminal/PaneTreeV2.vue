<script setup lang="ts">
import type { SearchAddon } from "@xterm/addon-search";
import { computed } from "vue";
import type { PaneNode } from "./lib/panes";
import { leafIds } from "./lib/panes";
import TerminalPane from "./TerminalPane.vue";
import TerminalToolbar from "./TerminalToolbar.vue";

const props = defineProps<{
  node: PaneNode;
  tabVisible: boolean;
  activeLeafId: number;
  tabId: number;
}>();

const emit = defineEmits<{
  focusLeaf: [leafId: number];
  searchReady: [leafId: number, addon: SearchAddon];
  cwd: [leafId: number, cwd: string];
  title: [leafId: number, title: string];
  exit: [leafId: number, code: number];
  split: [leafId: number, dir: "row" | "col"];
  close: [leafId: number];
}>();

const paneCount = computed(() => leafIds(props.node).length);

function focusLeaf(leafId: number) {
  if (leafId !== props.activeLeafId) emit("focusLeaf", leafId);
}

function handleSplit(leafId: number, dir: "row" | "col") {
  emit("split", leafId, dir);
}

function handleClose(leafId: number) {
  emit("close", leafId);
}
</script>

<template>
  <!-- Leaf node: terminal pane with hover toolbar -->
  <div
    v-if="node.kind === 'leaf'"
    :data-pane-leaf="node.id"
    class="group relative h-full w-full"
    @mousedown.capture="focusLeaf(node.id)"
    @focus="focusLeaf(node.id)"
  >
    <TerminalToolbar
      :leaf-id="node.id"
      :pane-count="paneCount"
      @split="(dir) => handleSplit(node.id, dir)"
      @close="handleClose(node.id)"
      @clear="() => {}"
      @reset="() => {}"
    />
    <TerminalPane
      :leaf-id="node.id"
      :visible="tabVisible"
      :focused="node.id === activeLeafId"
      :initial-cwd="node.cwd"
      :startup-input="node.startupInput"
      @search-ready="(leafId, addon) => emit('searchReady', leafId, addon)"
      @cwd="(leafId, cwd) => emit('cwd', leafId, cwd)"
      @title="(leafId, title) => emit('title', leafId, title)"
      @exit="(leafId, code) => emit('exit', leafId, code)"
    />
  </div>

  <!-- Split node: flex container with resizable panes -->
  <div
    v-else
    class="flex h-full w-full min-h-0 min-w-0"
    :style="{ flexDirection: node.dir === 'row' ? 'row' : 'column' }"
  >
    <template v-for="(child, index) in node.children" :key="child.id">
      <!-- Resizer handle between panes -->
      <div
        v-if="index > 0"
        :class="[
          'shrink-0 transition-colors',
          node.dir === 'row'
            ? 'w-1 cursor-col-resize bg-pane-handle hover:bg-pane-handle-active'
            : 'h-1 cursor-row-resize bg-pane-handle hover:bg-pane-handle-active',
        ]"
      />
      <div class="min-h-0 min-w-0 flex-1">
        <PaneTreeV2
          :node="child"
          :tab-visible="tabVisible"
          :active-leaf-id="activeLeafId"
          :tab-id="tabId"
          @focus-leaf="(leafId) => emit('focusLeaf', leafId)"
          @search-ready="(leafId, addon) => emit('searchReady', leafId, addon)"
          @cwd="(leafId, cwd) => emit('cwd', leafId, cwd)"
          @title="(leafId, title) => emit('title', leafId, title)"
          @exit="(leafId, code) => emit('exit', leafId, code)"
          @split="(leafId, dir) => emit('split', leafId, dir)"
          @close="(leafId) => emit('close', leafId)"
        />
      </div>
    </template>
  </div>
</template>
