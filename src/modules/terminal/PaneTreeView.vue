<script setup lang="ts">
import type { SearchAddon } from "@xterm/addon-search";
import type { PaneNode } from "./lib/panes";
import TerminalPane from "./TerminalPane.vue";

const props = defineProps<{
  node: PaneNode;
  tabVisible: boolean;
  activeLeafId: number;
}>();

const emit = defineEmits<{
  focusLeaf: [leafId: number];
  searchReady: [leafId: number, addon: SearchAddon];
  cwd: [leafId: number, cwd: string];
  title: [leafId: number, title: string];
  exit: [leafId: number, code: number];
}>();

function focusLeaf(leafId: number) {
  if (leafId !== props.activeLeafId) emit("focusLeaf", leafId);
}
</script>

<template>
  <div
    v-if="node.kind === 'leaf'"
    :data-pane-leaf="node.id"
    class="relative h-full w-full"
    @mousedown.capture="focusLeaf(node.id)"
    @focus="focusLeaf(node.id)"
  >
    <TerminalPane
      :leaf-id="node.id"
      :visible="tabVisible"
      :focused="node.id === activeLeafId"
      :initial-cwd="node.cwd"
      @search-ready="(leafId, addon) => emit('searchReady', leafId, addon)"
      @cwd="(leafId, cwd) => emit('cwd', leafId, cwd)"
      @title="(leafId, title) => emit('title', leafId, title)"
      @exit="(leafId, code) => emit('exit', leafId, code)"
    />
  </div>

  <div
    v-else
    :class="[
      'flex h-full w-full min-h-0 min-w-0',
      node.dir === 'row' ? 'flex-row' : 'flex-col',
    ]"
  >
    <template v-for="(child, index) in node.children" :key="child.id">
      <div
        v-if="index > 0"
        :class="[
          'shrink-0 bg-border/70',
          node.dir === 'row' ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize',
        ]"
      />
      <div class="min-h-0 min-w-0 flex-1">
        <PaneTreeView
          :node="child"
          :tab-visible="tabVisible"
          :active-leaf-id="activeLeafId"
          @focus-leaf="(leafId) => emit('focusLeaf', leafId)"
          @search-ready="(leafId, addon) => emit('searchReady', leafId, addon)"
          @cwd="(leafId, cwd) => emit('cwd', leafId, cwd)"
          @title="(leafId, title) => emit('title', leafId, title)"
          @exit="(leafId, code) => emit('exit', leafId, code)"
        />
      </div>
    </template>
  </div>
</template>
