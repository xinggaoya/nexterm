# 任务管理 tasks

## 1. 概述

任务模块负责发现工作区中的"可运行命令"（pnpm/yarn/bun/npm scripts、cargo、make targets）并执行它们。运行实例由 `useTaskConsoleController` 的 `createTaskRunStore` 工厂创建。

## 2. 目录与文件

```
src/modules/tasks/
  TaskConsole.vue
  taskDiscovery.ts        # 任务发现
  taskRunStore.ts         # 任务运行实例 store（工厂）
  taskTypes.ts
  taskCommands.ts         # 注册到 commands
  taskConsoleTypes.ts
  index.ts
```

## 3. 依赖

### 3.1 内部

- `@/lib/native` -- `shellBgSpawn` / `shellBgLogs` / `shellBgKill` / `shellBgList`
- `@/modules/commands/types` -- CommandSpec
- `@/modules/notifications/notificationCenter`

## 4. 数据契约

### 4.1 公共类型

```ts
type WorkspaceTask = {
  id: string;
  title: string;
  command: string;
  source: "package" | "cargo" | "make";
  detail: string;
};

type TaskRun = {
  id: number;
  handle: number | null;
  groupId: number | null;
  task: WorkspaceTask | null;
  title: string;
  command: string;
  cwd: string;
  status: TaskRunStatus;
  exitCode: number | null;
  startedAtMs: number;
  log: string;
  logOffset: number;
  droppedBytes: number;
  error: string | null;
};
```

### 4.2 Tauri 命令

| 命令 | 说明 |
|------|------|
| `shell_bg_spawn` | 启动后台进程 |
| `shell_bg_logs` | 增量拉日志 |
| `shell_bg_kill` | 终止 |
| `shell_bg_list` | 列所有 |

### 4.3 事件

无；用轮询 + `shell_bg_logs` 拉日志。

## 5. Pinia 状态

`createTaskRunStore(options?)` 工厂：每个调用方各自 `useXxx()`。可配置 `autoPoll` / `pollIntervalMs`。

## 6. 关键算法

- `taskDiscovery` 读 `package.json` / `Cargo.toml` / `Makefile`，把脚本 / 目标转成 `WorkspaceTask`。
- `taskRunStore` 用 `setInterval` 周期调 `shell_bg_logs`，合并到本地 `log`，避免整段重传。
- 退出时调 `shell_bg_kill` + 清轮询。

## 7. 配置项

- `autoPoll: boolean`（默认 `true`）
- `pollIntervalMs: number`（默认 800）

## 8. 测试

- `taskDiscovery.test.ts` / `taskRunStore.test.ts`
- `TaskConsole.vue.test.ts`

## 9. 相关文档

- [详细设计](./detailed-design.md)
