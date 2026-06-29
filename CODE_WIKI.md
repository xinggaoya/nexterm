# Nexterm 代码 Wiki

> 一份给本仓库协作者用的代码导览。它只列**事实**和**边界**，不重复 `AGENTS.md` 里关于协作纪律的内容。
> 架构与设计原则请看 `docs/architecture/README.md`，模块详细文档在 `docs/architecture/<module>/`。

## 1. 项目概述

Nexterm 是一个基于 **Tauri 2 + Rust 后端 + Vue 3 + TypeScript 前端** 的终端开发环境，提供跨平台的专业终端体验：

- 单窗口集成：终端、文件浏览、代码编辑、Git、任务、预览、Markdown。
- Rust 进程是**唯一的系统访问层**，Webview 只做展示。
- 模块化前端（按领域划分），模块间通过 Pinia store、composable、事件总线通信。
- 支持本地工作区与 WSL 工作区，自动转换路径与监控方式。

基础标识：

- npm package：`nexterm`
- Rust crate：`nexterm`（lib：`nexterm_lib`），辅助二进制 `nexterm-wsl-watcher`
- Tauri product name：`Nexterm`
- Bundle id：`app.xinggaoya.nexterm`
- 当前版本：与 `package.json` / `src-tauri/Cargo.toml` 同步（`0.1.2`）

## 2. 技术栈

| 层级 | 技术 | 版本/说明 |
|------|------|----------|
| 桌面框架 | Tauri | 2.x |
| 后端语言 | Rust | 2021 edition |
| 前端框架 | Vue + TypeScript | 3.5+ / 5.8+ |
| UI 组件库 | Naive UI | 2.x（主题由 `NConfigProvider` + `themeOverrides` 覆盖） |
| 终端渲染 | xterm.js | 6.x（`@xterm/xterm` + fit/search/serialize/web-links/webgl） |
| 代码编辑器 | CodeMirror | 6.x（含 merge、lint、vim 模式与多语言包） |
| 状态管理 | Pinia | 3.x，setup-function 模式 |
| 路由 | vue-router | 5.x |
| 样式 | Tailwind CSS | 4.x（仅布局/精细样式，不参与组件主题） |
| 构建工具 | Vite | 7.x |
| 包管理器 | pnpm | workspace 模式（`pnpm-workspace.yaml`） |

## 3. 仓库结构

```
nexterm/
+- src/                          # 前端 Vue 3 + TypeScript
|  +- main.ts                   # 入口：创建 Vue app、装载 Pinia/i18n、bootstrap 偏好与工作区
|  +- app/                      # 应用外壳（MainApp + shell + composables + app 内部组件）
|  |  +- MainApp.vue
|  |  +- shell/                # TitleBar / ActivityBar / TabBar / Workbench / StatusBar
|  |  +- components/           # WorkspaceWelcome / WorkspaceEnvSelector / UnsavedCloseGuard
|  |  +- use*.ts               # useWorkspaceLifecycle / useTaskConsoleController / useWorkbenchCommands / useWorkbenchLayout / useWindowChromeState
|  +- modules/                  # 业务模块（17 个，按领域自治）
|  +- lib/                      # 跨模块共享：native / path / normalizeError / refs / useEventListener ...
|  +- components/               # 全局共享：WindowControls / TooltipTitle
|  +- settings/                 # 设置抽屉 + 6 个分区组件
|  +- styles/                   # tokens / terminalTheme / globals.css / code-highlight.css / fonts.css
|
+- src-tauri/                     # 后端 Rust
|  +- src/
|  |  +- lib.rs                # Tauri 命令注册入口、插件装配、深链与启动目录
|  |  +- main.rs               # 入口二进制
|  |  +- panic_report.rs       # panic hook（结构化日志）
|  |  +- modules/
|  |     +- lock.rs           # mutex/rwlock 毒化错误包装
|  |     +- process.rs        # Windows 隐藏控制台窗口
|  |     +- workspace.rs      # WorkspaceRegistry 授权、WSL 辅助
|  |     +- pty/              # PTY 会话、Transcript、Job Object、da_filter、shell_init
|  |     +- shell/            # 一次性命令 / 持久 session / 后台进程 / ringbuffer
|  |     +- fs/               # tree / file / mutate / search / grep / watcher
|  |     +- git/              # commands / operations / parser / process / types / errors / utils
|  +- wsl-watcher-helper/       # 独立二进制，监控 WSL 工作区并以 JSON 行输出事件
|  +- Cargo.toml                # 顶层 crate + workspace
|  +- tauri.conf.json
|
+- public/                        # 静态资源（仅 logo.png）
+- docs/                          # 架构与设计文档
+- AGENTS.md                      # Agent 协作约束（系统级）
+- NEXTERM.md                     # 工程记忆与架构简述
+- CODE_WIKI.md                   # 本文件
+- README.md                      # 仓库导览
+- package.json
```

