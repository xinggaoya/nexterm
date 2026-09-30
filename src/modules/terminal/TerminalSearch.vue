<script setup lang="ts">
/**
 * 终端内查找面板。
 *
 * 这个组件与 `SearchAddon` 此前都已存在（组件写好、addon 装好、index.ts 也
 * 导出了），但**全项目零引用** —— 终端里 Ctrl+F 根本不工作。现在接到
 * `attachTerminalShortcuts` 的 Ctrl+F 上。
 *
 * 交互对齐 VS Code / iTerm：Enter 或 ↓ 下一个、Shift+Enter 或 ↑ 上一个、
 * 实时高亮 + 命中计数、Esc 关闭并把选区留在第一个命中上。
 */
import { ChevronDownOutline, ChevronUpOutline, CloseOutline } from "@vicons/ionicons5";
import { NButton, NIcon, NInput, type InputInst } from "naive-ui";
import { nextTick, ref, watch } from "vue";
import { t } from "@/modules/i18n/translate";

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  close: [];
  search: [query: string];
  next: [];
  previous: [];
}>();

const query = ref("");
const inputRef = ref<InputInst | null>(null);

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
    event.stopPropagation();
    emit("close");
    return;
  }
  if (event.key === "Enter") {
    // preventDefault 必不可少：否则 Enter 会同时落到 xterm 的 textarea，
    // 变成给 shell 的一次回车（提交命令 / 给 TUI 工具发确认）。
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) emit("previous");
    else emit("next");
  }
}

defineExpose({
  /** 由 Ctrl+F 再次按下时调用：已打开则关闭，否则打开。 */
  focusInput: () => inputRef.value?.focus(),
});
</script>

<template>
  <div
    v-if="visible"
    class="nexterm-overlay absolute top-9 right-4 z-30 flex items-center gap-1 p-1.5"
    data-terminal-search
    @keydown="handleKey"
  >
    <NInput
      ref="inputRef"
      v-model:value="query"
      size="small"
      :placeholder="t('terminal.searchPlaceholder')"
      :data-terminal-search-input="''"
      class="!w-56"
      @keydown="handleKey"
    />
    <slot name="status" />
    <NButton
      quaternary
      circle
      size="tiny"
      :aria-label="t('terminal.searchPrev')"
      data-terminal-search-prev
      @click="emit('previous')"
    >
      <template #icon><NIcon :component="ChevronUpOutline" :size="13" /></template>
    </NButton>
    <NButton
      quaternary
      circle
      size="tiny"
      :aria-label="t('terminal.searchNext')"
      data-terminal-search-next
      @click="emit('next')"
    >
      <template #icon><NIcon :component="ChevronDownOutline" :size="13" /></template>
    </NButton>
    <NButton
      quaternary
      circle
      size="tiny"
      :aria-label="t('common.close')"
      data-terminal-search-close
      @click="emit('close')"
    >
      <template #icon><NIcon :component="CloseOutline" :size="13" /></template>
    </NButton>
  </div>
</template>
