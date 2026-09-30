<script setup lang="ts">
/**
 * 分屏之间的拖拽把手。
 *
 * 手势是完整的（按下 / 拖动 / 最小尺寸夹取 / 双击等分），但此前 **没有任何
 * 监听者** —— `TerminalResizer` 画得出来、hover 有高亮，拖下去却什么都不发生，
 * 因为 `resizeSplit` 从未被调用。这里改为 pointer 事件（Tauri webview 里
 * 指针捕获比 mousemove 可靠），并把 `containerSize` 一并上报给 store，由
 * `resizeSplit` 做像素→flex 权重的换算。
 */
import { ref } from "vue";

const props = defineProps<{
  /** 'col' = 竖向把手（左右拖动），'row' = 横向把手（上下拖动）。 */
  dir: "row" | "col";
  size: number;
}>();

const emit = defineEmits<{
  resize: [delta: number, containerSize: number];
  reset: [];
}>();

/** 拖拽中允许的最小边长（px）。 */
const MIN_EDGE = 60;

const dragging = ref(false);
let startPos = 0;
let startSizeA = 0;
let startSizeB = 0;
let parent: HTMLElement | null = null;
let detach: (() => void) | null = null;

function axisOf(event: { clientX: number; clientY: number }): number {
  return props.dir === "col" ? event.clientX : event.clientY;
}

function findAdjacentPair(
  children: HTMLElement[],
  target: HTMLElement,
): [HTMLElement, HTMLElement] {
  const idx = children.indexOf(target);
  const left = children[idx - 1];
  const right = children[idx + 1];
  return [left ?? target, right ?? target];
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  dragging.value = true;
  startPos = axisOf(event);
  parent = (event.currentTarget as HTMLElement).parentElement;
  if (!parent) return;
  const children = Array.from(parent.children) as HTMLElement[];
  if (children.length < 2) return;
  const [a, b] = findAdjacentPair(children, event.currentTarget as HTMLElement);
  startSizeA =
    props.dir === "col" ? a.getBoundingClientRect().width : a.getBoundingClientRect().height;
  startSizeB =
    props.dir === "col" ? b.getBoundingClientRect().width : b.getBoundingClientRect().height;

  const cursor = props.dir === "col" ? "col-resize" : "row-resize";
  document.body.style.cursor = cursor;
  document.body.style.userSelect = "none";

  const onMove = (moveEvent: PointerEvent) => {
    if (!dragging.value || !parent) return;
    const current = axisOf(moveEvent);
    const delta = current - startPos;
    startPos = current;
    // 夹到最小边长之外就不再移动：既避免把 pane 压成一条缝，也避免把
    // 负的 flex 权重喂给 store。
    if (startSizeA + delta < MIN_EDGE || startSizeB - delta < MIN_EDGE) return;
    emit("resize", delta, props.dir === "col" ? parent.clientWidth : parent.clientHeight);
    startSizeA += delta;
    startSizeB -= delta;
  };
  const onUp = () => {
    dragging.value = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    detach = null;
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  detach = onUp;
}

defineExpose({
  cancel: () => {
    detach?.();
    detach = null;
    dragging.value = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  },
});
</script>

<template>
  <div
    class="resizer"
    :class="[`resizer-${dir}`, { dragging }]"
    data-terminal-resizer
    :aria-label="dir"
    role="separator"
    :aria-orientation="dir === 'col' ? 'vertical' : 'horizontal'"
    @pointerdown="onPointerDown"
    @dblclick="emit('reset')"
  />
</template>

<style scoped>
.resizer {
  position: relative;
  flex-shrink: 0;
  background: transparent;
  z-index: 1;
  touch-action: none;
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
/* 拖拽期间为把手伪元素的尺寸过渡提供合成层提示，减少 paint 抖动。 */
.resizer.dragging::before {
  will-change: width, height;
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
