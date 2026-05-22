<script setup lang="ts">
import { computed } from "vue";
import { renderMarkdownToHtml } from "@/modules/markdown/lib/markdownRenderer";

const props = defineProps<{
  content: string;
}>();

const renderedHtml = computed(() => renderMarkdownToHtml(props.content));
</script>

<template>
  <div class="h-full overflow-auto bg-background px-6 py-5">
    <article
      data-editor-markdown-preview
      class="markdown-editor-preview mx-auto max-w-4xl text-sm leading-7 text-foreground"
      v-html="renderedHtml"
    />
  </div>
</template>

<style scoped>
.markdown-editor-preview :deep(*) {
  overflow-wrap: anywhere;
}

.markdown-editor-preview :deep(h1),
.markdown-editor-preview :deep(h2),
.markdown-editor-preview :deep(h3) {
  margin: 1.2em 0 0.55em;
  font-weight: 650;
  line-height: 1.2;
}

.markdown-editor-preview :deep(h1:first-child),
.markdown-editor-preview :deep(h2:first-child),
.markdown-editor-preview :deep(h3:first-child) {
  margin-top: 0;
}

.markdown-editor-preview :deep(h1) {
  font-size: 1.45rem;
}

.markdown-editor-preview :deep(h2) {
  font-size: 1.15rem;
}

.markdown-editor-preview :deep(h3) {
  font-size: 1rem;
}

.markdown-editor-preview :deep(p),
.markdown-editor-preview :deep(ul),
.markdown-editor-preview :deep(ol),
.markdown-editor-preview :deep(blockquote),
.markdown-editor-preview :deep(pre),
.markdown-editor-preview :deep(table) {
  margin: 0.75em 0;
}

.markdown-editor-preview :deep(ul),
.markdown-editor-preview :deep(ol) {
  padding-left: 1.35rem;
}

.markdown-editor-preview :deep(a) {
  color: color-mix(in srgb, var(--foreground) 76%, #2563eb);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.markdown-editor-preview :deep(code) {
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--muted);
  padding: 0.1rem 0.3rem;
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: 0.86em;
}

.markdown-editor-preview :deep(pre) {
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--muted);
  padding: 0.9rem 1rem;
}

.markdown-editor-preview :deep(pre code) {
  border: 0;
  background: transparent;
  padding: 0;
}

.markdown-editor-preview :deep(blockquote) {
  border-left: 3px solid var(--border);
  color: var(--muted-foreground);
  padding-left: 0.9rem;
}

.markdown-editor-preview :deep(table) {
  width: 100%;
  border-collapse: collapse;
}

.markdown-editor-preview :deep(th),
.markdown-editor-preview :deep(td) {
  border: 1px solid var(--border);
  padding: 0.45rem 0.6rem;
}
</style>