## 4. 前端架构

### 4.1 应用壳 `src/app/`

| 文件 | 职责 |
|------|------|
| `MainApp.vue` | 根组件：主题、布局、设置抽屉、命令面板、通知桥接；只读业务数据并把它们装到 shell 上 |
| `shell/TitleBar.vue` | 标题栏（macOS 用 `WindowControls`，Win/Linux 用窗口控件） |
| `shell/ActivityBar.vue` | 左侧活动栏（explorer / source control / tasks / settings 等入口） |
| `shell/TabBar.vue` | 标签栏，支持拖拽重排、关闭、tab 类型图标 |
| `shell/Workbench.vue` | 主工作区（侧栏 + pane 容器），组合 TabBar 与 PaneStack |
| `shell/StatusBar.vue` | 底部状态栏（Git 分支、行尾、编码、缩进、终端状态等） |
| `composables/usePaneResize.ts` | pane 拖拽调整大小 |
| `useWorkbenchCommands.ts` | 装配工作台相关的 `CommandSpec` |
| `useWorkbenchLayout.ts` | 侧栏宽度、面板显示状态等布局状态 |
| `useWorkspaceLifecycle.ts` | 工作区根路径、文件 watcher、env 切换 |
| `useTaskConsoleController.ts` | 任务发现/执行/日志（工厂模式 `createTaskRunStore`） |
| `useWindowChromeState.ts` | 窗口控件与 maximize/restore 状态 |

应用壳的子组件放在 `src/app/components/`：

- `WorkspaceWelcome.vue` -- 工作区未打开时的欢迎页
- `WorkspaceEnvSelector.vue` -- 顶部本地/WSL 切换器
- `UnsavedCloseGuard.vue` -- 编辑器未保存时的关闭确认

### 4.2 业务模块 `src/modules/`

