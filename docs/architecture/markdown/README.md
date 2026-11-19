# Markdown markdown

## 1. 概述

Markdown 模块负责把 Markdown 渲染成预览。渲染目标是**对齐 GitHub 的 README 渲染态**：原始 HTML（居中徽章、`details`）能渲染、代码块有语法高亮、标题带分隔线、表格带表头底色。

管线：`markdown → markdown-it（+4 个插件）→ highlight.js 注入 → DOMPurify 白名单净化 → v-html`。

解析用 `markdown-it`（CommonMark 合规；GitHub 用的是 cmark-gfm，GFM 语义最接近），扩展能力全部来自成熟插件，不自研：

| 能力 | 插件 |
|---|---|
| 脚注 `[^1]` | `markdown-it-footnote` |
| 任务列表 `- [x]` | `markdown-it-task-lists` |
| 标题锚点 | `markdown-it-anchor` |
| GFM alert `> [!NOTE]` | `markdown-it-github-alerts` |

文件读取走 `native.fsReadFile`。

## 2. 目录与文件

```
src/modules/markdown/
  MarkdownContent.vue          # 共享渲染组件：v-html + GitHub 风格排版 + 代码块复制 + 外链处理
  MarkdownPreviewPane.vue      # 独立 Markdown 标签页
  MarkdownStack.vue            # 多标签叠放
  useMarkdownRenderOptions.ts  # composable：把 i18n 文案喂给渲染器
  lib/
    markdownRenderer.ts        # markdown-it 实例 + 插件 + 规则覆盖（link / image / fence）
    markdownSanitizer.ts       # DOMPurify 白名单 + URL 协议校验 + 失败关闭
    markdownHighlighter.ts     # highlight.js 语言注册表与调用
    markdownDocumentService.ts # 文件读取 + 状态管理
  types/
    markdown-it-plugins.d.ts   # 两个无类型插件的最小声明
  index.ts                     # 公共导出（函数 / composable / 类型）
```

`MarkdownContent.vue` 是**唯一**的正文渲染入口：独立 Markdown 标签页
（`MarkdownPreviewPane.vue`）和编辑器拆分预览（`src/modules/editor/MarkdownEditorPreview.vue`）
都复用它，排版样式只有一份。

## 3. 依赖

### 3.1 内部

- `@/lib/native` -- `fsReadFile`
- `@/lib/clipboard` -- `writeClipboardText`（代码块复制）
- `@/lib/openExternal` -- `openExternalUrl`（外链交给系统浏览器）
- `@/lib/tauriRuntime` -- `hasTauriInternals`（非 Tauri 环境兜底）
- `@/modules/i18n/translate` -- 复制按钮 / alert 标题文案
- `@/modules/tabs` -- MarkdownTab 状态
- `@/modules/icons` -- 预览头部文件类型图标

### 3.2 三方

- `markdown-it` + `markdown-it-footnote` / `markdown-it-task-lists` / `markdown-it-anchor` / `markdown-it-github-alerts`
- `highlight.js` -- 代码高亮（GitHub 自己用的也是它）
- `dompurify` -- HTML 白名单净化

## 4. 数据契约

### 4.1 公共类型

```ts
type MarkdownDocumentState =
  | { status: "loading" }
  | { status: "ready"; content: string; size: number }
  | { status: "binary"; size: number }
  | { status: "toolarge"; size: number; limit: number }
  | { status: "error"; message: string };

type MarkdownAlertType = "note" | "tip" | "important" | "warning" | "caution";

interface MarkdownRenderOptions {
  /** 代码块复制按钮的无障碍标签。 */
  copyLabel?: string;
  /** GFM alert 的标题文案（按类型）；缺省时插件回退到英文。 */
  alertTitles?: Partial<Record<MarkdownAlertType, string>>;
}

function renderMarkdownToHtml(markdown: string, options?: MarkdownRenderOptions): string;
```

### 4.2 Tauri 命令

`fsReadFile`（间接）。

### 4.3 事件

无。

## 5. Pinia 状态

无独立 store；`markdownDocumentState` 是组件内 ref。

## 6. 关键算法

- `markdownDocumentService` 读文件 -> 检测二进制 / 大小超限 -> 进入 `ready`。
- `markdownRenderer` 用 markdown-it 解析（`html: true`，原始 HTML 交给净化层裁决），
  覆盖三条规则：
  - `link_open`：协议白名单外的 href 整个剥掉（保留链接文字）；http(s) 补
    `target="_blank" rel="noopener noreferrer"`；相对链接不加 target。
  - `image`：`data:` 仅允许 base64 图片白名单；不在协议白名单的图片换成占位符；
    `alt` 从子 token 渲染；`loading="lazy"`。
  - `fence`：代码块外面套 `.md-code` 容器，浮出语言标签 + 复制按钮。
- 解析器实例按「文案签名」缓存：语言切换时换实例，其余情况复用。
- `markdownSanitizer` 是最后一道闸：DOMPurify 按 GitHub 允许集裁剪标签 / 属性 /
  协议；净化器不可用（非 DOM 环境）时**失败关闭**，整段转义。
- `markdownHighlighter` 只注册 README 常见的 29 个语言；语言未知时退回纯文本。

## 7. 安全模型

预览正文跑在 webview 主 origin 上（持有全部 IPC 能力），所以渲染链路上有三层：

1. **解析层**：markdown-it 自身的 `validateLink` 被放宽（解析期不判协议），
   目的是让链接文字保留、href 落空 —— 与 GitHub 一致。
2. **渲染层**：协议白名单（http/https/mailto/ftp/ftps/tel）+ `data:` 图片白名单，
   拦掉 `javascript:` / `data:` / `vbscript:` / `file:` 以及被前导空白 / 控制字节
   伪装过的协议。
3. **净化层**：DOMPurify 白名单 —— 标签集、属性集、URI 正则三层过滤，
   `script` / `style` / `iframe` / `form` / `svg` 外部引用等一律剔除。

任何一层失效都还有下一层兜底。

## 8. 配置项

- 大小限制（内部常量）
- 允许的协议：`https` / `http` / `mailto` / `ftp` / `ftps` / `tel`
- 阻断的协议：`javascript` / `data` / `vbscript` / `file`
- 主题令牌：`--markdown-link` / `--markdown-code-bg` / `--markdown-table-head-bg`

## 9. 测试

- `lib/markdownDocumentService.test.ts` / `lib/markdownRenderer.test.ts`
- `MarkdownContent.vue.test.ts` / `MarkdownPreviewPane.vue.test.ts`
- `markdownVueBoundary.test.ts`

渲染器测试跑在 jsdom 环境（DOMPurify 需要 DOM）。

## 10. 相关文档

- [详细设计](./detailed-design.md)
