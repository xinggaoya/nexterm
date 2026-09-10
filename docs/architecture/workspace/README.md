# 工作区 workspace（多工作区架构）

## 1. 概述

工作区模块管理**多个同时打开的工作区**。每个工作区绑定独立的环境（local 或 wsl+distro），拥有独立的 tab 集合、终端 session、文件监视器、编辑器状态，并在后台保活——切换到其他工作区时，前一个工作区的所有资源继续运行。

**核心特性**：
- 单窗口内多工作区并存（顶部工作区条切换）
- 每个工作区独立绑定 env（Windows 下 local + 多个 WSL 可同时运行）
- 后台工作区全部保活（PTY 进程、FS watcher、编辑器状态）
- tab 隶属工作区，工作区之间完全隔离

## 2. 目录与文件

```
src/modules/workspace/
  workspacesPinia.ts           # ★ 多工作区 store（核心：addWorkspace/removeWorkspace/setActive）
  workspaceRootPinia.ts        # 最近工作区历史 + 目录选择（local/wsl 走 picker 模块，ssh 走连接对话框）
  workspaceEnvPinia.ts         # WSL distro 列表 + 添加工作区时的 env 选择状态
  workspaceEnvSnapshot.ts      # WorkspaceEnv 类型 + 纯函数（workspaceScopeKey/sameWorkspaceEnv）
  workspacePath.ts             # 路径规范化工具
  workspaceNative.ts           # authorizeWorkspace 薄封装
  workspaceWindow.ts           # 多窗口（OS 窗口）打开（保留但非主要方式）
  index.ts

src/app/
  workspaceContext.ts          # ★ per-workspace 注入上下文（provide/inject {workspace, wsNative}）
  useWorkspaceLifecycle.ts     # ★ per-workspace FS watcher 生命周期
  shell/WorkspaceBar.vue       # ★ 顶部工作区切换条
  shell/WorkspaceHost.vue      # ★ 每个工作区的容器（保活渲染）

src/lib/native.ts              # createNativeForEnv(env) 工厂（env 绑定的 native 调用面）

src-tauri/src/modules/fs/watcher.rs  # FsWatcherState: HashMap<key, ActiveWatcher>（多 watcher 并发）
```

## 3. 架构决策

### 3.1 消除全局 env 单例

旧架构有一个模块级全局变量 `selectedWorkspaceEnv`，被 ~40 个 native 调用通过 `currentWorkspaceEnv()` 默认参数隐式读取。这是多工作区并发的根本阻碍——谁最后调用 `setEnv`，所有 native 调用都会路由到那个工作区。

**新方案**：`createNativeForEnv(env: WorkspaceEnv)` 工厂返回 `WorkspaceNative` 对象，所有方法闭包绑定到传入的 env。全局 `native` 对象只保留 env 无关的方法（ptyWrite/shellBgLogs 等基于 id 的）。

### 3.2 Tab 按工作区分组

旧架构：单一 `tabs: Tab[]` 数组，切换工作区时 `resetWorkspace` 销毁所有终端。

**新方案**：`tabsByWorkspace: Record<workspaceId, Tab[]>`。`tabs`/`activeId` 是派生 computed，反映当前活跃工作区的视图。切换工作区只翻 active 指针，不销毁任何资源。

### 3.3 终端 session 按工作区分片

`SESSION_REGISTRY` 从 `Map<leafId, handle>` 改为 `Map<workspaceId, Map<leafId, handle>>`。关闭工作区时 `disposeWorkspaceSessions(id)` 批量销毁。

### 3.4 后端 watcher 多实例

`FsWatcherState` 从 `Mutex<Option<ActiveWatcher>>` 改为 `Mutex<HashMap<String, ActiveWatcher>>`。`fs_unwatch_workspace` 现在接收 rootPath + workspace 参数，精确移除单个 watcher。

## 4. 数据契约

### 4.1 公共类型

```ts
type WorkspaceEnv = { kind: "local" } | { kind: "wsl"; distro: string };
type WslDistro = { name: string; default: boolean; running: boolean };

interface WorkspaceInstance {
  id: string;         // 稳定 ID：${scopeKey}:${normalizedPath}
  rootPath: string;   // 授权、规范化的根路径
  env: WorkspaceEnv;  // 该工作区独立绑定的环境
  name: string;       // 显示名（basename）
  openedAt: number;   // 首次添加的时间戳
}
```

### 4.2 持久化

```ts
// settings/store.ts
interface Preferences {
  openWorkspaces: PersistedWorkspace[];  // 上次会话打开的工作区集合
  activeWorkspaceId: string | null;      // 上次聚焦的工作区
  recentWorkspaces: StoredWorkspace[];   // 历史记录（保留）
  lastWorkspace: StoredWorkspace | null; // 迁移用（旧用户首次启动种子）
}
```

### 4.3 注入上下文

```ts
// src/app/workspaceContext.ts
interface WorkspaceContext {
  workspace: WorkspaceInstance;
  wsNative: WorkspaceNative;  // env 绑定的 native 调用面
}
// WorkspaceHost 调用 provideWorkspaceContext(ctx)
// 子组件调用 useWorkspaceContext() 获取
```

## 5. IPC 契约

所有 env-scoped 命令现在通过 `createNativeForEnv(env)` 返回的对象调用，显式绑定到工作区的 env。每个工作区的 `WorkspaceHost` 在创建时调用 `createNativeForEnv(workspace.env)` 一次，通过 provide 注入给所有后代组件。

- `fsWatchWorkspace(rootPath)` / `fsUnwatchWorkspace(rootPath)` — 在 `wsNative` 上，闭包绑定 env
- 后端 watcher 按 env+root 去重，多工作区各自独立

## 6. 测试

- `workspacesPinia.test.ts` — 多工作区增删切、隔离、去重、reorder
- `tabsPinia.test.ts` — 按工作区分组的 tab 管理、隔离、销毁
- `useWorkspaceLifecycle.test.ts` — per-workspace watcher 生命周期
- `sessions.test.ts` — 按工作区分片的终端 session 注册表
