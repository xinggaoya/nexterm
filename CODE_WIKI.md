# Nexterm Code Wiki

## 项目概述

Nexterm 是一个基于 **Tauri 2 + Rust 后端 + Vue 3 + TypeScript 前端** 的现代化终端开发环境，旨在提供跨平台的专业终端体验。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri 2 |
| 后端语言 | Rust |
| 前端框架 | Vue 3 + TypeScript |
| UI 组件库 | Naive UI |
| 终端渲染 | xterm.js |
| 代码编辑器 | CodeMirror 6 |
| 状态管理 | Pinia |
| 构建工具 | Vite |
| 包管理器 | pnpm |

---

## 项目结构

```
nexterm/
├── src/                          # 前端 Vue 3 + TypeScript
│   ├── main.ts                   # 前端入口
│   ├── App.vue                   # 根组件
│   ├── app/                      # 应用外壳
│   ├── modules/                  # 功能模块（按领域划分）
│   ├── lib/                      # 共享工具
│   ├── components/               # 共享组件
│   ├── styles/                   # 全局样式
│   └── settings/                 # 设置窗口
│
├── src-tauri/                     # 后端 Rust
│   ├── src/
│   │   ├── lib.rs                # Tauri 命令注册入口
│   │   ├── main.rs               # 后端入口
│   │   └── modules/              # Rust 后端模块
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── icons/
│
├── public/                        # 静态资源
├── NEXTERM.md                     # 项目设计文档
└── package.json
```

---

## 前端架构

### 模块结构 (`src/modules/`)

| 模块 | 路径 | 职责 |
|------|------|------|
| **terminal** | `modules/terminal/` | 终端面板管理、xterm.js 渲染、PTY 桥接、窗格管理 |
| **editor** | `modules/editor/` | CodeMirror 编辑器、diff 视图、语言解析、主题 |
| **source-control** | `modules/source-control/` | Git 状态、提交、分支操作 |
| **git-history** | `modules/git-history/` | Git 历史浏览 |
| **explorer** | `modules/explorer/` | 文件树浏览器 |
| **tabs** | `modules/tabs/` | 标签页管理、拖拽排序 |
| **tasks** | `modules/tasks/` | 任务发现和运行 |
| **settings** | `modules/settings/` | 设置面板配置 |
| **commands** | `modules/commands/` | 命令面板、快捷键绑定 |
| **workspace** | `modules/workspace/` | 工作区根目录管理、环境选择 |
| **theme** | `modules/theme/` | Naive UI 主题定制 |
| **preview** | `modules/preview/` | Web 预览 |
| **notifications** | `modules/notifications/` | 通知系统 |
| **i18n** | `modules/i18n/` | 国际化 |

### 应用壳 (`src/app/`)

| 文件 | 职责 |
|------|------|
| `MainApp.vue` | 主应用组件，协调所有模块 |
| `composables/useWorkbenchCommands.ts` | 工作台命令集成 |
| `composables/useWorkbenchLayout.ts` | 布局管理 |
| `composables/useWorkspaceLifecycle.ts` | 工作区生命周期 |
| `components/AppHeader.vue` | 应用头部 |
| `components/AppStatusBar.vue` | 状态栏 |
| `components/WorkspaceShell.vue` | 工作区容器 |

### 共享工具 (`src/lib/`)

| 文件 | 职责 |
|------|------|
| `native.ts` | Tauri 原生调用封装（Git、FS、Shell 等） |
| `clipboard.ts` | 剪贴板操作 |
| `platform.ts` | 平台检测 |
| `tauriRuntime.ts` | Tauri 运行时检测 |
| `simpleStore.ts` | 简单持久化存储 |
| `launchDir.ts` | 启动目录解析 |

### Pinia Stores

| Store | 职责 |
|------|------|
| `useTabsPiniaStore` | Tab 状态管理 |
| `usePreferencesPiniaStore` | 用户偏好设置 |
| `useWorkspaceRootPiniaStore` | 工作区根目录 |
| `useWorkspaceEnvPiniaStore` | 工作区环境 |
| `taskRunStore` | 任务运行状态 |

### 设置窗口 (`src/settings/`)

