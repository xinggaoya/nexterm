# 编辑器 editor

## 1. 概述

编辑器模块基于 CodeMirror 6 提供文本编辑、diff、Markdown 实时预览，并通过 `tabsPinia` 注册为 `EditorTab`。文件 IO 委托给 `@/lib/native`，Git diff 数据来自 `source-control` 模块。

## 2. 目录与文件

```
src/modules/editor/
  EditorPane.vue             # 文本编辑器
  EditorToolbar.vue          # 顶部工具条
  EditorStatusBar.vue        # 底部状态条（光标位置、语言、行尾）
  DiffCodeMirror.vue         # 文本 diff 渲染
  GitDiffPane.vue            # Git diff 标签
  GitDiffStack.vue           # Git diff 栈容器
  MarkdownEditorPreview.vue  # Markdown 编辑 + 预览
  editorCommands.ts          # 注册到 commands
  editorTypes.ts
  index.ts
  lib/
    documentService.ts       # 文件读写（经 native）
    diffCache.ts             # diff 缓存
    diffStats.ts             # diff 行数统计
    extensions.ts            # CodeMirror 扩展集合
    languageResolver.ts      # 文件名 -> 语言包
    themes.ts                # CodeMirror 主题
    vim.ts                   # vim 模式封装
```

## 3. 依赖

### 3.1 内部

- `@/lib/native` -- 文件读写
- `@/lib/path` -- basename / dirname
- `@/modules/settings/preferencesPinia` -- 字号 / 缩进 / 换行 / vim
- `@/modules/tabs` -- EditorTab 状态
- `@/modules/source-control` -- Git diff 数据源

### 3.2 外部

- `@codemirror/state` / `@codemirror/view` / `@codemirror/commands` / `@codemirror/search` / `@codemirror/lint` / `@codemirror/merge` / `@codemirror/lang-*`
- `@uiw/codemirror-themes` / `@uiw/codemirror-theme-*`
- `@replit/codemirror-vim`

## 4. 数据契约

### 4.1 公共类型

```ts
// editorTypes.ts
type EditorLanguage = "typescript" | "rust" | "python" | "json" | ...;
```

### 4.2 Tauri 命令（间接）

不直接 invoke；通过 `@/lib/native` 调用 `fsReadFile` / `fsWriteFile` / `fsStat` 等。

### 4.3 事件

无独立事件。

## 5. Pinia 状态

无独立 store。最近文件、当前光标位置在 `documentService` 内部 ref；未保存标记在 `tabsPinia` 的 `EditorTab.dirty` 上。

## 6. 关键算法

- `languageResolver` 根据文件后缀选择 CodeMirror 语言包。
- `extensions.ts` 组合基础扩展 + 语言 + 主题 + vim 模式。
- `documentService` 包装 `native.fsReadFile/Write`，做 dirty 跟踪、自动保存标记。
- `DiffCodeMirror` 用 `@codemirror/merge` 的 `unifiedMergeView` 渲染只读统一 diff。
- `lib/editorRuntime.ts` 提供 `mountCodeMirrorEditor` / `disposeEditor` / `safeReplaceValue`(外部重载时保留光标与滚动)。
- 主题 / 字号 / 缩进 / 换行 / Vim / 语言各走独立 `Compartment`,设置变更不重建编辑器实例。

## 7. 配置项

从 `preferencesPinia` 读：

- `editorFontSize` / `editorTabSize` / `editorWordWrap` / `vimMode`
- `editorTheme`（影响 `themes.ts` 的选择）
- `editorLspTypescriptMode`（`"builtin" | "lsp"`,经 `lib/editorPaneLsp.ts` 接通 `@/modules/lsp/manager`)

## 8. 测试

- `lib/documentService.test.ts` -- 文件 IO
- `lib/languageResolver.test.ts` -- 语言解析
- `EditorPane.vue.test.ts` / `GitDiffPane.vue.test.ts` / `diffStacks.vue.test.ts` -- 组件
- `editorVueBoundary.test.ts` -- 边界
- `diffRuntimeBoundary.test.ts` -- diff runtime 边界

## 9. 相关文档

- [详细设计](./detailed-design.md)
