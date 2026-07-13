<script setup lang="ts">
defineProps<{
  x: number;
  y: number;
  selection: string;
}>();

const emit = defineEmits<{
  close: [];
  copy: [];
  paste: [];
  selectAll: [];
}>();
</script>

<template>
  <div
    class="terminal-context-menu-backdrop"
    @mousedown.self="emit('close')"
    @contextmenu.prevent.self="emit('close')"
  >
    <div class="terminal-context-menu" :style="{ top: `${y}px`, left: `${x}px` }">
      <button type="button" :disabled="!selection" @click="emit('copy')">
        Copy
      </button>
      <button type="button" @click="emit('paste')">Paste</button>
      <button type="button" @click="emit('selectAll')">Select All</button>
    </div>
  </div>
</template>

<style scoped>
.terminal-context-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
}
.terminal-context-menu {
  position: fixed;
  background: var(--term-pane-header-bg);
  border: 1px solid var(--term-pane-divider);
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
.terminal-context-menu button:hover:not(:disabled) {
  background: var(--term-pane-hover-bg);
}
.terminal-context-menu button:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
