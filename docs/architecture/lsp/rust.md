# Rust LSP 集成（rust-analyzer）

## 二进制要求

```bash
rustup component add rust-analyzer
# 或
cargo install rust-analyzer
```

## 启动方式

打开 `*.rs` 文件后，`src-tauri/src/modules/lsp/servers/rust.rs::spec`
通过 `which::which("rust-analyzer")` 检测 binary。存在 → spawn
子进程 → Section 2 `LspSession` 接管；不存在 → 前端 toast
`editor.lsp.serverMissing`，编辑器照常打开（仅无 LSP 能力）。

## 配置

- `editor.lsp.typescript.mode`（与本语言无关，TS 专属设置）
- 当前 T-1 默认（无内置语言服务），启用 LSP 后获得 rust-analyzer 智能。

## 已知限制

- 暂未将 `Cargo.toml` workspace root 透传给 rust-analyzer 的
  `initializationOptions`；届时需要 `notify-on-cargo.toml-change` 等
  钩子，Section 4 后增强。
- `cargo check` 的实时 diagnostics 由 LSP 内部 on-watch 完成，
  不需要再附加 invoke handler。
