<script setup lang="ts">
import type { PaneNode } from "./lib/panes";
import TerminalPane from "./TerminalPane.vue";

const props = defineProps<{
  node: PaneNode;
  tabVisible: boolean;
  activeLeafId: number;
  tabId: number;
}>();

const emit = defineEmits<{
  focusLeaf: [leafId: number];
  cwd: [leafId: number, cwd: string];
  title: [leafId: number, title: string];
  exit: [leafId: number, code: number];
}>();

function focusLeaf(leafId: number) {
  if (leafId !== props.activeLeafId) emit("focusLeaf", leafId);
}

</script>

<template>
  <!-- Leaf node: terminal pane -->
  <div
    v-if="node.kind === 'leaf'"
    :data-pane-leaf="node.id"
    class="group relative h-full w-full"
    @mousedown.capture="focusLeaf(node.id)"
    @focus="focusLeaf(node.id)"
  >
    <TerminalPane
      :leaf-id="node.id"
      :visible="tabVisible"
      :focused="node.id === activeLeafId"
      :initial-cwd="node.cwd"
      :startup-input="node.startupInput"
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
            ? 'w-0.5 cursor-col-resize bg-pane-handle hover:bg-pane-handle-active'
            : 'h-0.5 cursor-row-resize bg-pane-handle hover:bg-pane-handle-active',
        ]"
      />

      <div class="min-h-0 min-w-0 flex-1">
        <PaneTreeV2
          :node="child"
          :tab-visible="tabVisible"
          :active-leaf-id="activeLeafId"
          :tab-id="tabId"
          @focus-leaf="(leafId) => emit('focusLeaf', leafId)"
          @cwd="(leafId, cwd) => emit('cwd', leafId, cwd)"
          @title="(leafId, title) => emit('title', leafId, title)"
          @exit="(leafId, code) => emit('exit', leafId, code)"
        />
      </div>
    </template>
  </div>
</template>
