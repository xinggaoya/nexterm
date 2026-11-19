/**
 * Markdown 模块公共导出。
 *
 * 按模块契约，index.ts 只导出类型 / composable / 注册函数；具体组件由调用方
 * 按需 import（`@/modules/markdown/MarkdownContent.vue`），避免 Vite 的
 * chunk 优化被整包导出拖垮。
 */
export {
  renderMarkdownToHtml,
  type MarkdownAlertType,
  type MarkdownRenderOptions,
} from "./lib/markdownRenderer";
export { useMarkdownRenderOptions } from "./useMarkdownRenderOptions";
