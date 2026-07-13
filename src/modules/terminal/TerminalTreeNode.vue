<script setup lang="ts">
import type { PaneNode, SplitDir, LeafId } from "./lib/layout";
import type { TerminalTab } from "@/modules/tabs/tabsTypes";
import TerminalPane from "./TerminalPane.vue";
import TerminalResizer from "./TerminalResizer.vue";

defineOptions({ name: "TerminalTreeNode" });

const props = defineProps<{
  node: PaneNode;
  tab: TerminalTab | null;
  isActive: boolean;
}>();

const emit = defineEmits<{
  cwd: [leafId: LeafId, cwd: string];
  title: [leafId: LeafId, title: string];
  focus: [leafId: LeafId];
  close: [leafId: LeafId];
  split: [dir: SplitDir];
}>();

function isFocused(leafId: LeafId): boolean {
  return props.tab?.activeLeafId === leafId;
}

function isPaneActive(leafId: LeafId): boolean {
  return props.isActive && isFocused(leafId);
}

function flexValue(size: number | undefined): number {
  return size ?? 1;
}
</script>

<template>
  <TerminalPane
    v-if="node.kind === 'leaf'"
    :leaf-id="node.id.toString()"
    :cwd="node.cwd"
    :title="node.terminalTitle"
    :is-active="isPaneActive(node.id)"
    :is-focused="isFocused(node.id)"
    :flex="flexValue(node.size)"
    @cwd="(c: string) => emit('cwd', node.id, c)"
    @title="(t: string) => emit('title', node.id, t)"
    @focus="emit('focus', node.id)"
    @close="emit('close', node.id)"
    @split="(d: 'row' | 'col') => emit('split', d)"
  />
  <div
    v-else
    class="flex h-full w-full"
    :class="node.dir === 'row' ? 'flex-row' : 'flex-col'"
    :style="{ flex: flexValue(node.size) }"
  >
    <template v-for="(child, idx) in node.children" :key="child.id">
      <TerminalTreeNode
        :node="child"
        :tab="tab"
        :is-active="isActive"
        @cwd="(id: LeafId, c: string) => emit('cwd', id, c)"
        @title="(id: LeafId, t: string) => emit('title', id, t)"
        @focus="(id: LeafId) => emit('focus', id)"
        @close="(id: LeafId) => emit('close', id)"
        @split="(d: 'row' | 'col') => emit('split', d)"
      />
      <TerminalResizer
        v-if="idx < node.children.length - 1"
        :dir="node.dir === 'row' ? 'col' : 'row'"
        :size="flexValue(child.size)"
      />
    </template>
  </div>
</template>