| 模块 | 职责 | 主要文件 |
|------|------|----------|
| `terminal` | 终端面板、xterm.js 渲染、PTY 桥接、pane 树 | `TerminalPane.vue` / `TerminalStack.vue` / `PaneTreeV2.vue` / `TerminalToolbar.vue` / `lib/panes.ts` / `lib/pty-bridge.ts` / `lib/rendererPool.ts` / `lib/terminalSessionCore.ts` |
| `editor` | CodeMirror 6 编辑器、diff、状态条 | `EditorPane.vue` / `EditorToolbar.vue` / `EditorStatusBar.vue` / `DiffCodeMirror.vue` / `GitDiffPane.vue` / `GitDiffStack.vue` / `MarkdownEditorPreview.vue` / `lib/*` |
| `explorer` | 文件树、搜索、右键菜单、内联重命名 | `FileExplorer.vue` / `FileTreeRow.vue` / `ExplorerContextMenu.vue` / `ExplorerSearch.vue` / `InlineTreeInput.vue` / `lib/fileIcons.ts` / `lib/fileTreeRows.ts` / `lib/iconResolver.ts` |
| `tabs` | 标签状态、类型、拖拽、关闭守卫、pane split | `tabsPinia.ts` / `tabsTypes.ts` / `tabsReorder.ts` / `closeGuards.ts` / `tabLabel.ts` / `terminalDisposal.ts` |
| `source-control` | Git 状态、暂存、提交、分支工作流 | `SourceControlPanel.vue` / `SourceControlChangeList.vue` / `SourceControlChangeRow.vue` / `SourceControlCommitBox.vue` / `SourceControlGitWorkflows.vue` / `SourceControlToolbar.vue` / `useSourceControlState.ts` / `useSourceControlActions.ts` / `useSourceControlGitMetadata.ts` / `sourceControlModel.ts` / `gitDecorations.ts` |
| `git-history` | 提交历史、提交详情、diff drawer、远程 web 跳转 | `GitHistoryPane.vue` / `GitHistoryStack.vue` / `GraphRail.vue` / `lib/graph.ts` / `lib/remoteWebUrl.ts` |
| `tasks` | 任务发现、执行、运行实例 | `TaskConsole.vue` / `taskDiscovery.ts` / `taskRunStore.ts` / `taskTypes.ts` / `taskCommands.ts` |
| `settings` | 偏好持久化层 + Pinia | `preferencesPinia.ts` / `store.ts` / `preferences.ts` / `preferencesSnapshot.ts` / `tabs.ts` |
| `commands` | 命令注册表、命令面板、键位解析 | `CommandPalette.vue` / `registry.ts` / `commandSpecs.ts` / `coreCommands.ts` / `workbenchCommands.ts` / `keybindings.ts` / `types.ts` |
| `workspace` | 工作区根目录、env、对话框、窗口 | `workspaceRootPinia.ts` / `workspaceEnvPinia.ts` / `workspaceEnvSnapshot.ts` / `workspacePath.ts` / `workspaceDialog.ts` / `workspaceNative.ts` / `workspaceWindow.ts` |
| `theme` | Naive UI 主题覆盖 | `naiveTheme.ts` |
| `preview` | 内嵌 webview 预览 | `PreviewPane.vue` / `PreviewStack.vue` / `PreviewAddressBar.vue` / `previewUrl.ts` |
| `markdown` | Markdown 渲染、文档服务 | `MarkdownPreviewPane.vue` / `MarkdownStack.vue` / `lib/markdownRenderer.ts` / `lib/markdownDocumentService.ts` |
| `notifications` | Naive UI 通知中心 | `NotificationBridge.vue` / `notificationCenter.ts` |
| `i18n` | vue-i18n 装配、zh-CN / en-US | `index.ts` / `translate.ts` / `types.ts` / `naive.ts` / `locales/{zh-CN,en-US}.ts` |
| `pinia` | Pinia 边界测试（不是 store 库本体） | `setupStoreBoundary.test.ts` |

### 4.3 共享工具 `src/lib/`

| 文件 | 职责 |
|------|------|
| `native.ts` | **唯一的 Tauri IPC 出口**，所有 invoke 集中在此；导出 `native` 对象 + 几个独立函数（`onDeepLinkOpen` / `relaunchApp` / `exitApp`） |
| `path.ts` | 跨平台 `basename` / `dirname`（兼容 `\\` 与 `/`） |
| `normalizeError.ts` | 把任意 thrown value 规整为带 `message` 的对象 |
| `refs.ts` | `ReadonlyRef` / `MaybeRef` 等轻量类型 |
| `useEventListener.ts` | 自动配对 add/remove 的事件订阅 composable |
| `launchDir.ts` | 启动目录读取与 bootstrap |
| `clipboard.ts` | 剪贴板封装（Naive UI/tauri 失败时回退到 `navigator.clipboard`） |
| `platform.ts` | 平台/操作系统检测（`USE_CUSTOM_WINDOW_CONTROLS` 等） |
| `tauriRuntime.ts` | `hasTauriInternals` 等运行时探测 |
| `simpleStore.ts` | 简单同步本地 store（与 `tauri-plugin-store` 区分） |
| `fonts.ts` | 字体加载、度量 |
| `appInfo.ts` | 暴露 `__NEXTERM_VERSION__` |
| `emptyObject.ts` | `Object.freeze({})` 等小工具 |
| `types.ts` | 共享类型 |
| `gitStatus.ts` | git 状态的轻量本地判定 |
| `touchDevice.ts` | 触屏/笔触能力检测 |

