/**
 * 第三方 markdown-it 插件的最小类型声明。
 *
 * `markdown-it-task-lists` 与 `markdown-it-footnote` 都没有随包发布
 * `.d.ts`，但它们是渲染管线的一等公民（任务列表 / 脚注）。这里只声明
 * 本项目实际用到的入口，不猜它们的内部实现。
 */
declare module "highlight.js/lib/core" {
  import type { HLJSApi } from "highlight.js";

  const hljs: HLJSApi;
  export default hljs;
}

declare module "markdown-it-task-lists" {
  import type { MarkdownIt } from "markdown-it";

  interface TaskListsOptions {
    /** false = 复选框 disabled（GitHub 行为：只读，不可勾选） */
    enabled?: boolean;
    /** 用 <label> 包裹复选框文本 */
    label?: boolean;
    /** <label> 放在文本之后 */
    labelAfter?: boolean;
  }

  const plugin: (md: MarkdownIt, options?: TaskListsOptions) => void;
  export default plugin;
}

declare module "markdown-it-footnote" {
  import type { MarkdownIt } from "markdown-it";

  const plugin: (md: MarkdownIt) => void;
  export default plugin;
}
