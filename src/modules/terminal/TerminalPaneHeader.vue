<script setup lang="ts">
import { computed } from "vue";
import type { SessionState } from "./lib/sessions";

const props = defineProps<{
  leafId: string;
  cwd?: string;
  shellName: string;
  state: SessionState;
  exitCode: number | null;
}>();

const emit = defineEmits<{
  close: [];
  split: ["row" | "col"];
  restart: [];
  cwdClick: [];
}>();

const displayCwd = computed(() => {
  const c = props.cwd;
  if (!c) return "—";
  return c.replace(/^([A-Za-z]:)?\//, (_, drive) => (drive ? `${drive}/` : "~/"));
});

const stateLabel = computed(() => {
  if (props.state === "connecting") return "connecting";
  if (props.state === "exited") return `exited (${props.exitCode ?? "?"})`;
  return props.shellName || "shell";
});

const stateClass = computed(() => `state-${props.state}`);
</script>

<template>
  <header class="pane-header">
    <div class="pane-header-left">
      <span class="state-dot" :class="stateClass" :title="stateLabel" />
      <span class="pane-title">{{ stateLabel }}</span>
    </div>

    <button
      type="button"
      class="pane-cwd"
      :title="cwd ?? ''"
      :disabled="!cwd"
      @click="emit('cwdClick')"
    >
      <span class="cwd-prefix">cwd</span>
      <span class="cwd-text">{{ displayCwd }}</span>
    </button>

    <div class="pane-header-right">
      <button
        v-if="state === 'exited'"
        type="button"
        class="pane-action"
        title="Restart Shell"
        @click="emit('restart')"
      >
        ↺
      </button>
      <button
        type="button"
        class="pane-action"
        title="Split Right"
        @click="emit('split', 'row')"
      >
        ▏■
      </button>
      <button
        type="button"
        class="pane-action"
        title="Split Down"
        @click="emit('split', 'col')"
      >
        ▬▬
      </button>
      <button
        type="button"
        class="pane-action pane-action-close"
        title="Close Pane"
        @click="emit('close')"
      >
        ×
      </button>
    </div>
  </header>
</template>

<style scoped>
.pane-header {
  height: 28px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 6px 0 10px;
  gap: 8px;
  background: var(--term-pane-header-bg);
  border-bottom: 1px solid var(--term-pane-divider);
  font-size: 11px;
  user-select: none;
  font-family: var(--font-sans);
}
.focused .pane-header {
  background: var(--term-pane-active-bg);
}
.pane-header-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.state-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.state-dot.state-connecting {
  background: var(--term-state-connecting);
  animation: pulse 1.4s ease-in-out infinite;
}
.state-dot.state-running {
  background: var(--term-state-running);
}
.state-dot.state-exited {
  background: var(--term-state-exited);
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

.pane-title {
  color: var(--term-pane-header-fg);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pane-cwd {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 3px 8px;
  background: transparent;
  border: 0;
  border-radius: 4px;
  color: var(--term-pane-header-fg-muted);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
  font-family: var(--font-sans);
}
.pane-cwd:hover:not(:disabled) {
  background: var(--term-pane-hover-bg);
  color: var(--term-pane-header-fg);
}
.pane-cwd:disabled { cursor: default; }
.cwd-prefix {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.65;
}
.cwd-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pane-header-right {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 100ms;
}
.pane-header:hover .pane-header-right,
.focused .pane-header-right {
  opacity: 1;
}
.pane-action {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  border-radius: 4px;
  color: var(--term-pane-header-fg-muted);
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1;
}
.pane-action:hover {
  background: var(--term-pane-hover-bg);
  color: var(--term-pane-header-fg);
}
.pane-action-close:hover {
  background: var(--term-state-exited);
  color: var(--term-pane-header-fg-on-accent);
}
</style>