### 4.4 Pinia Store 一览

| Store | 模块 | 主要职责 |
|-------|------|----------|
| `usePreferencesPiniaStore` | `settings` | 21 个偏好字段的响应式状态；与 Rust `LazyStore` 双向同步 |
| `useTabsPiniaStore` | `tabs` | tab 数组、activeId、pane split、关闭 |
| `useWorkspaceRootPiniaStore` | `workspace` | 当前根目录、最近工作区、bootstrap |
| `useWorkspaceEnvPiniaStore` | `workspace` | 当前 env（local/wsl）、distro 列表 |
| `useTaskRunStore`（工厂） | `tasks` / `app` | 单个任务的运行实例（日志、状态、退出码） |

所有 store 都使用 **setup-function 模式**，禁止 Options API 形式，禁止 `this.*`。完整约束见 `docs/architecture/02-module-contracts.md`。

### 4.5 设置抽屉 `src/settings/`

设置作为主窗口的 Naive UI 抽屉，不再创建独立设置窗口。分区组件：

- `GeneralSection.vue`
- `AppearanceSection.vue`
- `EditorSection.vue`
- `TerminalSection.vue`
- `KeybindingsSection.vue`
- `AboutSection.vue`

### 4.6 样式 `src/styles/`

| 文件 | 职责 |
|------|------|
| `globals.css` | 全局样式、oklch CSS 变量、shadcn 风格 token 定义 |
| `tokens.ts` | 运行时 oklch 到 RGB 解析，所有 token 集中在 `AppTokens` |
| `terminalTheme.ts` | 从 `AppTokens` 生成 xterm 主题，使终端与 app 视觉融合 |
| `code-highlight.css` | 代码高亮补充样式 |
| `fonts.css` | Inter / JetBrains Mono 字体声明 |

## 5. 后端架构

### 5.1 模块划分

| 模块 | 主要文件 | 职责 |
|------|----------|------|
| `pty` | `mod.rs` / `session.rs` / `transcript.rs` / `job.rs` / `da_filter.rs` / `shell_init.rs` / `io.rs` | PTY 会话；ConPTY 串行化、Job Object 防止子进程逃逸、Transcript 临时文件作为转录缓冲 |
| `shell` | `mod.rs` / `session.rs` / `background.rs` / `ringbuffer.rs` | 一次性命令、持久 shell session、后台进程（spawn/logs/kill/list） |
| `fs` | `mod.rs` / `tree.rs` / `file.rs` / `mutate.rs` / `search.rs` / `grep.rs` / `watcher.rs` / `watcher/{local,polling,wsl,events}.rs` / `wsl_ops.rs` | 读/写/遍历/搜索/grep/glob/变更；`FsWatcherState` 维护当前工作区 watcher |
| `git` | `mod.rs` / `commands.rs` / `operations.rs` / `parser.rs` / `process.rs` / `types.rs` / `errors.rs` / `utils.rs` | Git 命令封装、输出解析、错误码归一 |
| `workspace` | `workspace.rs` | `WorkspaceRegistry` 授权、canonical 缓存、WSL 辅助 |
| `lock` | `lock.rs` | `mutex_lock` / `rwlock_read` / `rwlock_write` / `condvar_wait_timeout`，统一毒化错误 |
| `process` | `process.rs` | Windows 下隐藏子进程控制台窗口 |

### 5.2 Tauri 命令完整清单

> 完整签名见 `src/lib/native.ts`，Rust 实现见 `src-tauri/src/modules/<module>/*`，注册见 `src-tauri/src/lib.rs::invoke_handler`。

#### 启动 / 窗口

| 命令 | 用途 |
|------|------|
| `get_launch_dir` | 读取由 `LaunchDir` 维护的启动目录（HMR 期间只读一次） |

#### Workspace / WSL

| 命令 | 用途 |
|------|------|
| `wsl_list_distros` | 列出本机 WSL 发行版 |
| `wsl_default_distro` | 默认 WSL 发行版 |
| `wsl_home` | WSL 家目录（UNC 路径） |
| `workspace_authorize` | 把工作区根加入 `WorkspaceRegistry` 信任集 |
| `workspace_current_dir` | 当前真实 cwd（含 WSL 转换） |

