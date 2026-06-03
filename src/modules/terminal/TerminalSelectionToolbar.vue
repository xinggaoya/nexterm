<script setup lang="ts">
import type { Terminal } from "@xterm/xterm";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { readClipboardText, writeClipboardText } from "@/lib/clipboard";
import { t as translate } from "@/modules/i18n/translate";
import { getLeafTerm } from "./lib/rendererPool";

const props = defineProps<{
  leafId: number;
  container: HTMLElement | null;
  visible: boolean;
  focused: boolean;
}>();

const emit = defineEmits<{
  close: [];
  select: [kind: "copy" | "paste" | "selectAll"];
}>();

const open = ref(false);
const posX = ref(0);
const posY = ref(0);
const toolbarEl = ref<HTMLElement | null>(null);
let selectionDisposer: (() => void) | null = null;

const term = computed(() => getLeafTerm(props.leafId));

type CellDims = { actualCellWidth: number; actualCellHeight: number };
type RenderServiceLike = { dimensions: CellDims };
type CoreLike = { _renderService: RenderServiceLike };

function readCellSize(target: Terminal): CellDims | null {
  const core = (target as unknown as { _core?: CoreLike })._core;
  if (!core) return null;
  return core._renderService.dimensions;
}

function clearSelectionSubscription() {
  if (selectionDisposer) {
    try {
      selectionDisposer();
    } catch {}
    selectionDisposer = null;
  }
}

function recompute() {
  const current = term.value;
  const container = props.container;
  if (!current || !container || !props.focused) {
    open.value = false;
    return;
  }
  const text = current.getSelection();
  if (!text) {
    open.value = false;
    return;
  }
  const position = current.getSelectionPosition();
  if (!position) {
    open.value = false;
    return;
  }
  const dims = readCellSize(current);
  if (!dims) {
    open.value = false;
    return;
  }
  const { actualCellWidth: cellWidth, actualCellHeight: cellHeight } = dims;
  const containerRect = container.getBoundingClientRect();
  const viewportEl = current.element?.querySelector(
    ".xterm-viewport",
  ) as HTMLElement | null;
  const viewportRect = viewportEl?.getBoundingClientRect();
  const anchorLeft = viewportRect?.left ?? containerRect.left;
  const anchorTop = viewportRect?.top ?? containerRect.top;
  posX.value = anchorLeft - containerRect.left + (position.start.x + 1) * cellWidth;
  posY.value = anchorTop - containerRect.top + position.start.y * cellHeight;
  open.value = true;
}

function bindSelectionSubscription() {
  clearSelectionSubscription();
  const current = term.value;
  if (!current) {
    open.value = false;
    return;
  }
  const disposable = current.onSelectionChange(() => {
    recompute();
  });
  selectionDisposer = () => {
    try {
      disposable.dispose();
    } catch {}
  };
  recompute();
}

function handleDocumentPointerDown(event: PointerEvent) {
  if (!open.value) return;
  const target = event.target as Node | null;
  if (!target) return;
  if (toolbarEl.value && toolbarEl.value.contains(target)) return;
  close();
}

onMounted(() => {
  document.addEventListener("pointerdown", handleDocumentPointerDown, true);
});

onBeforeUnmount(() => {
  clearSelectionSubscription();
  document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
});

watch(
  () => [props.leafId, props.container, props.focused, props.visible] as const,
  ([leafId, container, focused, visible]) => {
    if (!container || !focused || !visible) {
      open.value = false;
      return;
    }
    if (leafId !== props.leafId) return;
    bindSelectionSubscription();
  },
  { immediate: true },
);

function close() {
  open.value = false;
  emit("close");
}

async function handleCopy() {
  const current = term.value;
  if (!current) return;
  const text = current.getSelection();
  if (!text) return;
  await writeClipboardText(text);
  emit("select", "copy");
  close();
}

async function handlePaste() {
  const current = term.value;
  if (!current) return;
  const text = await readClipboardText();
  if (text) current.paste(text);
  emit("select", "paste");
  close();
}

function handleSelectAll() {
  const current = term.value;
  if (!current) return;
  current.selectAll();
  emit("select", "selectAll");
  recompute();
}
</script>

<template>
  <div
    v-if="open && props.focused && props.container"
    ref="toolbarEl"
    data-terminal-toolbar
    role="toolbar"
    :aria-label="translate('terminal.toolbar.hint')"
    class="pointer-events-auto absolute z-30 -translate-x-1/2 -translate-y-full rounded-md border border-border/60 bg-card px-1 py-1 text-foreground shadow-md"
    :style="{
      left: `${posX}px`,
      top: `${posY - 6}px`,
    }"
  >
    <button
      type="button"
      data-terminal-action="copy"
      :aria-label="translate('terminal.toolbar.copy')"
      class="rounded-sm px-2 py-1 text-xs hover:bg-accent"
      @click="handleCopy"
    >
      {{ translate("terminal.toolbar.copy") }}
    </button>
    <button
      type="button"
      data-terminal-action="paste"
      :aria-label="translate('terminal.toolbar.paste')"
      class="rounded-sm px-2 py-1 text-xs hover:bg-accent"
      @click="handlePaste"
    >
      {{ translate("terminal.toolbar.paste") }}
    </button>
    <button
      type="button"
      data-terminal-action="select-all"
      :aria-label="translate('terminal.toolbar.selectAll')"
      class="rounded-sm px-2 py-1 text-xs hover:bg-accent"
      @click="handleSelectAll"
    >
      {{ translate("terminal.toolbar.selectAll") }}
    </button>
  </div>
</template>
