<script setup lang="ts">
import MarkdownContent from "@/modules/markdown/MarkdownContent.vue";

const props = defineProps<{
  content: string;
}>();
</script>

<template>
  <!-- 应用根节点是 select-none,拆分预览正文要显式恢复可选中以便复制。 -->
  <div
    class="h-full cursor-text select-text overflow-auto bg-background px-6 py-5"
    data-editor-markdown-preview-scroll
  >
    <MarkdownContent :content="props.content" data-editor-markdown-preview />
  </div>
</template>