- `SettingsPanel.vue` - 设置面板主组件
- `sections/GeneralSection.vue` - 通用设置
- `sections/AppearanceSection.vue` - 外观设置
- `sections/EditorSection.vue` - 编辑器设置
- `sections/TerminalSection.vue` - 终端设置
- `sections/KeybindingsSection.vue` - 快捷键设置
- `sections/AboutSection.vue` - 关于页面

### 样式系统 (`src/styles/`)

| 文件 | 职责 |
|------|------|
| `globals.css` | 全局样式、CSS 变量/Token 定义 |
| `tokens.ts` | 设计 Token 运行时解析 |
| `terminalTheme.ts` | 终端主题 |
| `code-highlight.css` | 代码高亮样式 |

---

## 后端架构 (Rust)

### 模块结构 (`src-tauri/src/`)

| 模块 | 路径 | 职责 |
|------|------|------|
| **pty** | `modules/pty/` | 伪终端会话管理，支持 Windows ConPTY |
| **shell** | `modules/shell/` | Shell 命令执行、持久会话、后台进程 |
| **fs** | `modules/fs/` | 文件系统操作：读写、搜索、监控 |
| **git** | `modules/git/` | Git 操作封装 |
| **workspace** | `modules/workspace.rs` | 工作区管理、WSL 支持 |
| **lock** | `modules/lock.rs` | 线程安全原语封装 |
| **process** | `modules/process.rs` | 进程工具函数 |

### 关键数据结构

#### PtyState (`pty/mod.rs`)
```rust
pub struct PtyState {
    sessions: RwLock<HashMap<u32, Arc<Session>>>,  // session ID -> Session
    next_id: AtomicU32,                             // 自增ID
}
```

#### Session (`pty/session.rs`)
```rust
pub struct Session {
    #[cfg(windows)] _job: Option<PtyJob>,           // Windows Job对象
    pub killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub master: Mutex<Box<dyn MasterPty + Send>>,
    pub(crate) transcript: Arc<Transcript>,        // 临时文件存储输出
}
```

#### WorkspaceRegistry (`workspace.rs`)
```rust
pub struct WorkspaceRegistry {
    roots: Mutex<HashSet<PathBuf>>,                 // 授权根目录
    canonical_cache: Mutex<HashMap<PathBuf, CanonicalEntry>>, // 缓存(TTL 1s)
}
```

#### WorkspaceEnv (`workspace.rs`)
```rust
pub enum WorkspaceEnv {
    #[default] Local,
    Wsl { distro: String },
}
```

#### ShellState (`shell/mod.rs`)
```rust
pub struct ShellState {
    sessions: RwLock<HashMap<u32, Arc<ShellSession>>>,  // 持久shell会话
    bg: RwLock<HashMap<u32, Arc<BackgroundProc>>>,      // 后台进程
    next_session_id: AtomicU32,
    next_bg_id: AtomicU32,
}
```

---

## IPC 命令列表

### PTY 相关

| 命令 | 职责 |
|------|------|
| `pty_open` | 打开新的 PTY 会话 |
| `pty_write` | 向 PTY 写入数据 |
| `pty_resize` | 调整终端大小 |
| `pty_read_transcript` | 读取 transcript 内容 |
| `pty_close` | 关闭 PTY 会话 |

### Shell 相关

| 命令 | 职责 |
|------|------|
| `shell_run_command` | 执行一次性命令（带超时） |
| `shell_session_open` | 打开持久 shell 会话 |
| `shell_session_run` | 在持久会话中运行命令 |
| `shell_session_close` | 关闭持久会话 |
| `shell_bg_spawn` | 后台启动进程 |
| `shell_bg_logs` | 读取后台进程日志 |
| `shell_bg_kill` | 终止后台进程 |
| `shell_bg_list` | 列出后台进程 |

### 文件系统相关

