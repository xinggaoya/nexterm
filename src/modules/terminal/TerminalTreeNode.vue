<script setup lang="ts">
import type { PaneNode, PaneSplit, SplitDir, LeafId } from "./lib/layout";
import type { TerminalTab } from "@/modules/tabs/tabsTypes";
import { MAX_PANES_PER_TAB } from "@/modules/tabs/tabsTypes";
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
  /** 请求重命名某条分屏的标题（复用宿主的 RenameTerminalDialog）。 */
  rename: [leafId: LeafId];
  /**
   * 拖动把手。`childLeafId` 是把手左侧那块的 leaf（用于定位所属分屏节点），
   * `delta` / `containerSize` 交给 store 换算成 flex 权重。
   */
  resize: [childLeafId: LeafId, delta: number, containerSize: number];
  reset: [childLeafId: LeafId];
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

/** 只有这一条分屏时，关掉它等于关掉整个标签。 */
function onlyPane(leafId: LeafId): boolean {
  if (!props.tab) return true;
  // 没有分屏节点包裹的根 leaf 必然是唯一分屏。
  return props.tab.paneTree.kind === "leaf" && props.tab.paneTree.id === leafId;
}

function canSplit(): boolean {
  if (!props.tab) return false;
  // 分屏上限由 tab 级状态判定；每条分屏的标题栏都按同一个值决定是否显示
  // 分屏按钮，满了就整体消失（而不是逐条置灰）。
  return countLeaves(props.tab.paneTree) < MAX_PANES_PER_TAB;
}

function countLeaves(node: PaneNode): number {
  return node.kind === "leaf" ? 1 : node.children.reduce((n, c) => n + countLeaves(c), 0);
}

/** 把手左侧那块 leaf 的 id —— store 用它反查所属 split 节点。 */
function precedingLeafId(children: PaneNode[], index: number): LeafId | null {
  const child = children[index];
  return child ? lastLeafId(child) : null;
}

function lastLeafId(node: PaneNode): LeafId {
  if (node.kind === "leaf") return node.id;
  const last = node.children[node.children.length - 1];
  // split 节点恒有非空 children（layout.removeLeaf 维护了这条不变量），
  // 递归总能落到一个 leaf 上。
  return lastLeafId(last!);
}

// 模板里 node 已被 v-else / v-for 收窄成 split 分支，但 TS 看不到；
// 显式断言一次以拿到 children。
function splitNode(): PaneSplit {
  return props.node as PaneSplit;
}

/** row 容器左右排布 → 把手是竖的（col）；col 容器上下排布 → 把手是横的。 */
function dirOf(): "row" | "col" {
  return splitNode().dir === "row" ? "col" : "row";
}

function onResize(index: number, payload: [number, number]): void {
  const anchor = precedingLeafId(splitNode().children, index);
  if (anchor !== null) emit("resize", anchor, payload[0], payload[1]);
}

function onReset(index: number): void {
  const anchor = precedingLeafId(splitNode().children, index);
  if (anchor !== null) emit("reset", anchor);
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
    :only-pane="onlyPane(node.id)"
    :can-split="canSplit()"
    @cwd="(c: string) => emit('cwd', node.id, c)"
    @title="(t: string) => emit('title', node.id, t)"
    @focus="emit('focus', node.id)"
    @close="emit('close', node.id)"
    @split="(d: 'row' | 'col') => emit('split', d)"
    @rename="emit('rename', node.id)"
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
        @rename="(id: LeafId) => emit('rename', id)"
        @resize="(id: LeafId, d: number, s: number) => emit('resize', id, d, s)"
        @reset="(id: LeafId) => emit('reset', id)"
      />
      <TerminalResizer
        v-if="idx < node.children.length - 1"
        :dir="dirOf()"
        :size="flexValue(child.size)"
        @resize="(delta: number, containerSize: number) => onResize(idx, [delta, containerSize])"
        @reset="onReset(idx)"
      />
    </template>
  </div>
</template>
