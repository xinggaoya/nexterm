<script setup lang="ts">
import { DocumentTextOutline } from "@vicons/ionicons5";
import { NIcon, NSpin } from "naive-ui";
import { computed, ref, watch } from "vue";
import { t } from "@/modules/i18n/translate";
import {
  readMarkdownDocument,
  type MarkdownDocumentState,
} from "./lib/markdownDocumentService";
import { renderMarkdownToHtml } from "./lib/markdownRenderer";

const props = defineProps<{
  path: string;
  visible: boolean;
}>();

const doc = ref<MarkdownDocumentState>({ status: "loading" });

const fileName = computed(() => {
  const parts = props.path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : props.path;
});

const renderedHtml = computed(() =>
  doc.value.status === "ready" ? renderMarkdownToHtml(doc.value.content) : "",
);

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function load() {
  doc.value = { status: "loading" };
  doc.value = await readMarkdownDocument(props.path);
}

watch(() => props.path, () => void load(), { immediate: true });
</script>

<template>
  <div
    class="flex h-full w-full flex-col overflow-hidden rounded-md border border-border/60 bg-background"
    :style="{ pointerEvents: props.visible ? 'auto' : 'none' }"
  >
    <div class="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-3">
      <NIcon :component="DocumentTextOutline" :size="15" class="shrink-0 text-muted-foreground" />
      <div class="min-w-0 flex-1 truncate text-[12px] font-medium">{{ fileName }}</div>
    </div>

    <div v-if="doc.status === 'loading'" class="grid min-h-0 flex-1 place-items-center">
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <NSpin size="small" />
        <span>{{ t("markdown.loading") }}</span>
      </div>
    </div>

    <div
      v-else-if="doc.status === 'error'"
      class="grid min-h-0 flex-1 place-items-center p-6 text-center text-xs text-destructive"
    >
      {{ t("markdown.failedRead", { message: doc.message }) }}
    </div>

    <div
      v-else-if="doc.status === 'binary'"
      class="grid min-h-0 flex-1 place-items-center p-6 text-center"
    >
      <div>
        <div class="text-sm font-medium">{{ t("markdown.binaryFile") }}</div>
        <div class="mt-1 text-xs text-muted-foreground">
          {{ formatBytes(doc.size) }} · {{ t("markdown.cannotRender") }}
        </div>
      </div>
    </div>

    <div
      v-else-if="doc.status === 'toolarge'"
      class="grid min-h-0 flex-1 place-items-center p-6 text-center"
    >
      <div>
        <div class="text-sm font-medium">{{ t("markdown.fileTooLarge") }}</div>
        <div class="mt-1 text-xs text-muted-foreground">
          {{
            t("markdown.limit", {
              size: formatBytes(doc.size),
              limit: formatBytes(doc.limit),
            })
          }}
        </div>
      </div>
    </div>

    <div v-else class="min-h-0 flex-1 overflow-auto px-6 py-5">
      <article
        data-markdown-preview
        class="markdown-preview mx-auto max-w-4xl text-sm leading-7 text-foreground"
        v-html="renderedHtml"
      />
    </div>
  </div>
</template>

<style scoped>
.markdown-preview :deep(*) {
  overflow-wrap: anywhere;
}

.markdown-preview :deep(h1),
.markdown-preview :deep(h2),
.markdown-preview :deep(h3) {
  margin: 1.2em 0 0.55em;
  font-weight: 650;
  line-height: 1.2;
}

.markdown-preview :deep(h1:first-child),
.markdown-preview :deep(h2:first-child),
.markdown-preview :deep(h3:first-child) {
  margin-top: 0;
}

.markdown-preview :deep(h1) {
  font-size: 1.45rem;
}

.markdown-preview :deep(h2) {
  font-size: 1.15rem;
}

.markdown-preview :deep(h3) {
  font-size: 1rem;
}

.markdown-preview :deep(p),
.markdown-preview :deep(ul),
.markdown-preview :deep(ol),
.markdown-preview :deep(blockquote),
.markdown-preview :deep(pre),
.markdown-preview :deep(table) {
  margin: 0.75em 0;
}

.markdown-preview :deep(ul),
.markdown-preview :deep(ol) {
  padding-left: 1.35rem;
}

.markdown-preview :deep(a) {
  color: color-mix(in srgb, var(--foreground) 76%, #2563eb);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.markdown-preview :deep(code) {
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--muted);
  padding: 0.1rem 0.3rem;
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: 0.86em;
}

.markdown-preview :deep(pre) {
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--muted);
  padding: 0.9rem 1rem;
}

.markdown-preview :deep(pre code) {
  border: 0;
  background: transparent;
  padding: 0;
}

.markdown-preview :deep(blockquote) {
  border-left: 3px solid var(--border);
  color: var(--muted-foreground);
  padding-left: 0.9rem;
}

.markdown-preview :deep(table) {
  width: 100%;
  border-collapse: collapse;
}

.markdown-preview :deep(th),
.markdown-preview :deep(td) {
  border: 1px solid var(--border);
  padding: 0.45rem 0.6rem;
}
</style>
