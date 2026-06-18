# 工作区模块

## 概述

工作区模块负责管理工作区根路径、环境配置和 WSL 支持。

## 主要组件

### 前端组件

- `src/modules/workspace/` - 模块根目录
- `workspaceRootPinia.ts` - 根路径管理
- `workspaceEnvPinia.ts` - 环境管理
- `workspaceEnvSnapshot.ts` - 环境快照
- `workspacePath.ts` - 路径工具
- `workspaceDialog.ts` - 对话框
- `workspaceNative.ts` - 原生操作
- `workspaceWindow.ts` - 窗口管理

## 依赖关系

- `@/modules/settings/store` - 持久化
- `@/lib/native` - Tauri IPC

## 接口定义

### 数据类型

```typescript
type WorkspaceEnv = { kind: "local" } | { kind: "wsl"; distro: string }

type WslDistro = { name: string; default: boolean; running: boolean }

type StoredWorkspace = { path: string; env: WorkspaceEnv; openedAt: number }

type WorkspaceSelection = { path: string; env: WorkspaceEnv }
```

### Store API

```typescript
useWorkspaceRootPiniaStore(): {
  hydrated, loading, rootPath, lastWorkspace, recentWorkspaces, error,
  bootstrap, openWorkspace, pickWorkspaceDirectory, chooseWorkspace, clearWorkspace
}

useWorkspaceEnvPiniaStore(): {
  env, distros, loading, error, setEnv, refreshDistros
}
```

## 配置选项

- `RECENT_WORKSPACE_LIMIT = 10` - 最近工作区数量限制
- WSL UNC 路径格式：`\\wsl.localhost\<distro>\<path>`

## 相关文档

- [详细设计](./detailed-design.md)