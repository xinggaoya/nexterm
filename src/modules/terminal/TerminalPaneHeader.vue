<script setup lang="ts">
/**
 * 分屏顶部的标题栏。
 *
 * 存在意义有三层：
 * 1. **焦点可见** —— 激活的分屏用 `--terminal-focus` 描边。这是分屏终端里
 *    最要命的信息缺失：键鼠输入落在哪一块，此前完全没有视觉线索
 *    （`isFocused` 唯一的副作用是 `outline: 0`）。
 * 2. **分屏可关** —— 以前 `TerminalPane` 声明了 `close` emit 却没有触发点，
 *    `closeLeafInTab` 只能收到一个永不发出的事件：分屏之后只能整标签关掉。
 *    关闭/分屏按钮现在挂在每条分屏自己的标题栏上。
 * 3. **状态可见** —— `getExitCode()` 拿得到却无人调用，进程退出只表现为
 *    整个面板灰化。这里显示 running / connecting / exited + 退出码。
 *
 * 高度 24px，并且只在 hover 或聚焦时显示动作按钮，避免多分屏时视觉噪音。
 */
import { CloseOutline, ReorderTwoOutline, DuplicateOutline } from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import { computed } from "vue";
import { t } from "@/modules/i18n/translate";
import type { SessionState } from "./lib/sessions";

const props = defineProps<{
  title?: string;
  cwd?: string;
  state: SessionState;
  exitCode?: number;
  isFocused: boolean;
  canSplit: boolean;
  /** 整个 tab 只有这一条分屏时，关闭 = 关标签（由上层决定文案）。 */
  onlyPane: boolean;
}>();

const emit = defineEmits<{
  focus: [];
  close: [];
  split: ["row" | "col"];
}>();

const STATE_CLASS: Record<SessionState, string> = {
  connecting: "bg-warning",
  running: "bg-success/70",
  exited: "bg-destructive",
};

/** 状态点 + 退出码。running 时不加文字，避免在窄分屏里挤掉标题。 */
const stateLabel = computed(() => {
  if (props.state === "exited") {
    return props.exitCode === undefined
      ? t("terminal.stateExited")
      : t("terminal.stateExitedCode", { code: props.exitCode });
  }
  if (props.state === "connecting") return t("terminal.stateConnecting");
  return null;
});

const displayTitle = computed(() => props.title || props.cwd || t("terminal.untitled"));

const closeLabel = computed(() =>
  props.onlyPane ? t("terminal.closeTab") : t("terminal.closePane"),
);
</script>

<template>
  <div
    class="pane-header"
    :class="{ focused: isFocused, exited: state === 'exited' }"
    data-pane-header
    @pointerdown="emit('focus')"
  >
    <span
      class="size-1.5 shrink-0 rounded-full"
      :class="STATE_CLASS[state]"
      data-pane-state
    />
    <span
      class="min-w-0 shrink font-medium text-foreground"
      :title="displayTitle"
    >
      {{ displayTitle }}
    </span>
    <span
      v-if="stateLabel"
      class="shrink-0 text-[10px]"
      :class="state === 'exited' ? 'text-destructive' : 'text-muted-foreground'"
      data-pane-state-label
    >
      {{ stateLabel }}
    </span>
    <span
      v-else-if="cwd && cwd !== displayTitle"
      class="min-w-0 flex-1 truncate text-[10px] text-muted-foreground"
      :title="cwd"
      data-pane-cwd
    >
      {{ cwd }}
    </span>
    <span v-else class="flex-1" />

    <span class="pane-actions" data-pane-actions>
      <button
        v-if="canSplit"
        type="button"
        class="pane-action"
        :title="t('terminal.splitRight')"
        :aria-label="t('terminal.splitRight')"
        data-pane-split-right
        @pointerdown.stop
        @click.stop="emit('split', 'row')"
      >
        <NIcon :component="DuplicateOutline" :size="12" />
      </button>
      <button
        v-if="canSplit"
        type="button"
        class="pane-action"
        :title="t('terminal.splitDown')"
        :aria-label="t('terminal.splitDown')"
        data-pane-split-down
        @pointerdown.stop
        @click.stop="emit('split', 'col')"
      >
        <NIcon :component="ReorderTwoOutline" :size="12" />
      </button>
      <button
        type="button"
        class="pane-action pane-action-close"
        :title="closeLabel"
        :aria-label="closeLabel"
        data-pane-close
        @pointerdown.stop
        @click.stop="emit('close')"
      >
        <NIcon :component="CloseOutline" :size="12" />
      </button>
    </span>
  </div>
</template>

<style scoped>
.pane-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 4px 0 8px;
  font-size: 11px;
  background: var(--term-pane-header-bg);
  color: var(--term-pane-header-fg);
  border-bottom: 1px solid var(--term-pane-divider);
  /* 激活分屏的焦点描边：此前 isFocused 没有任何视觉表现。 */
  box-shadow: inset 2px 0 0 0 var(--terminal-focus);
  transition: background-color 120ms, box-shadow 120ms;
}
.pane-header.focused {
  background: var(--term-pane-active-bg);
}
.pane-header:hover {
  background: var(--term-pane-hover-bg);
}
.pane-header.focused:hover {
  background: var(--term-pane-active-bg);
}
.pane-actions {
  display: flex;
  align-items: center;
  gap: 1px;
  /* 未聚焦时藏起来：多分屏时 4 条标题栏同时铺满图标太吵。
     键盘用户聚焦进来后依然可见。 */
  opacity: 0;
  transition: opacity 120ms;
}
.pane-header:hover .pane-actions,
.pane-header.focused .pane-actions {
  opacity: 1;
}
.pane-action {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  color: var(--muted-foreground);
  transition: background-color 120ms, color 120ms;
}
.pane-action:hover {
  background: var(--surface-hover);
  color: var(--foreground);
}
.pane-action-close:hover {
  background: color-mix(in oklch, var(--destructive) 16%, transparent);
  color: var(--destructive);
}
</style>
