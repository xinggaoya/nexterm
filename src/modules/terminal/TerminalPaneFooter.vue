<script setup lang="ts">
import { computed } from "vue";
import type { SessionState } from "./lib/sessions";

const props = defineProps<{
  state: SessionState;
  exitCode: number | null;
  dims: { cols: number; rows: number };
}>();

const dimsLabel = computed(() => {
  if (props.dims.cols === 0 && props.dims.rows === 0) return "";
  return `${props.dims.cols} × ${props.dims.rows}`;
});

const stateLabel = computed(() => {
  if (props.state === "connecting") return "connecting";
  if (props.state === "exited") return `exit ${props.exitCode ?? "?"}`;
  return "running";
});
</script>

<template>
  <footer v-if="dimsLabel" class="pane-footer">
    <span class="pane-footer-state">{{ stateLabel }}</span>
    <span class="pane-footer-sep">·</span>
    <span class="pane-footer-dims">{{ dimsLabel }}</span>
    <span class="pane-footer-sep">·</span>
    <span class="pane-footer-enc">UTF-8</span>
  </footer>
</template>

<style scoped>
.pane-footer {
  height: 22px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 6px;
  background: var(--term-pane-footer-bg);
  border-top: 1px solid var(--term-pane-divider);
  color: var(--term-pane-header-fg-muted);
  font-size: 10px;
  font-family: var(--font-mono, "JetBrainsMono Nerd Font", "JetBrains Mono", SFMono-Regular, Menlo, monospace);
  letter-spacing: 0.04em;
  text-transform: lowercase;
  user-select: none;
}
.pane-footer-sep {
  opacity: 0.45;
}
</style>
