<script setup lang="ts">
import { writeClipboardText, readClipboardText } from "@/lib/clipboard";

const props = defineProps<{
  selection: string;
}>();

const emit = defineEmits<{
  close: [];
  paste: [text: string];
}>();

async function handleCopy() {
  if (props.selection) {
    await writeClipboardText(props.selection);
  }
  emit("close");
}

async function handlePaste() {
  const text = await readClipboardText();
  if (text) emit("paste", text);
  emit("close");
}

function handleSelectAll() {
  emit("close");
}
</script>

<template>
  <div ref="root" class="terminal-context-menu">
    <button type="button" :disabled="!selection" @click="handleCopy">Copy</button>
    <button type="button" @click="handlePaste">Paste</button>
    <button type="button" @click="handleSelectAll">Select All</button>
  </div>
</template>

<style scoped>
.terminal-context-menu {
  position: fixed;
  z-index: 50;
  background: var(--term-pane-header-bg);
  border: 1px solid var(--term-pane-divider-active);
  border-radius: 6px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  min-width: 140px;
  box-shadow: 0 6px 16px -6px rgba(0, 0, 0, 0.32);
  font-family: var(--font-sans);
}
.terminal-context-menu button {
  background: transparent;
  border: 0;
  color: var(--term-pane-header-fg);
  padding: 6px 10px;
  text-align: left;
  cursor: pointer;
  border-radius: 4px;
  font-size: 12px;
}
.terminal-context-menu button:hover {
  background: var(--term-pane-hover-bg);
}
.terminal-context-menu button:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