#### PTY

| 命令 | 用途 |
|------|------|
| `pty_open` | 打开 PTY 会话，返回 `id`；通过 Tauri `Channel` 流式输出 |
| `pty_write` | 写入数据 |
| `pty_resize` | 调整 cols/rows |
| `pty_read_transcript` | 从 `Transcript` 读片段（带 `start_offset`） |
| `pty_close` | 关闭会话；drop 在独立线程避免阻塞 Tauri worker |

#### Shell

| 命令 | 用途 |
|------|------|
| `shell_run_command` | 一次性命令（带超时） |
| `shell_session_open` / `shell_session_run` / `shell_session_close` | 持久 shell session |
| `shell_bg_spawn` / `shell_bg_logs` / `shell_bg_kill` / `shell_bg_list` | 后台进程及其日志环 |

#### FS

| 命令 | 用途 |
|------|------|
| `fs_read_dir` / `list_subdirs` | 目录读取 |
| `fs_read_file` / `fs_write_file` / `fs_stat` / `fs_canonicalize` | 文件 IO |
| `fs_create_file` / `fs_create_dir` / `fs_rename` / `fs_delete` | 文件操作 |
| `fs_search` / `fs_list_files` | 文件名搜索（`ignore` crate 尊重 `.gitignore`） |
| `fs_grep` / `fs_glob` | 内容/glob |
| `fs_watch_workspace` / `fs_unwatch_workspace` | 切换工作区 watcher |

#### Git

| 命令 | 用途 |
|------|------|
| `git_resolve_repo` | 解析仓库根 |
| `git_panel_snapshot` | 面板快照（一次拿到状态/分支/远程等） |
| `git_status` | `git status --porcelain` |
| `git_diff` / `git_diff_content` | 概览 diff / 内容 diff |
| `git_stage` / `git_unstage` / `git_discard` | 暂存/取消/丢弃 |
| `git_commit` | 提交 |
| `git_fetch` / `git_pull_ff_only` / `git_push` | 远程操作 |
| `git_branch_list` / `git_checkout_branch` / `git_create_branch` | 分支 |
| `git_stash_list` / `git_stash_push` / `git_stash_pop` / `git_stash_drop` | Stash |
| `git_log` | 提交历史（分页） |
| `git_show_commit` / `git_commit_files` / `git_commit_file_diff` | 提交详情 |
| `git_remote_url` | 远程 URL（用于 web 跳转） |

### 5.3 关键设计模式

1. **唯一系统访问层**：所有 fs/pty/shell/git 路径都过 `WorkspaceRegistry.authorize`。
2. **WorkspaceEnv 透传**：前端 `native.*` 在每次调用时把 `currentWorkspaceEnv()` 作为参数 `workspace` 透传给 Rust，Rust 用它选择本地或 WSL 实现。
3. **ConPTY 序列化保护**：Windows 上 `pty_open` 通过互斥避免首屏终端输出管道卡住。
4. **Job Object**：`Session` 在 Windows 上挂 Job Object，子进程不会被遗弃；不能用轻量替代。
5. **Transcript 临时文件**：PTY 输出既走 Tauri `Channel` 流式，也落到 `NamedTempFile` 用于 `pty_read_transcript`。
6. **Lock 工具**：所有 `Mutex` / `RwLock` 都过 `lock.rs`，panic 后的毒化错误携带上下文。
7. **Panic Hook**：`panic_report::install_panic_hook` 把 panic 写成结构化日志 + stderr。
8. **WSL 独立 watcher**：`nexterm-wsl-watcher-helper` 二进制独立运行，避免 webview 进程阻塞。

## 6. 共享 IPC 事件

- `nexterm://workspace-fs-changed` -- 工作区文件变化（`fs_watcher` 发出，`native.ts` 解码）
- `nexterm://deep-link-open` -- 深链 / CLI 启动目录打开工作区（`onDeepLinkOpen` 订阅）

