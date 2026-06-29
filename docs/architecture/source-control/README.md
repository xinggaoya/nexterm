# 源代码控制 source-control

## 1. 概述

源代码控制模块提供 Git 状态面板：变更列表、暂存 / 取消暂存、提交、分支工作流、远程同步。底层命令经 `native.git*`；FS watcher 事件触发自动刷新。

## 2. 目录与文件

```
src/modules/source-control/
  SourceControlPanel.vue            # 主面板
  SourceControlChangeList.vue       # 变更列表
  SourceControlChangeRow.vue        # 单行
  SourceControlCommitBox.vue        # 提交输入
  SourceControlGitWorkflows.vue     # fetch/pull/push 工作流
  SourceControlToolbar.vue          # 工具条
  sourceControlCommands.ts          # 注册到 commands
  sourceControlModel.ts             # 数据模型
  sourceControlFormat.ts            # 状态码 -> 标签
  gitDecorations.ts                 # 装饰映射
  useSourceControlState.ts          # 状态 composable
  useSourceControlActions.ts        # 动作 composable
  useSourceControlGitMetadata.ts    # 元数据 composable
  index.ts
```

## 3. 依赖

### 3.1 内部

- `@/lib/native` -- `git*` 命令
- `@/modules/explorer/lib/iconResolver` -- 文件图标
- `@/modules/i18n/translate` -- 国际化
- `@/modules/notifications/notificationCenter`
- `@/modules/commands/types` -- CommandSpec
- `@/modules/editor` -- 打开 diff 标签
- `@/modules/tabs` -- GitDiffTab 状态

## 4. 数据契约

### 4.1 公共类型

```ts
type SourceControlFileEntry = {
  key: string;
  group: SourceControlGroupId;
  path: string;
  originalPath: string | null;
  statusCode: string;
  statusLabel: string;
  statusKind: SourceControlStatusKind;
  diffMode: DiffMode;
  checkState: CheckState;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
};

type GitDecorationMap = Map<string, GitPathDecoration>;
type SourceControlGroupId = "merge" | "index" | "working" | "untracked";
```

### 4.2 Tauri 命令

`gitResolveRepo` / `gitPanelSnapshot` / `gitStatus` / `gitDiff` / `gitDiffContent` / `gitStage` / `gitUnstage` / `gitDiscard` / `gitCommit` / `gitFetch` / `gitPullFfOnly` / `gitPush` / `gitBranchList` / `gitCheckoutBranch` / `gitCreateBranch` / `gitStashList` / `gitStashPush` / `gitStashPop` / `gitStashDrop`。

### 4.3 事件

- 内部 `decorationsChange` / `openDiff` / `openHistory` / `committed`，由 composable 之间共享。
- 监听 `nexterm://workspace-fs-changed` 触发自动刷新。

## 5. Pinia 状态

无独立 store。状态由 `useSourceControlState` composable 维护（组件作用域 ref），跨组件通过 props 传递或在 `MainApp` 中提升。

## 6. 关键算法

- `useSourceControlState` 拉 `gitPanelSnapshot` 拿到全部数据后，按 `SourceControlGroupId` 分组。
- 自动刷新延迟：Git 事件 80ms，非 Git 事件 500ms（防抖）。
- 装饰（`gitDecorations`）根据 status code 映射到 `{color, letter, tooltip}`。

## 7. 配置项

- `rootPath: string | null` -- 工作区根
- 刷新延迟（内部常量）

## 8. 测试

- `gitDecorations.test.ts` / `sourceControlFormat.test.ts` / `sourceControlModel.test.ts`
- `useSourceControlState.test.ts` / `useSourceControlActions.test.ts`
- `SourceControlPanel.vue.test.ts`（main 上有 1 个预存在失败）
- `sourceControlVueBoundary.test.ts`

## 9. 相关文档

- [详细设计](./detailed-design.md)
