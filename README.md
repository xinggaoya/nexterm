<div align="center">

# Nexterm

**面向终端的开发环境**

[![CI](https://img.shields.io/github/actions/workflow/status/xinggaoya/nexterm/ci.yml?branch=main&label=CI&logo=github&style=flat-square)](https://github.com/xinggaoya/nexterm/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/xinggaoya/nexterm?label=Release&logo=tauri&style=flat-square)](https://github.com/xinggaoya/nexterm/releases/latest)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=flat-square)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)](#下载)
[![Tauri](https://img.shields.io/badge/Tauri-2-FFC131?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app)
[![Vue](https://img.shields.io/badge/Vue-3-42B883?style=flat-square&logo=vue.js&logoColor=white)](https://vuejs.org)

[English](#english) | [简体中文](#简体中文)

</div>

---

## 简体中文

Nexterm 是一个以终端为中心、集成多种开发工具的桌面开发环境。整个项目基于 [Tauri 2](https://tauri.app) 构建,Rust 后端负责所有系统访问,Vue 3 Webview 只做呈现。

### 核心能力

- **多标签终端** — 基于 xterm.js 的高性能终端渲染,支持平铺分屏与 PTY 会话
- **文件浏览器** — 多选、拖拽、上下文菜单、Find in Files 全文搜索
- **代码编辑器** — CodeMirror 6 内核,Vim 模式,丰富的语言高亮与 LSP 诊断(实验)
- **Git 集成** — 暂存、提交、分支、标签推送、历史查看、差异对比
- **Web 预览** — 内置 Webview 区域用于预览本地开发服务
- **SSH / WSL 远端工作区** — 通过 `nexterm-agent` 常驻代理提供跨环境的 fs/exec 加速
- **应用内自动更新** — 基于 Tauri updater 的版本自检与增量升级
- **多主题** — Catppuccin、Tokyo Night、Atom One 等深浅色主题内置
- **i18n** — 简体中文 / English 双语界面
- **品牌系统** — 完整的 logo、icon、徽章与字体管理

### 架构

```
+------------------------------------------------------+
|  Vue 3 Webview                                       |
|  MainApp → WorkspaceHost(Sidebar + TopBar + Canvas)  |
|  Pinia stores <-> Tauri invoke() <-> Rust commands   |
+--------------------------+---------------------------+
                           | Tauri IPC
+--------------------------v---------------------------+
|  Rust Backend (src-tauri/src/lib.rs)                 |
|  pty | shell | fs | git | workspace | lock | process |
+------------------------------------------------------+
```

完整设计见 [NEXTERM.md](./NEXTERM.md) 和 [docs/architecture/](./docs/architecture/README.md)。

### 快速开始

```bash
# 1. 安装前端依赖
pnpm install

# 2. 启动 Vite 开发服务(纯前端)
pnpm dev

# 3. 启动 Tauri 桌面开发(Vue + Rust)
pnpm tauri dev

# 4. 构建生产安装包(自动跨平台矩阵见 CI)
pnpm build
cd src-tauri && cargo build --release
```

### 开发检查

```bash
pnpm exec vue-tsc --noEmit     # 前端类型检查
pnpm test                      # Vitest 单元测试
pnpm build                     # 前端构建
cd src-tauri
cargo check --all-targets --locked
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
```

以上检查由 `.github/workflows/ci.yml` 在每次 push / PR 时自动运行(Ubuntu + Windows 双矩阵)。

### 文档导航

- [NEXTERM.md](./NEXTERM.md) — 工程记忆与架构总览
- [docs/architecture/overview.md](./docs/architecture/overview.md) — 系统架构
- [docs/architecture/01-overview.md](./docs/architecture/01-overview.md) — 模块总览
- [CODE_WIKI.md](./CODE_WIKI.md) — 代码 Wiki
- [CHANGELOG.md](./CHANGELOG.md) — 版本变更日志

### 贡献

欢迎贡献代码、提交 issue 与发起 PR。详细流程见 [CONTRIBUTING.md](./CONTRIBUTING.md),行为准则见 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。

### 许可证

本项目以 [Apache License 2.0](./LICENSE) 发布。

---

## English

**Nexterm** is a terminal-centric desktop development environment built with Tauri 2, Rust, Vue 3, and TypeScript. It bundles multi-tab terminals, file explorer, code editor, Git tooling, and SSH/WSL remote workspaces into a single native window.

### Features

- **Multi-tab terminals** — High-throughput xterm.js rendering with PTY sessions and tile splits
- **File explorer** — Multi-select, drag, context menus, find-in-files
- **Code editor** — CodeMirror 6 with Vim mode and rich language support
- **Git tooling** — Stage / commit / branch / tags / log / diff
- **Web preview** — In-app preview pane for local dev servers
- **SSH / WSL remote workspaces** — via the `nexterm-agent` helper
- **In-app auto-update** — Tauri updater with signed release artifacts
- **Themes** — Catppuccin, Tokyo Night, Atom One, and more
- **i18n** — Simplified Chinese and English

### Quick Start

```bash
pnpm install
pnpm dev              # frontend only
pnpm tauri dev        # full Tauri dev
pnpm build            # production build
```

### Documentation

- [NEXTERM.md](./NEXTERM.md) — Engineering memory
- [docs/architecture/](./docs/architecture/) — Architecture docs
- [CODE_WIKI.md](./CODE_WIKI.md) — Code Wiki

### License

Apache License 2.0 — see [LICENSE](./LICENSE).

### Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Code of conduct: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
