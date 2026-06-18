# 任务管理模块

## 概述

任务管理模块负责发现、执行和管理项目任务。

## 主要组件

### 前端组件

- `src/modules/tasks/` - 模块根目录
- `TaskConsole.vue` - 任务控制台
- `taskDiscovery.ts` - 任务自动发现
- `taskRunStore.ts` - 任务运行状态
- `taskCommands.ts` - 任务命令
- `taskTypes.ts` - 任务类型

## 依赖关系

- `@/lib/native` - Shell 命令调用
- `@/modules/commands/types` - 命令规范

## 接口定义

### 数据类型

```typescript
type WorkspaceTask = {
  id: string
  title: string
  command: string
  source: "package" | "cargo" | "make"
  detail: string
}

type TaskRun = {
  id: number
  handle: number | null
  groupId: number | null
  task: WorkspaceTask | null
  title: string
  command: string
  cwd: string
  status: TaskRunStatus
  exitCode: number | null
  startedAtMs: number
  log: string
  logOffset: number
  droppedBytes: number
  error: string | null
}
```

### 工厂函数

```typescript
createTaskRunStore(options?: TaskRunStoreOptions): TaskRunStore
```

## 配置选项

- `autoPoll: boolean` (默认 true) - 自动轮询
- `pollIntervalMs: number` (默认 800ms) - 轮询间隔
- 支持的任务源：pnpm/yarn/bun/npm scripts, cargo, make targets

## 相关文档

- [详细设计](./detailed-design.md)