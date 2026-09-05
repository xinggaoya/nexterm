# 01. 全局架构与设计原则

## 1. 项目定位

Nexterm 是一个 Tauri 2 桌面应用，把"终端 + 编辑器 + 文件树 + Git + 任务 + 预览"塞进同一个原生窗口。它面向需要把开发环境集中到一个工具里的用户：长生命周期终端会话、dev server 后台保持、文件即开即编辑、Git 操作内联完成、任务一键运行。

## 2. 设计原则

### 2.1 Rust 后端是唯一的系统访问层

Webview **永远不**直接访问：

- 文件系统（无论浏览器 `fs` 提案还是 Node `fs`）
- 进程 / shell
- 系统密钥或敏感配置
- 任何 native API（窗口、菜单、托盘）

Webview 与 Rust 之间**只有一个 IPC 出口**：`src/lib/native.ts`。所有 invoke 必须经过 `native.*` 或那几个 top-level helper（`onDeepLinkOpen` / `relaunchApp` / `exitApp`）。`src/lib/nativeBoundary.test.ts` 用静态扫描保证不会有代码绕过这一层。

### 2.2 模块自治与白名单通信

前端按 17 个领域模块划分。模块之间**只允许**通过三种白名单通道通信：

1. **共享 Pinia store**：例如 `preferencesPinia` 被 `commands` / `editor` / `terminal` 同时读取。
2. **直接 composable / 组件挂载**：A 模块组件挂载时调用 B 模块的 composable。
3. **Tauri 事件总线**：跨模块广播后端事件（PTY output、文件变化、深链）。

**禁止**：

- store A 直接 import store B 的状态
- 模块内订阅其他模块的事件总线做"数据同步"
- 通过全局变量、window 上挂 ref、模块单例等方式共享状态

### 2.3 状态最小化

- 能放进 composable 的不放在 store。
- 能放在组件 `ref` 的不放在 store。
- store 只放真正**跨模块共享**的状态。
- 偏好只有一份：`preferencesPinia`（21 个字段）。其他模块不维护"重复"的偏好。

### 2.4 显式优于隐式

- IPC 命令的 `workspace` 参数必须显式传（不能依赖"当前 workspace"环境变量）。
- 路径边界处显式归一化（`@/lib/path`）。
- 错误显式 throw 或 reject；不在控制台悄悄吞掉。

### 2.5 类型先行

- `src/lib/native.ts` 是 IPC 契约的"权威来源"，Rust 端用 `serde::Serialize` / `serde::Deserialize` 自动转换。
- 任何 Rust 端新增命令**必须**先在 `native.ts` 写 TypeScript 类型签名。
- TS 严格模式 + `noUnusedLocals` / `noUnusedParameters` + `noFallthroughCasesInSwitch`；CI 用 `vue-tsc --noEmit` 守门。

### 2.6 边界测试优先于单元测试

当改动涉及：

- 模块所有权（谁拥有哪一段代码）
- 框架迁移规则（React 残留、Options API 残留）
- IPC 契约（新增/修改/删除 Tauri 命令）
- 安全敏感行为（授权、路径处理、深链解析）

必须配套写一个**边界测试**（`*Boundary.test.ts`）而不是普通单元测试。现有边界测试目录：

- `src/lib/nativeBoundary.test.ts` -- IPC 收口
- `src/lib/eventBoundary.test.ts` -- 事件总线收口
- `src/lib/noOptionsApiBoundary.test.ts` -- 无 Options API
- `src/lib/translationTraces.test.ts` -- 无 React 命名
- `src/app/noAiFeaturesBoundary.test.ts` -- 无 AI 功能
- `src/app/noReactPackageBoundary.test.ts` -- 无 React 依赖
- `src/app/noReactSourceBoundary.test.ts` -- 无 React 源码
- `src/app/noRemoteTerminalBoundary.test.ts` -- 无远程终端
- `src/app/vueShellBoundary.test.ts` -- 纯 Vue shell
- `src/app/tauriCapabilities.test.ts` -- Tauri capability 配置
- `src/modules/pinia/setupStoreBoundary.test.ts` -- Pinia setup 模式
- `src/modules/<module>/<...>Boundary.test.ts` -- 模块级边界

## 3. 总体架构

```
+------------------------------------------------------+
|  Vue 3 Webview                                       |
|  MainApp.vue -> Workbench shell -> TabBar + PaneStack|
|  Pinia stores <-> native.ts <-> Tauri IPC            |
+--------------------------+---------------------------+
                           | Tauri IPC + Channel
+--------------------------v---------------------------+
|  Rust Backend (src-tauri/src/lib.rs)                 |
|  pty | shell | fs | git | workspace | lock | process |
+------------------------------------------------------+
```

### 3.1 前端

- **入口**：`src/main.ts` 创建 Vue app、装载 Pinia/i18n、bootstrap 偏好与工作区。
- **应用壳**：`src/app/`（`MainApp.vue` + `shell/` + `components/` + composables）。
- **业务模块**：`src/modules/<domain>/`。
- **共享工具**：`src/lib/`（`native.ts` 最重要；`path.ts` / `normalizeError.ts` / `refs.ts` / `useEventListener.ts` 次之）。
- **全局共享组件**：`src/components/`（注意：不是全局自动注册，需显式 import）。
- **设置抽屉**：`src/settings/`（`SettingsPanel.vue` + `sections/`）。
- **样式**：`src/styles/`（`tokens.ts` 是 oklch 解析核心）。

### 3.2 后端

