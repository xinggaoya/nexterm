<script setup lang="ts">
import { computed } from "vue";
import { writeClipboardText } from "@/lib/clipboard";
import { openExternalUrl } from "@/lib/openExternal";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import { renderMarkdownToHtml } from "./lib/markdownRenderer";
import { useMarkdownRenderOptions } from "./useMarkdownRenderOptions";

/**
 * Markdown 正文渲染容器。
 *
 * 独立 Markdown 标签页（MarkdownPreviewPane）与编辑器拆分预览
 * （MarkdownEditorPreview）共用这一个组件：渲染管线、排版样式、代码块复制
 * 与外链处理都只有一份实现。
 */
const props = defineProps<{
  /** Markdown 源文本。 */
  content: string;
}>();

const options = useMarkdownRenderOptions();

const renderedHtml = computed(() =>
  renderMarkdownToHtml(props.content, options.value),
);

function copyCode(button: HTMLElement): void {
  const code = button.closest("[data-md-code]")?.querySelector("code");
  if (!code) return;
  void writeClipboardText(code.textContent ?? "");
}

function isExternal(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

/**
 * 预览里的链接一律不交给 webview 自己导航 —— 那会把整个应用导航走。
 * 绝对地址交给系统浏览器，相对地址（README 内的交叉引用）目前只拦截不跳转。
 */
function handleLink(href: string): void {
  if (!isExternal(href)) return;
  void openExternalUrl(href).catch(() => {
    // 非 Tauri 环境（web-dev-bridge 浏览器调试）：插件不可用，退回浏览器新标签页。
    if (!hasTauriInternals()) {
      window.open(href, "_blank", "noopener,noreferrer");
    }
  });
}

function handleClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  if (!target) return;

  const copy = target.closest("[data-md-copy]");
  if (copy) {
    event.preventDefault();
    copyCode(copy as HTMLElement);
    return;
  }

  const link = target.closest("a[href]");
  if (link) {
    event.preventDefault();
    handleLink(link.getAttribute("href") ?? "");
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  const target = event.target as HTMLElement | null;
  const copy = target?.closest("[data-md-copy]");
  if (!copy) return;
  event.preventDefault();
  copyCode(copy as HTMLElement);
}
</script>

<template>
  <article
    class="markdown-body mx-auto max-w-4xl"
    v-html="renderedHtml"
    @click="handleClick"
    @keydown="handleKeydown"
  />
</template>

<style scoped>
.markdown-body {
  font-size: 16px;
  line-height: 1.5;
  color: var(--foreground);
}

/* v-html 注入的内容不带作用域属性，统一交给 :deep 兜住换行。 */
.markdown-body :deep(*) {
  overflow-wrap: anywhere;
}

/* ── 标题 ─────────────────────────────────────────────────────────── */
.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4),
.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  margin: 1.4em 0 0.6em;
  font-weight: 650;
  line-height: 1.25;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2) {
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--border);
}

.markdown-body :deep(h1) {
  font-size: 2em;
}

.markdown-body :deep(h2) {
  font-size: 1.5em;
}

.markdown-body :deep(h3) {
  font-size: 1.25em;
}

.markdown-body :deep(h4) {
  font-size: 1em;
}

.markdown-body :deep(h5) {
  font-size: 0.9em;
}

.markdown-body :deep(h6) {
  font-size: 0.85em;
  color: var(--muted-foreground);
}

.markdown-body :deep(h1:first-child),
.markdown-body :deep(h2:first-child),
.markdown-body :deep(h3:first-child),
.markdown-body :deep(h4:first-child) {
  margin-top: 0;
}

.markdown-body :deep(.md-heading-anchor) {
  margin-left: 0.35em;
  color: var(--muted-foreground);
  text-decoration: none;
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-out);
}

.markdown-body :deep(h1:hover .md-heading-anchor),
.markdown-body :deep(h2:hover .md-heading-anchor),
.markdown-body :deep(h3:hover .md-heading-anchor),
.markdown-body :deep(h4:hover .md-heading-anchor),
.markdown-body :deep(h5:hover .md-heading-anchor),
.markdown-body :deep(h6:hover .md-heading-anchor),
.markdown-body :deep(.md-heading-anchor:focus-visible) {
  opacity: 1;
}

/* ── 段落与列表 ───────────────────────────────────────────────────── */
.markdown-body :deep(p),
.markdown-body :deep(ul),
.markdown-body :deep(ol),
.markdown-body :deep(blockquote),
.markdown-body :deep(pre),
.markdown-body :deep(table),
.markdown-body :deep(details),
.markdown-body :deep(.md-code) {
  margin: 0 0 1em;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 2em;
}

.markdown-body :deep(li + li) {
  margin-top: 0.25em;
}

.markdown-body :deep(li > p) {
  margin-bottom: 0.5em;
}

