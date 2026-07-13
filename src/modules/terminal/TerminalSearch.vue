<script setup lang="ts">
import { ref, watch, nextTick } from "vue";

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  close: [];
  search: [query: string];
}>();

const query = ref("");
const inputRef = ref<HTMLInputElement | null>(null);

watch(
  () => props.visible,
  async (visible) => {
    if (visible) {
      await nextTick();
      inputRef.value?.focus();
      inputRef.value?.select();
    } else {
      query.value = "";
    }
  },
);

watch(query, (q) => emit("search", q));

function handleKey(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
  } else if (event.key === "Enter") {
    event.preventDefault();
    emit("search", query.value);
  }
}
</script>

<template>
  <div v-if="visible" class="terminal-search">
    <input
      ref="inputRef"
      v-model="query"
      type="text"
      placeholder="Search…"
      class="terminal-search-input"
      @keydown="handleKey"
    />
    <button type="button" class="terminal-search-close" @click="emit('close')">
      ×
    </button>
  </div>
</template>

<style scoped>
.terminal-search {
  position: absolute;
  top: 36px;
  right: 16px;
  display: flex;
  align-items: center;
  background: var(--term-pane-header-bg);
  border: 1px solid var(--term-pane-divider-active);
  border-radius: 6px;
  padding: 4px 8px;
  gap: 4px;
  z-index: 30;
  font-family: var(--font-sans);
}
.terminal-search-input {
  background: transparent;
  border: 0;
  outline: 0;
  color: var(--term-pane-header-fg);
  font-size: 12px;
  width: 200px;
  font-family: inherit;
}
.terminal-search-close {
  background: transparent;
  border: 0;
  color: var(--term-pane-header-fg-muted);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}
.terminal-search-close:hover {
  color: var(--term-pane-header-fg);
}
</style>