- **入口**：`src-tauri/src/lib.rs` 注册所有 Tauri 命令、装配插件、管理全局 state。
- **模块**：`src-tauri/src/modules/<domain>/`。
- **lock**：`lock.rs` 是所有 `Mutex` / `RwLock` 的统一入口。
- **WSL 辅助**：`agent/` 独立二进制（watch/fs/exec 一体）。
- **Panic hook**：`panic_report.rs`。

## 4. 关键数据流

### 4.1 启动

1. Tauri 启动 -> `lib.rs::run()`。
2. 装配插件：window-state（隐藏 VISIBLE 避免闪烁）、store、os、dialog、clipboard-manager、notification、log、opener、positioner、process、deep-link、autostart。
3. 全局 state：`PtyState` / `ShellState` / `FsWatcherState` / `WorkspaceRegistry`（预先用启动目录 bootstrap）/ `LaunchDir`（只在首次读一次）。
4. 注册 deep-link 监听，把冷启动的 URL 也发到 `nexterm://deep-link-open`。
5. 前端 `main.ts`：
   - 设置 `data-chrome="borderless"`（如果使用自定义窗口控件）。
   - `initLaunchDir()` 拉启动目录。
   - 创建 Pinia + i18n + 装载。
   - `prefs.hydrate()` 异步水合偏好。
   - `applyLanguagePreference` 设置语言。
   - `workspaceRootPiniaStore.bootstrap(getLaunchWorkspace())` 决定首屏工作区。
   - 50ms / 500ms 后 `window.show()`（双保险，避免透明窗口闪烁）。
   - 订阅 `nexterm://deep-link-open` 处理冷启动 / 运行期深链。

### 4.2 业务调用

1. 用户在 Vue 组件中操作 -> 调用组件本地方法 / composable。
2. composable 调用 Pinia action 或直接调 `native.*`。
3. `native.*` 调 `invoke<T>(...)`，并把 `workspace: currentWorkspaceEnv()` 透传。
4. Rust 端 `#[tauri::command] fn foo(state, registry, workspace, ...)` 先过 `authorize_*`，再执行业务。
5. 业务结果 `Result<T, String>` resolve/reject。
6. 事件型输出（PTY chunk / 文件变化）走 Tauri `Channel` 或 `emit`。

### 4.3 关闭

1. 标签页关闭：`closeGuards` 检查未保存，弹 `UnsavedCloseGuard`。
2. 终端关闭：触发 `pty_close`，Rust 在独立线程 drop `Arc<Session>`（避免 Windows `ClosePseudoConsole` 阻塞 Tauri worker）。
3. 工作区切换：`fs_unwatch_workspace` + `fs_watch_workspace`。
4. 应用关闭：Tauri 把 `PtyState` / `ShellState` drop -> 子进程随 `JobObject` 终止（Windows）。

## 5. 状态归属

| 状态 | 归属 | 说明 |
|------|------|------|
| 用户偏好 | `preferencesPinia` | 21 个字段，与 Rust `LazyStore` 双向同步 |
| 标签页 | `tabsPinia` | tab 数组、activeId、pane tree |
| 工作区根 | `workspaceRootPinia` | 根路径、最近工作区、bootstrap 状态 |
| 工作区 env | `workspaceEnvPinia` | local / wsl，distro 列表 |
| 任务运行实例 | `taskRunStore`（工厂） | 日志、状态、退出码 |
| 文件树 rows | `explorer/lib/fileTreeRows.ts` 内部 ref | 组件内状态（不跨模块共享） |
| 终端 session | `terminalSessionCore.ts` 内部 ref | 组件内状态 |
| 编辑器 doc | `editor/lib/documentService.ts` | 跨编辑器 tab 共享最近文件 |
| Git 状态 | `useSourceControlState` | source-control 内部 ref |
| 主题 | `theme/naiveTheme.ts`（无状态） | 通过 `AppTokens` 派发 |
| 语言 | `i18n/index.ts` | 单一 `i18n` 实例 |

## 6. 安全模型（摘要）

详细见 [04-security-model.md](./04-security-model.md)。摘要：

1. 所有 fs/pty/shell/git 命令必须过 `WorkspaceRegistry.authorize_*`。
2. Windows shell 子进程必须挂 `Job Object`。
3. PTY 输出走 Tauri `Channel` 流式 + `Transcript` 临时文件双轨制。
4. Windows ConPTY 必须序列化保护，避免首屏输出管道卡住。
5. 所有 `nexterm://` URL 在 Rust 端解析为 `DeepLinkOpenRequest` 再发给前端。
6. Webview 不直接接触 fs/进程/shell。

## 7. 性能考量

1. **PTY chunk 合并**：`FLUSH_COALESCE = 6ms` 把短窗口内的小 chunk 合并，降低 Channel 帧率。
2. **transcript 上限**：`MAX_TRANSCRIPT_READ = 4 MiB`、`MAX_PENDING = 6 MiB`。
3. **FS watcher 反压**：`events.rs` 用事件量阈值、根级刷新降级、max batch age、重复签名节流，不特殊化目录名。
4. **Vite manualChunks**：`xterm` / `codemirror` / `vue-vendor` 三个分块。
5. **Tailwind v4** 仅用于布局，不参与组件主题，主题一律走 `AppTokens` 派生。
6. **Pinia 字段粒度**：`preferencesPinia` 21 个字段独立 `ref`，避免一刀切重渲染。

## 8. 兼容性

- **macOS / Windows / Linux**：桌面应用跨三大平台。
- **本地 / WSL**：Windows 下支持 WSL 工作区。
- **现代 Node**：使用 Vite 7 + ESM + `bundler` 模块解析。
- **Rust 工具链**：`cargo` 2021 edition；release profile 开启 `lto=fat` / `opt-level=s` / `panic=abort` / `strip=true`。
