<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{
  dir: "row" | "col";
  size: number;
}>();

const emit = defineEmits<{
  resize: [delta: number];
  reset: [];
}>();

const dragging = ref(false);
let startPos = 0;
let startSizeA = 0;
let startSizeB = 0;
let parent: HTMLElement | null = null;
let suppressClick = false;

function onMouseDown(event: MouseEvent) {
  event.preventDefault();
  suppressClick = false;
  dragging.value = true;
  startPos = props.dir === "col" ? event.clientX : event.clientY;
  parent = (event.currentTarget as HTMLElement).parentElement;
  if (!parent) return;
  const children = Array.from(parent.children) as HTMLElement[];
  if (children.length < 2) return;
  const [a, b] = findAdjacentPair(children, event.currentTarget as HTMLElement);
  startSizeA = props.dir === "col" ? a.getBoundingClientRect().width : a.getBoundingClientRect().height;
  startSizeB = props.dir === "col" ? b.getBoundingClientRect().width : b.getBoundingClientRect().height;
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);
  document.body.style.cursor = props.dir === "col" ? "col-resize" : "row-resize";
  document.body.style.userSelect = "none";
}

function findAdjacentPair(children: HTMLElement[], target: HTMLElement): [HTMLElement, HTMLElement] {
  const idx = children.indexOf(target);
  const left = children[idx - 1];
  const right = children[idx + 1];
  return [left ?? target, right ?? target];
}

function onMouseMove(event: MouseEvent) {
  if (!dragging.value || !parent) return;
  const current = props.dir === "col" ? event.clientX : event.clientY;
  const delta = current - startPos;
  startPos = current;
  const minSize = 60;
  if (startSizeA + delta < minSize || startSizeB - delta < minSize) {
    suppressClick = true;
    return;
  }
  emit("resize", delta);
  startSizeA += delta;
  startSizeB -= delta;
}

function onMouseUp() {
  dragging.value = false;
  document.removeEventListener("mousemove", onMouseMove);
  document.removeEventListener("mouseup", onMouseUp);
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
}

function onDoubleClick() {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  emit("reset");
}
</script>

<template>
  <div
    class="resizer"
    :class="[`resizer-${dir}`, { dragging }]"
    @mousedown="onMouseDown"
    @dblclick="onDoubleClick"
  />
</template>

<style scoped>
.resizer {
  position: relative;
  flex-shrink: 0;
  background: transparent;
  z-index: 1;
}
.resizer-col {
  width: 6px;
  cursor: col-resize;
}
.resizer-row {
  height: 6px;
  cursor: row-resize;
}
.resizer::before {
  content: "";
  position: absolute;
  background: var(--term-pane-divider);
  transition: background 120ms, width 120ms, height 120ms;
}
.resizer-col::before {
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
  transform: translateX(-50%);
}
.resizer-row::before {
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
  transform: translateY(-50%);
}
.resizer:hover::before,
.resizer.dragging::before {
  background: var(--term-pane-divider-active);
}
.resizer-col:hover::before,
.resizer-col.dragging::before {
  width: 2px;
}
.resizer-row:hover::before,
.resizer-row.dragging::before {
  height: 2px;
}
</style>
