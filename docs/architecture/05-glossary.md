# 05. 术语表

> 给新成员一份速查表。术语在仓库代码 / 文档中以英文原样出现。

## 基础设施

| 术语 | 含义 |
|------|------|
| Tauri | 桌面应用框架，Rust 后端 + 系统 webview |
| Webview | Tauri 嵌入的系统 webview（macOS WKWebView / Windows WebView2 / Linux WebKitGTK） |
| IPC | 进程间通信，Tauri 中特指 `invoke` + 事件 |
| `invoke` | 前端调 Rust 命令 |
| `Channel<T>` | Tauri 2 的流式通道，用于 PTY 等高频输出 |
| `emit` / `listen` | 事件总线，前端 `emit` / Rust 端 `Emitter::emit` |

## 前端

| 术语 | 含义 |
|------|------|
| Pinia | Vue 3 状态管理库，仓库全部使用 setup-function 模式 |
| Composable | 以 `useXxx` 命名的函数，内部用 Vue 组合式 API |
| Naive UI | 主要 UI 组件库 |
| NConfigProvider | Naive UI 的全局配置 provider，注入 theme / locale |
| themeOverrides | Naive UI 主题覆盖对象，由 `AppTokens` 派生 |
| AppTokens | 设计 token 集合（颜色 / 间距 / 圆角 / 字号），oklch 解析后供全应用使用 |
| Auto-import | `unplugin-auto-import` 提供的 Vue/Pinia/Router API 自动 import |
| Auto-component | `unplugin-vue-components` 提供的 Naive UI 组件自动注册 |
| Manual chunks | Vite `manualChunks` 把第三方库拆分到独立 chunk |
| Boundary test | 静态扫描式测试，约束代码风格 / 模块所有权 / 框架迁移规则 |

## 前端模块

| 术语 | 含义 |
|------|------|
| Workspace | 工作区根目录，local 或 WSL |
| Tab | 标签页，类型见 `tabsTypes.ts`（Terminal / Editor / Preview / Markdown / GitDiff / GitHistory / GitCommitFileDiff） |
| Pane | 标签页内的"格子"，可水平 / 垂直拆分 |
| Leaf | 拆分的最小单元，承载一个实际 tab 渲染（terminal / editor 等） |
| PaneNode | 拆分的树节点：`{kind: "leaf", id, cwd?}` 或 `{kind: "split", dir, children: [PaneNode, PaneNode], sizes}` |
| Preview | 内嵌 webview URL 预览 |
| Terminal | 终端标签，使用 xterm.js 渲染 + PTY 后端 |
| Renderer | xterm.js 的 `Terminal` 实例 |
| Renderer pool | 跨 pane 共享的 xterm 实例池（`terminal/lib/rendererPool.ts`） |
| Transcript | PTY 输出的临时文件缓冲（`pty::session::Transcript`） |
| Transcript read | 客户端通过 `pty_read_transcript` 拉取片段，携带 `start_offset` |
| OSC handler | 解析 xterm 的 OSC 7（工作目录）等序列 |
| Stash | Git 暂存栈 |
| Branch | Git 分支 |

## 后端

| 术语 | 含义 |
|------|------|
| PTY | 伪终端（pseudo-terminal），通过 `portable-pty` crate 创建 |
| ConPTY | Windows 的现代 PTY 实现 |
| Session | `pty::session::Session`，一个 PTY 会话的完整状态（master / writer / killer / transcript） |
| Transcript | 临时文件形式的 PTY 输出缓冲，参见上方 |
| Job Object | Windows 内核对象，把进程和子进程绑定到 Job，父进程退出时一起结束 |
| WorkspaceRegistry | 已授权工作区根集合 + canonical 缓存 |
| WorkspaceEnv | 工作区环境：`{kind: "local"}` 或 `{kind: "wsl", distro: string}` |
| Canonical | 把路径解析为绝对路径、消除 `..` / `.` / 软链 |
| TOCTOU | Time-Of-Check to Time-Of-Use，`canonicalize_cached` TTL = 1s 缓解 |
| Lock 毒化 | `Mutex` 持有者 panic 后锁被标记"poisoned"；本项目用 `lock.rs` 包装，panic 后携带上下文 |
| Blocking helper | `tauri::async_runtime::spawn_blocking`，把同步 IO 卸载到线程池 |
| HMR | Vite Hot Module Replacement，TAURI dev 时通过 `1421` 走 WebSocket |
| nexterm-agent | WSL/远端常驻代理，承载 fs/git/watch（watch 子命令 stdout 输出 JSON 行） |

## 事件 / 协议

| 术语 | 含义 |
|------|------|
| `nexterm://workspace-fs-changed` | 工作区文件变化事件 |
| `nexterm://deep-link-open` | 深链 / 启动目录事件 |
| `nexterm://open?workspacePath=...&workspaceEnv=...&wslDistro=...` | 显式工作区深链 |
| `nexterm:///absolute/path` | 隐式 local 工作区深链 |

## 测试 / CI

| 术语 | 含义 |
|------|------|
| Vitest | 测试框架 |
| jsdom | 测试环境的 DOM 实现 |
| `vi.mock` | Vitest 的 mock 函数 |
| `vi.hoisted` | Vitest 的 mock 提升，import 之前执行 |
| `@vue/test-utils` | Vue 组件测试工具 |
| `vue-tsc` | Vue + TypeScript 类型检查 |
| `cargo clippy` | Rust lint 工具 |
| LTO | Link-Time Optimization（release 开启 fat） |

## 设计原则（精炼）

| 原则 | 含义 |
|------|------|
| 唯一 IPC 出口 | 任何 `invoke` 必经 `src/lib/native.ts` |
| 唯一系统访问层 | 任何 fs/pty/shell/git 必经 Rust |
| 白名单通信 | 模块间只用 Pinia store / composable / 事件总线三种通道 |
| Setup-function Pinia | 强制 setup-function 模式，无 `this.*` |
| 显式 workspace 透传 | 每次 IPC 显式带 `WorkspaceEnv` |
