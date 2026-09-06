# LSP 模块架构

> 状态：**最小实现（实验性）**。已落地：传输层（Tauri Channel + vscode-jsonrpc）、`initialize` 握手、`didOpen`/`didChange`（保存时全文推送）、`publishDiagnostics` → CodeMirror `setDiagnostics` 展示、设置页开关（`editorLspTypescriptMode`）。未落地：按键级增量 didChange、completion/hover/format 等能力。原始设计见 `docs/superpowers/specs/2026-07-16-monaco-lsp-migration-design.md`（编辑器内核现基于 CodeMirror 6）。

## 1. 概述

LSP 模块在 Tauri Rust 后端启动并守护语言服务器进程（LSP server），前端通过 Tauri Channel + invoke 与其通信。WebView 仅负责 UI 与 `vscode-jsonrpc` JSON-RPC 客户端，不直接接触 LSP 子进程。

## 2. 目录与文件

```
src-tauri/src/modules/lsp/
  mod.rs            # LspRegistry: Mutex<HashMap<SessionId, LspSession>>
  session.rs        # LspSession: child handle + stdin writer + stdout reader task
  framing.rs        # JSON-RPC 帧编解码（Content-Length 头 + JSON body）
  mock.rs           # mock-lsp：echo + 空 diagnostics（Section 2 测试用）
  commands.rs       # Tauri 命令注册
  servers/
    mod.rs
    rust.rs         # rust-analyzer
    python.rs       # pyright-langserver / pylsp
    go.rs           # gopls
    typescript.rs   # typescript-language-server

src/modules/lsp/
  lspTransport.ts   # vscode-jsonrpc MessageTransport 实现
  manager.ts        # LspManager：单编辑器 → 单 client 的生命周期
  serverConfigs/
    rust.ts
    python.ts
    go.ts
    typescript.ts
```

## 3. 依赖

### 3.1 Rust 内部

- `src-tauri/src/modules/lock.rs` -- mutex poison 处理
- `src-tauri/src/modules/workspace/env.rs` -- WorkspaceEnv
- `src-tauri/src/modules/process.rs` -- 子进程管理（tokio::process）

### 3.2 Rust 外部

- `tokio::process::Child`
- `tokio::io::{AsyncBufReadExt, AsyncWriteExt}`
- `serde` / `serde_json`

### 3.3 前端

- `vscode-jsonrpc` -- JSON-RPC 客户端
- `@tauri-apps/api/core` -- invoke / Channel

## 4. IPC 契约

所有 LSP 相关调用必须经由 `@/lib/native.ts`：

```ts
native.lspStart(spec)             → Promise<number>
native.lspWrite(id, message)      → Promise<void>
native.lspStop(id)                → Promise<void>
native.lspList()                  → Promise<LspSessionInfo[]>
native.lspResolveCommand(language) → Promise<LspResolvedCommand | null>
```

事件总线（Rust → 前端）：

- `nexterm://lsp-exit`：LSP 进程退出
- Tauri Channel<LspMessage>：单会话 stdout 流（Frame / ParseError / Stderr）

## 5. 关键流程

### 5.1 启动

```
EditorPane (file mounted)
  └─ LspManager.ensure(spec)
       └─ TauriLspTransport.listen()
            └─ invoke("lsp_start", { spec, workspace })
                 └─ LspRegistry.spawn(child, stdin/stdout pipes)
                      └─ spawn stdout reader task
```

### 5.2 消息往返

- **前端 → LSP**：`transport.send(json)` → `invoke("lsp_write")` → Rust stdin
- **LSP → 前端**：stdout reader `read_frame()` → `channel.send(LspMessage::Frame { payload })` → WebView listener

### 5.3 停止

`EditorPane.onBeforeUnmount` → `client.stop()` → `transport.dispose()` → `invoke("lsp_stop")` → Rust SIGTERM → 5s 超时 SIGKILL。

## 6. 测试

- `lsp/framing.test.rs` -- JSON-RPC 帧编解码
- `lsp_integration.test.rs` -- mock-lsp 端到端
- `lspTransport.test.ts` -- 前端 transport
- `lspBenchmark.test.ts` -- 1MB diagnostic 不丢帧
- `lspIpcBoundary.test.ts` -- 禁止前端直接 invoke

## 7. 详细设计

详见 `docs/superpowers/specs/2026-07-16-monaco-lsp-migration-design.md`。
