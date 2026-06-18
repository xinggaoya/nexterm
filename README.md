# Nexterm

Nexterm 是一个基于 Tauri 2、Rust、Vue 3 和 TypeScript 的终端开发环境二开项目。

## 开发

```bash
pnpm i
pnpm dev
```

启动 Tauri 开发环境：

```bash
pnpm tauri dev
```

## 检查

```bash
pnpm exec tsc --noEmit
pnpm build
cd src-tauri
cargo check --all-targets --locked
cargo clippy --all-targets --locked -- -D warnings
```

## 项目说明

- 前端入口在 `src/`。
- Rust/Tauri 后端在 `src-tauri/`。
- 项目架构和协作约束记录在 `NEXTERM.md`。
- 当前仓库为私有二次开发用途。

## 文档

- [系统架构总览](docs/architecture/overview.md)
- [模块详细设计](docs/architecture/)
- [代码 Wiki](CODE_WIKI.md)
- [项目设计文档](NEXTERM.md)
