# 标签页管理模块

## 概述

标签页管理模块负责管理所有标签页的生命周期、状态和交互。

## 主要组件

### 前端组件

- `src/modules/tabs/` - 模块根目录
- `tabsPinia.ts` - 核心 Pinia store
- `tabsTypes.ts` - 标签页类型定义
- `tabsReorder.ts` - 拖拽重排序
- `closeGuards.ts` - 关闭守卫
- `terminalDisposal.ts` - 终端清理
- `tabLabel.ts` - 标签格式化

## 依赖关系

- `@/modules/terminal/lib/panes` - 终端面板树
- Pinia - 状态管理

## 接口定义

### 标签页类型

```typescript
type Tab = TerminalTab | EditorTab | PreviewTab | MarkdownTab | GitDiffTab | GitHistoryTab | GitCommitFileDiffTab

type TerminalTab = {
  id: number
  kind: "terminal"
  title: string
  terminalTitle?: string
  cwd?: string
  paneTree: PaneNode
  activeLeafId: number
}

type EditorTab = {
  id: number
  kind: "editor"
  title: string
  path: string
  dirty: boolean
  preview: boolean
}
```

### Store API

```typescript
useTabsPiniaStore(): {
  tabs, activeId, init, resetWorkspace, setActiveId, newTab, newTaskTerminal,
  openFileTab, pinTab, moveTab, newPreviewTab, newMarkdownTab,
  openGitDiffTab, openCommitHistoryTab, openCommitFileDiffTab,
  closeTab, focusPane, setLeafCwd, setLeafTitle, updateTab,
  splitActivePane, closeActivePane
}
```

## 配置选项

- `MAX_PANES_PER_TAB = 4` - 每个终端标签最多 4 个面板
- 编辑器预览标签：单击打开为预览模式，双击固定

## 相关文档

- [详细设计](./detailed-design.md)