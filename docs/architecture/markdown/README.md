# Markdown 模块

## 概述

Markdown 模块提供 Markdown 文件预览功能。

## 主要组件

### 前端组件

- `src/modules/markdown/` - 模块根目录
- `MarkdownPreviewPane.vue` - 预览面板
- `MarkdownStack.vue` - 栈容器
- `lib/markdownRenderer.ts` - 渲染器
- `lib/markdownDocumentService.ts` - 文档服务

## 依赖关系

- `marked` - Markdown 解析
- `@/lib/native` - 文件读取

## 接口定义

### 类型

```typescript
type MarkdownDocumentState =
  | { status: "loading" }
  | { status: "ready"; content: string; size: number }
  | { status: "binary"; size: number }
  | { status: "toolarge"; size: number; limit: number }
  | { status: "error"; message: string }

function renderMarkdownToHtml(markdown: string): string
```

## 配置选项

- 安全渲染：过滤危险协议
- 图片懒加载：`loading="lazy"`
- 链接安全：`rel="noopener noreferrer" target="_blank"`

## 相关文档

- [详细设计](./detailed-design.md)