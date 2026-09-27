<script setup lang="ts">
import { computed } from "vue";
import { NIcon } from "naive-ui";
import { ChevronForwardOutline, CodeSlashOutline } from "@vicons/ionicons5";
import type { LspDocumentSymbol } from "@/modules/lsp/types";

/**
 * 编辑器面包屑：显示光标所在的符号容器链（`Foo > bar > baz`）。
 *
 * 数据来自 LSP 的 `textDocument/documentSymbol`。没有符号树时不渲染任何
 * 内容 —— 与其显示一条"只有文件名"的空壳（信息量为零、还占一行高度），
 * 不如让位给编辑器本身。
 *
 * 点击任一层把光标跳到该符号的定义处：面包屑是**导航**控件，不是装饰。
 */
const props = defineProps<{
  /** 文件名（面包屑的最后一段）。 */
  fileName: string;
  /** 光标处的容器链，由 `containerPathForOffset` 算出。 */
  containerPath: string[];
  /** 整棵符号树，用于把"第 N 层"映射回具体符号的偏移。 */
  symbols: LspDocumentSymbol[];
}>();

const emit = defineEmits<{
  /** 跳到某个符号（1-based 行号）。 */
  "go-to-symbol": [line: number];
}>();

/**
 * 每一层对应的符号。
 *
 * 沿树按**名字**走下去（而不是"深度 → 符号"的映射）：同一深度可以有很多
 * 同级符号，用深度做键会拿到"最后一个"，点击面包屑就会跳到不相干的地方。
 * 名字走链也天然处理了"从中间层开始"（同名兄弟节点取第一个，此时不跳，
 * 而不是跳到错的符号）。
 */
const layers = computed(() => {
  let current: LspDocumentSymbol[] = props.symbols;
  return props.containerPath.map((name) => {
    const symbol = current.find((candidate) => candidate.name === name);
    if (!symbol) {
      // 找不到就不再往下找：后续层级无从定位，宁可不跳
      current = [];
      return { name, line: null };
    }
    current = symbol.children ?? [];
    return { name, line: symbol.selectionRange.start.line + 1 };
  });
});

function goToLayer(line: number | null): void {
  if (line === null) return;
  emit("go-to-symbol", line);
}
</script>

<template>
  <nav
    v-if="layers.length > 0"
    data-editor-breadcrumb
    :aria-label="fileName"
    class="flex h-6 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/40 px-2 text-[11px] text-muted-foreground no-scrollbar"
  >
    <NIcon :component="CodeSlashOutline" :size="11" class="mr-0.5 shrink-0" />
    <button
      type="button"
      data-breadcrumb-file
      class="shrink-0 rounded px-1 hover:bg-accent hover:text-foreground"
      :title="fileName"
      @click="goToLayer(1)"
    >
      {{ fileName }}
    </button>
    <template v-for="(layer, index) in layers" :key="`${layer.name}-${index}`">
      <NIcon :component="ChevronForwardOutline" :size="10" class="shrink-0 opacity-60" />
      <button
        type="button"
        class="shrink-0 rounded px-1 hover:bg-accent hover:text-foreground"
        :title="layer.name"
        :class="index === layers.length - 1 ? 'text-foreground' : ''"
        @click="goToLayer(layer.line)"
      >
        {{ layer.name }}
      </button>
    </template>
  </nav>
</template>
