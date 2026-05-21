# NEXTERM.md

Nexterm 是当前项目的工程记忆和架构说明。修改项目之前先阅读本文件，并让实现保持模块边界清晰。

## Project

Nexterm 是 AI-native 终端开发环境。技术栈：

- Tauri 2 + Rust 后端
- Vue 3 + TypeScript 前端，Naive UI 作为主要 UI 组件与主题系统
- xterm.js 终端渲染
- Vercel AI SDK v6 驱动 BYOK AI 能力
- 包管理器：pnpm

基础标识：

- npm package：`nexterm`
- Rust crate：`nexterm`
- Tauri product name：`Nexterm`
- Bundle id：`app.xinggaoya.nexterm`

## Commands

```bash
pnpm i
pnpm dev
pnpm tauri dev
pnpm exec tsc --noEmit
pnpm build
```

Rust 检查：

```bash
cd src-tauri
cargo check --all-targets --locked
cargo clippy --all-targets --locked -- -D warnings
```

## Architecture

Rust 进程负责所有系统访问。Webview 不直接访问文件系统、进程、shell 或密钥，统一通过 Tauri `invoke()` 调用 `src-tauri/src/lib.rs` 注册的命令。

主要后端模块：

- `pty::*`：长生命周期终端会话，xterm 通过 Tauri channel 接收输出。
- `fs::*`：文件树、文件读写、搜索、grep 和变更操作。
- `shell::*`：一次性命令、持久 agent shell、后台进程和日志缓冲。
- `secrets::*`：通过 OS keychain 保存 AI provider key。
- `workspace::*` / `git::*` / `net::*`：工作区、Git 和网络辅助能力。

前端按 `src/modules/` 分区。新功能应放入对应模块，主窗口入口由 `src/main.ts` 挂载 Vue 工作台，设置窗口由 `src/settings/main.ts` 挂载 Vue Router 设置页。迁移过程中仍可能存在待替换的旧 React 模块，不能继续向旧 React 层增加新功能。

## Frontend Rules

- 使用 `@/` 路径别名，不跨模块写深层相对路径。
- UI 优先使用 Naive UI，并通过 `NConfigProvider` / `themeOverrides` 接入主题；Tailwind v4 保留用于布局、终端、编辑器和精细样式。
- 页面应保持现代、简洁、可扫描，不使用营销式大段说明替代实际功能。
- 路径可能来自 Windows、Unix、OSC 7 或文件树，边界处要兼容 `/` 与 `\`。

## Security Rules

- 不把 API key、token 或凭据写入文件、命令、日志、localStorage。
- AI key 只通过 keychain 相关接口保存。
- 文件工具对明显敏感路径保持拒绝策略，不绕过 `security.ts`。

## Development Notes

- Tabs 不应在切换时卸载，终端和 dev server 需要后台保持。
- AI composer provider 应保持稳定挂载，避免 key 加载后重挂载整个应用。
- Windows ConPTY 启动仍需要串行化保护，避免首屏终端输出管道卡住。
- Windows shell 子进程依赖 Job Object 管理，不能在无替代方案时移除。