/* ── 链接 ─────────────────────────────────────────────────────────── */
.markdown-body :deep(a) {
  color: var(--markdown-link);
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* ── 行内代码 ─────────────────────────────────────────────────────── */
.markdown-body :deep(code) {
  border-radius: var(--radius-sm);
  background: var(--markdown-code-bg);
  padding: 0.2em 0.4em;
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: 0.875em;
}

/* ── 代码块 ───────────────────────────────────────────────────────── */
.markdown-body :deep(pre) {
  border-radius: var(--radius-md);
  background: var(--markdown-code-bg);
  padding: 0.9rem 1rem;
  overflow: auto;
  font-size: 0.875em;
  line-height: 1.55;
}

.markdown-body :deep(pre code) {
  border-radius: 0;
  background: transparent;
  padding: 0;
  font-size: inherit;
}

.markdown-body :deep(.md-code) {
  position: relative;
  border-radius: var(--radius-md);
  background: var(--markdown-code-bg);
  overflow: hidden;
}

.markdown-body :deep(.md-code pre) {
  margin: 0;
  border-radius: 0;
  background: transparent;
}

/*
 * 语言标签 + 复制按钮浮在代码块右上角，悬停 / 聚焦才出现 ——
 * 与 GitHub 的渲染态一致：默认是干净的代码块，不占额外高度。
 */
.markdown-body :deep(.md-code-bar) {
  position: absolute;
  top: 6px;
  right: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px 2px 6px;
  border-radius: var(--radius-sm);
  background: var(--markdown-code-bg);
  color: var(--muted-foreground);
  font-size: 11px;
  line-height: 1.4;
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-out);
}

.markdown-body :deep(.md-code:hover .md-code-bar),
.markdown-body :deep(.md-code:focus-within .md-code-bar) {
  opacity: 1;
}

.markdown-body :deep(.md-code-copy) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  color: var(--muted-foreground);
  cursor: pointer;
}

.markdown-body :deep(.md-code-copy:hover) {
  background: var(--surface-hover);
  color: var(--foreground);
}

/* ── 表格 ─────────────────────────────────────────────────────────── */
.markdown-body :deep(table) {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow: auto;
  border-collapse: collapse;
  font-size: 0.95em;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  border: 1px solid var(--border);
  padding: 0.4rem 0.85rem;
}

.markdown-body :deep(th) {
  background: var(--markdown-table-head-bg);
  font-weight: 600;
  text-align: left;
}

.markdown-body :deep(tbody tr:nth-child(2n) td) {
  background: color-mix(in srgb, var(--markdown-table-head-bg) 45%, transparent);
}

/* ── 引用 / 分隔线 / 图片 ─────────────────────────────────────────── */
.markdown-body :deep(blockquote) {
  padding: 0 1em;
  border-left: 0.25em solid var(--border);
  color: var(--muted-foreground);
}

.markdown-body :deep(hr) {
  height: 1px;
  margin: 1.5em 0;
  border: 0;
  background: var(--border);
}

/*
 * Tailwind preflight 把 img / svg 设成 display:block，README 里的并排徽章
 * 会各占一行。改回 inline-block —— 和 GitHub 的渲染态一致：徽章并排，
 * 单张大图也仍在段落里左对齐。
 */
.markdown-body :deep(img) {
  display: inline-block;
  max-width: 100%;
  box-sizing: content-box;
  vertical-align: middle;
}

/* ── 任务列表 ─────────────────────────────────────────────────────── */
.markdown-body :deep(ul.contains-task-list) {
  list-style: none;
  padding-left: 1.5em;
}

.markdown-body :deep(li.task-list-item) {
  position: relative;
}

.markdown-body :deep(.task-list-item-checkbox) {
  position: absolute;
  left: -1.5em;
  margin: 0.35em 0 0 -1.25em;
  accent-color: var(--primary);
}

/* ── 脚注 ─────────────────────────────────────────────────────────── */
.markdown-body :deep(.footnotes) {
  margin-top: 2em;
  padding-top: 0.6em;
  border-top: 1px solid var(--border);
  color: var(--muted-foreground);
  font-size: 0.9em;
}

.markdown-body :deep(.footnotes-sep) {
  display: none;
}

.markdown-body :deep(.footnote-ref a),
.markdown-body :deep(.footnote-backref) {
  text-decoration: none;
}

/* ── GFM alert ────────────────────────────────────────────────────── */
.markdown-body :deep(.markdown-alert) {
  margin: 0 0 1em;
  padding: 0.6rem 0.9rem;
  border-left: 0.25em solid var(--md-alert-color, var(--border));
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--md-alert-color, var(--border)) 12%, transparent);
}

.markdown-body :deep(.markdown-alert-title) {
  margin: 0 0 0.35rem;
  color: var(--md-alert-color, var(--foreground));
  font-weight: 600;
}

.markdown-body :deep(.markdown-alert-title svg) {
  display: inline-block;
  margin-right: 0.35em;
  vertical-align: -0.15em;
}

.markdown-body :deep(.markdown-alert > p:last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(.markdown-alert-note) {
  --md-alert-color: var(--info);
}

.markdown-body :deep(.markdown-alert-tip) {
  --md-alert-color: var(--success);
}

.markdown-body :deep(.markdown-alert-important) {
  --md-alert-color: var(--primary);
}

.markdown-body :deep(.markdown-alert-warning) {
  --md-alert-color: var(--warning);
}

.markdown-body :deep(.markdown-alert-caution) {
  --md-alert-color: var(--destructive);
}

/* ── 危险图片占位 ─────────────────────────────────────────────────── */
.markdown-body :deep(.md-blocked-image) {
  color: var(--muted-foreground);
  font-size: 0.9em;
}
</style>