## 7. Vite 与构建

`vite.config.ts` 要点：

- 端口 `3180`，`strictPort`，TAURI dev HMR 走 `1421`。
- 自动导入：`unplugin-auto-import`（vue / vue-router / pinia，生成 `src/auto-imports.d.ts`），`unplugin-vue-components` + `NaiveUiResolver`（生成 `src/components.d.ts`）。
- `manualChunks`：`xterm` / `codemirror` / `vue-vendor` 三个分块。
- `esbuild.drop = ['debugger']`、`.pure = console.debug/info/trace`（仅 production）。
- `__NEXTERM_VERSION__` 通过 `define` 暴露给前端。

## 8. 依赖关系

### 8.1 前端 `package.json` 关键依赖

```
vue v3 + typescript
+-- @xterm/xterm + @xterm/addon-{fit,search,serialize,web-links,webgl}
+-- naive-ui
+-- @codemirror/* (state/view/lint/search/merge/lang-*/commands)
+-- @uiw/codemirror-theme-* 与 @uiw/codemirror-themes
+-- @replit/codemirror-vim
+-- vue-router / pinia / vue-i18n
+-- @tauri-apps/api + 12 个 plugin
+-- @hugeicons/core-free-icons / @vicons/ionicons5 / @iconify-json/catppuccin
+-- @vueuse/core / @fontsource-variable/inter / @fontsource/jetbrains-mono
+-- tailwindcss v4 + @tailwindcss/vite + tw-animate-css
+-- shadcn (components.json) + marked
+-- 测试：vitest / @vue/test-utils / jsdom
```

### 8.2 Rust `src-tauri/Cargo.toml` 关键依赖

```
tauri v2
+-- portable-pty v0.9        -> PTY
+-- shared_child v1          -> 子进程管理
+-- notify v8.2              -> 文件系统监控
+-- ignore v0.4              -> .gitignore 感知的目录遍历
+-- grep-searcher / grep-regex / grep-matcher / globset
+-- tempfile v3              -> Transcript 等
+-- url v2                   -> 深链解析
+-- base64 v0.22             -> PTY 转录编码
+-- serde / serde_json
+-- tauri-plugin-{store,os,dialog,clipboard-manager,notification,log,opener,positioner,process,deep-link,autostart,window-state}
+-- Windows: windows-sys 0.59 (Job Object / Foundation / Threading)
+-- Unix: libc
```

`wsl-watcher-helper` 独立 crate：`notify` + `serde` + `serde_json`。

## 9. 文档地图

- 仓库根：`README.md`（导览） / `NEXTERM.md`（工程记忆） / `AGENTS.md`（协作约束） / `CODE_WIKI.md`（本文件）
- 架构文档：`docs/architecture/`
  - `README.md` -- 阅读路径
  - `01-overview.md` -- 设计原则与全局架构
  - `02-module-contracts.md` -- 模块间通信、Pinia 写法、命名规范
  - `03-development-workflow.md` -- 开发/调试/提交/新增模块
  - `04-security-model.md` -- WorkspaceRegistry、Job Object、Transcript、ConPTY 序列化
  - `05-glossary.md` -- 术语表
  - `<module>/README.md` + `<module>/detailed-design.md` -- 各模块
- 历史计划：`docs/superpowers/plans/`（已完成的重构计划与遗留工作）

## 10. 安全架构速览

1. **Rust 后端是唯一的系统访问层**：Webview 不直接访问 fs/进程/shell/密钥。
2. **`WorkspaceRegistry` 授权**：所有 `fs_*` / `pty_*` / `shell_*` / `git_*` 在执行前必须过 `authorize_*`。
3. **Windows Job Object**：shell 子进程纳入 Job Object 防止逃逸。
4. **Transcript 临时文件**：PTY 输出 + `tempfile::NamedTempFile` 支持大文件回放。
5. **ConPTY 序列化**：避免首次启动时的输出管道卡住。
6. **深链解析收口**：所有 `nexterm://` URL 在 Rust 端解析为 `DeepLinkOpenRequest` 再发给前端。
