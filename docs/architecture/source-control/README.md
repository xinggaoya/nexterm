# 源代码控制模块

## 概述

源代码控制模块提供 Git 操作的 UI 界面，支持文件暂存、提交、分支管理等功能。

## 主要组件

### 前端组件

- `src/modules/source-control/` - 模块根目录
- `SourceControlPanel.vue` - 主面板组件
- `SourceControlChangeList.vue` - 文件变更列表
- `SourceControlCommitBox.vue` - 提交消息输入框
- `SourceControlGitWorkflows.vue` - Git 工作流操作
- `SourceControlToolbar.vue` - 工具栏
- `useSourceControlState.ts` - 状态管理
- `useSourceControlActions.ts` - Git 操作
- `useSourceControlGitMetadata.ts` - Git 元数据

## 依赖关系

- `@/lib/native` - Tauri IPC 调用
- `@/modules/i18n/translate` - 国际化
- `@/modules/notifications/notificationCenter` - 通知系统
- `@/modules/commands/types` - 命令类型定义

## 接口定义

### 数据类型

```typescript
type SourceControlFileEntry = {
  key: string
  group: SourceControlGroupId
  path: string
  originalPath: string | null
  statusCode: string
  statusLabel: string
  statusKind: SourceControlStatusKind
  diffMode: DiffMode
  checkState: CheckState
  staged: boolean
  unstaged: boolean
  untracked: boolean
}

type GitDecorationMap = Map<string, GitPathDecoration>
```

### 事件

- `decorationsChange` - Git 装饰变化
- `openDiff` - 打开 diff 视图
- `openHistory` - 打开历史视图
- `committed` - 提交完成

## 配置选项

- `rootPath: string | null` - 工作区根路径
- `fsEvent: WorkspaceFsChangedEvent | null` - 文件系统事件
- 自动刷新延迟：Git 事件 80ms，非 Git 事件 500ms

## 相关文档

- [详细设计](./detailed-design.md)