# 工作区 workspace

## 1. 概述

工作区模块管理"当前根目录"和"环境（local / wsl）"。根目录变化触发 FS watcher 重建、tabs 重置、env 切换；WSL 走独立的 `nexterm-wsl-watcher-helper` 监控。

## 2. 目录与文件

```
src/modules/workspace/
  workspaceRootPinia.ts        # 根目录 store（setup-function）
  workspaceEnvPinia.ts         # env store（setup-function）
  workspaceEnvSnapshot.ts      # env 快照
  workspacePath.ts             # 路径工具
  workspaceDialog.ts           # 文件夹选择对话框
  workspaceNative.ts           # native.ts 的薄封装
  workspaceWindow.ts           # 窗口操作
  index.ts
```

## 3. 依赖

### 3.1 内部

- `@/lib/native` -- `workspaceAuthorize` / `wslListDistros` / `getWslHome` / `fsWatchWorkspace`
- `@/lib/launchDir` -- 启动目录 bootstrap
- `@/modules/settings/preferencesPinia` -- `lastWorkspace` / `recentWorkspaces` / `lastWslDistro`
- `@/modules/tabs` -- `resetWorkspace`

## 4. 数据契约

### 4.1 公共类型

```ts
type WorkspaceEnv = { kind: "local" } | { kind: "wsl"; distro: string };
type WslDistro = { name: string; default: boolean; running: boolean };
type StoredWorkspace = { path: string; env: WorkspaceEnv; openedAt: number };
type WorkspaceSelection = { path: string; env: WorkspaceEnv };
```

### 4.2 Tauri 命令

| 命令 | 说明 |
|------|------|
| `wsl_list_distros` | 列 WSL 发行版 |
| `wsl_default_distro` | 默认 distro |
| `wsl_home` | WSL 家目录（UNC） |
| `workspace_authorize` | 授权工作区根 |
| `workspace_current_dir` | 当前 cwd（含 WSL 转换） |

### 4.3 事件

无；由 `useWorkspaceLifecycle` 注入生命周期。

## 5. Pinia 状态

- `useWorkspaceRootPiniaStore` -- `hydrated` / `loading` / `rootPath` / `lastWorkspace` / `recentWorkspaces` / `error`
- `useWorkspaceEnvPiniaStore` -- `env` / `distros` / `loading` / `error`

action：`bootstrap` / `openWorkspace` / `pickWorkspaceDirectory` / `chooseWorkspace` / `clearWorkspace` / `setEnv` / `refreshDistros`。

## 6. 关键算法

- `bootstrap(launchWorkspace?)` 顺序：先 `hydrate` 偏好读 `lastWorkspace` -> 调用 `openWorkspace`。
- WSL 工作区在 `openWorkspace` 时记录 `recentWorkspaces`，但 `lastWorkspace` 只在成功打开后写入。
- `setEnv` 会触发 `native.fsWatchWorkspace` 重建。

## 7. 配置项

- `RECENT_WORKSPACE_LIMIT = 10`（内部常量）
- WSL UNC 路径格式：`\\wsl.localhost\<distro>\<path>`

## 8. 测试

- `workspaceRootPinia.test.ts` / `workspaceEnvPinia.test.ts` / `workspaceEnvSnapshot.test.ts`

## 9. 相关文档

- [详细设计](./detailed-design.md)
- [01-overview.md](./../01-overview.md) -- 启动流程
- [04-security-model.md](./../04-security-model.md) -- `WorkspaceRegistry`
