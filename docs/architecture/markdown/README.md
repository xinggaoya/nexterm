# Markdown markdown

## 1. 概述

Markdown 模块在 `MarkdownTab` 中显示 Markdown 文件的渲染结果。解析用 `marked`，文件读取走 `native.fsReadFile`。渲染时做协议白名单 + 链接 `rel="noopener noreferrer"`。

## 2. 目录与文件

```
src/modules/markdown/
  MarkdownPreviewPane.vue
  MarkdownStack.vue
  lib/
    markdownRenderer.ts          # marked 配置 + 协议过滤
    markdownDocumentService.ts   # 文件读取 + 状态管理
  index.ts
```

## 3. 依赖

### 3.1 内部

- `marked` -- Markdown 解析
- `@/lib/native` -- `fsReadFile`
- `@/modules/tabs` -- MarkdownTab 状态
- `@/modules/notifications/notificationCenter` -- 错误提示

## 4. 数据契约

### 4.1 公共类型

```ts
type MarkdownDocumentState =
  | { status: "loading" }
  | { status: "ready"; content: string; size: number }
  | { status: "binary"; size: number }
  | { status: "toolarge"; size: number; limit: number }
  | { status: "error"; message: string };

function renderMarkdownToHtml(markdown: string): string;
```

### 4.2 Tauri 命令

`fsReadFile`（间接）。

### 4.3 事件

无。

## 5. Pinia 状态

无独立 store；`markdownDocumentState` 是组件内 ref。

## 6. 关键算法

- `markdownDocumentService` 读文件 -> 检测二进制 / 大小超限 -> 进入 `ready`。
- `markdownRenderer` 用 `marked` 解析 + 自定义 sanitizer：过滤 `javascript:` / `data:` 协议；外链加 `rel="noopener noreferrer" target="_blank"`。
- 图片 `loading="lazy"`。

## 7. 配置项

- 大小限制（内部常量）
- 允许的协议：`https` / `http` / `mailto`
- 阻断的协议：`javascript` / `data` / `vbscript` / `file`

## 8. 测试

- `lib/markdownDocumentService.test.ts` / `lib/markdownRenderer.test.ts`
- `MarkdownPreviewPane.vue.test.ts`
- `markdownVueBoundary.test.ts`

## 9. 相关文档

- [详细设计](./detailed-design.md)