| 命令 | 职责 |
|------|------|
| `fs_read_dir` | 读取目录条目 |
| `list_subdirs` | 列出子目录 |
| `fs_read_file` | 读取文件（含二进制检测） |
| `fs_write_file` | 原子写入文件 |
| `fs_stat` | 获取文件元数据 |
| `fs_canonicalize` | 路径规范化 |
| `fs_create_file` | 创建文件 |
| `fs_create_dir` | 创建目录 |
| `fs_rename` | 重命名/移动 |
| `fs_delete` | 删除文件/目录 |
| `fs_search` | 文件名搜索 |
| `fs_list_files` | 递归列出文件 |
| `fs_grep` | 文本内容搜索 |
| `fs_glob` | glob 模式匹配 |
| `fs_watch_workspace` | 监听工作区变化 |
| `fs_unwatch_workspace` | 取消监听 |

### Git 相关

| 命令 | 职责 |
|------|------|
| `git_resolve_repo` | 解析仓库信息 |
| `git_panel_snapshot` | 面板快照 |
| `git_status` | 工作区状态 |
| `git_diff` | 差异概览 |
| `git_diff_content` | 差异详情 |
| `git_stage` / `git_unstage` | 暂存/取消暂存 |
| `git_discard` | 丢弃变更 |
| `git_commit` | 提交 |
| `git_fetch` / `git_pull_ff_only` / `git_push` | 远程操作 |
| `git_branch_list` / `git_checkout_branch` / `git_create_branch` | 分支管理 |
| `git_stash_list` / `git_stash_push` / `git_stash_pop` / `git_stash_drop` | Stash 操作 |
| `git_log` | 提交历史 |
| `git_show_commit` | 查看特定提交 |
| `git_remote_url` | 获取远程 URL |

### Workspace 相关

| 命令 | 职责 |
|------|------|
| `wsl_list_distros` | 列出 WSL 发行版 |
| `wsl_default_distro` | 获取默认发行版 |
| `wsl_home` | 获取 WSL 家目录 |
| `workspace_authorize` | 授权工作区路径 |
| `workspace_current_dir` | 获取当前目录 |

---

## 依赖关系

### Rust 依赖 (`src-tauri/Cargo.toml`)

```
tauri v2
├── portable-pty v0.9      → PTY 会话管理
├── shared_child v1        → 子进程管理
├── notify v8.2           → 文件系统监控
├── tauri-plugin-window-state
├── tauri-plugin-os
├── tauri-plugin-dialog
├── tauri-plugin-clipboard
├── ignore v0.4           → 目录遍历(.gitignore)
├── grep-searcher        → 搜索功能
├── globset v0.4
├── tempfile v3           → 临时文件
└── windows-sys (仅Windows) → Windows API
```

### 前端依赖 (`package.json`)

```
vue v3 + typescript
├── @xterm/xterm          → 终端渲染
├── @xterm/addon-*        → xterm 扩展
├── naive-ui              → UI 组件
├── @codemirror/*         → 代码编辑器
├── vue-router
├── pinia
├── tailwindcss
└── vite
```

---

## 项目运行方式

### 开发命令

```bash
# 安装依赖
pnpm i

# 开发前端 (Vite dev server, 端口 3180)
pnpm dev

# 开发桌面应用
pnpm tauri dev

# 构建前端
pnpm build

# 运行测试
pnpm test

# Rust 类型检查
cd src-tauri && cargo check --all-targets --locked

# Rust 代码规范检查
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings
```

### 构建配置

**Vite (`vite.config.ts`)**
- 开发服务器端口：3180
- 路径别名：`@/` → `src/`
- 代码分割：xterm, codemirror, vue-vendor

**TypeScript (`tsconfig.json`)**
- 目标：ES2020
- 严格模式：启用
- 路径别名：`@/*` → `./src/*`

---

## 安全架构

1. **Rust 后端是唯一的系统访问层**：Webview 不直接访问文件系统、进程、shell
2. **WorkspaceRegistry 授权机制**：限制文件访问范围，防止路径遍历攻击
3. **Windows Job Object**：使用 Windows Job Object 管理 shell 子进程
4. **Transcript 临时文件**：PTY 输出存储在临时文件中，支持大文件

---

## 关键设计模式

1. **WorkspaceEnv**：同时支持本地和 WSL 工作区，路径自动转换
2. **WorkspaceRegistry**：安全边界验证，TTL 缓存
3. **Transcript**：RAII + 临时文件的输出存储
4. **blocking helper**：Git 模块使用 `blocking()` 封装同步操作到线程池
5. **ChildKillGuard**：RAII 风格的子进程终止管理