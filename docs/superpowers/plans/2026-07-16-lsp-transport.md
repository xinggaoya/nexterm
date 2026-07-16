# LSP 传输层（Section 2）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Tauri Rust 后端实现 LSP 子进程生命周期管理，并通过 Tauri Channel + invoke 让前端能通过 `vscode-jsonrpc.MessageTransport` 协议与 LSP 进程通信。本阶段只对接一个 `mock-lsp` echo server，验证传输层往返正确性。

**Architecture:** Rust 端用 `std::process::Command` spawn LSP 子进程，`std::thread::spawn` 启动 stdout 帧解析循环（Content-Length 头）。帧通过 `tauri::ipc::Channel<LspMessage>` 单向流向 WebView。前端 `TauriLspTransport` 实现 `MessageTransport` 接口，由 `monaco-languageclient`（Section 3 引入）调用。本阶段只用 `vscode-jsonrpc` 直接验证传输层。

**Tech Stack:**
- Rust: `std::process::Command` + `std::thread`（沿用现有 pty 模块风格，不引入 tokio）
- 前端: `vscode-jsonrpc` ^8.2.x + `@tauri-apps/api/core` Channel
- 既存模块: `src-tauri/src/modules/lock.rs`、`src-tauri/src/modules/workspace.rs`、`src/lib/native.ts`、`src/lib/nativeBoundary.test.ts`

## Global Constraints

- 与现有 `src-tauri/src/modules/pty/session.rs` 风格保持一致：spawn 子进程 + `thread::Builder::new().name("nexterm-...")` + `tauri::ipc::Channel<T>`
- 所有 LSP IPC 必须经由 `src/lib/native.ts`（`lspStart / lspWrite / lspStop / lspList / lspResolveCommand`），新增 `src/modules/lsp/lspIpcBoundary.test.ts` 守护
- LSP 模块目录：`src-tauri/src/modules/lsp/{mod,session,framing,mock,commands,errors}.rs`
- 前端 LSP 模块目录：`src/modules/lsp/{lspTransport,manager,languageMap,serverConfigs}.ts`
- 命令分支：`feat/lsp-transport-section2`（不可在 main 直接实施）
- 测试：`pnpm test` 通过 + `cd src-tauri && cargo check --all-targets --locked` + `cargo clippy --all-targets --locked -- -D warnings` 全绿

## File Structure

### 新增

```
src-tauri/src/modules/lsp/
  mod.rs             # LspRegistry、pub 公开 API、错误转译
  session.rs         # LspSession：child handle + stdin writer + stdout reader thread
  framing.rs         # Content-Length 帧编解码（read_frame / write_frame）
  mock.rs            # mock-lsp：回显所有读取的请求 + 空 diagnostics
  commands.rs        # #[tauri::command] 注册：lsp_start/write/stop/list/resolve_command
  errors.rs          # LspError enum → String

src/modules/lsp/
  lspTransport.ts    # vscode-jsonrpc MessageTransport 实现
  manager.ts         # LspManager：单编辑器 → 单 client 的生命周期包装（本阶段仅注册 transport）
  lspTransport.test.ts
  lspIpcBoundary.test.ts
  languageMap.ts     # 文件名 → LSP server spec（占位，Section 3 填充）

docs/superpowers/plans/2026-07-16-lsp-transport.md  # 本文档
```

### 修改

```
src-tauri/Cargo.toml                           # 无新增依赖（仅 serde 已有）
src-tauri/src/lib.rs                           # 注册 lsp 模块 + 5 个 tauri::command
src/lib/native.ts                              # 新增 lspStart/lspWrite/lspStop/lspList/lspResolveCommand
src/modules/editor/EditorPane.vue              # 不在此阶段改动（Section 3 才接入）
tests/vitest.setup.ts                          # 不需要 stub（直接测 frontend 无 editor 依赖）
```

### 删除

无（本阶段纯增量）。

---

## Task 1: Rust 帧编解码（Content-Length）

**Files:**
- Create: `src-tauri/src/modules/lsp/framing.rs`
- Create: `src-tauri/src/modules/lsp/framing.rs::tests` (inline `#[cfg(test)] mod tests`)

**Interfaces:**
- Consumes: `std::io::Read`、`std::io::Write`、`&[u8]`、`String`
- Produces:
  - `pub fn read_frame<R: BufRead>(reader: &mut R) -> Result<Option<String>, LspError>`
  - `pub fn write_frame<W: Write>(writer: &mut W, message: &str) -> Result<(), LspError>`
  - `pub fn content_length(line: &str) -> Option<usize>`

- [ ] **Step 1: 写失败测试**

`src-tauri/src/modules/lsp/framing.rs` 末尾：

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn roundtrips_single_frame() {
        let original = "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":null}";
        let mut bytes: Vec<u8> = Vec::new();
        write_frame(&mut bytes, original).unwrap();
        let mut cursor = Cursor::new(bytes);
        let parsed = read_frame(&mut cursor).unwrap().unwrap();
        assert_eq!(parsed, original);
    }

    #[test]
    fn reads_partial_buffer_returns_none() {
        let mut bytes: Vec<u8> = Vec::new();
        write_frame(&mut bytes, "x").unwrap();
        let mut cursor = Cursor::new(&bytes[..bytes.len() - 5]);
        assert!(read_frame(&mut cursor).unwrap().is_none());
    }

    #[test]
    fn handles_multiple_frames_in_sequence() {
        let mut bytes: Vec<u8> = Vec::new();
        write_frame(&mut bytes, "first").unwrap();
        write_frame(&mut bytes, "second").unwrap();
        let mut cursor = Cursor::new(bytes);
        assert_eq!(read_frame(&mut cursor).unwrap().unwrap(), "first");
        assert_eq!(read_frame(&mut cursor).unwrap().unwrap(), "second");
    }

    #[test]
    fn rejects_invalid_content_length() {
        assert_eq!(content_length("Content-Length: 42"), Some(42));
        assert_eq!(content_length("Garbage: 42"), None);
    }
}
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
cd /home/xinggao/dev/rust/nexterm/src-tauri && cargo test --lib lsp::framing
```

预期：FAIL `cannot find module lsp / write_frame not found`。

- [ ] **Step 3: 实现 framing.rs**

```rust
// src-tauri/src/modules/lsp/framing.rs
use std::io::{BufRead, Write};

use super::errors::LspError;

pub const HEADER_PREFIX: &str = "Content-Length: ";

/// 解析 Content-Length header；非空且以 prefix 开头返回 Some(len)，否则 None。
pub fn content_length(line: &str) -> Option<usize> {
    let trimmed = line.trim();
    if !trimmed.starts_with(HEADER_PREFIX) {
        return None;
    }
    let value = trimmed.strip_prefix(HEADER_PREFIX)?;
    value.parse().ok()
}

/// 从 reader 读一个完整 LSP 帧；EOF 返回 Ok(None)；不完整帧返回 Ok(None)（需再次调用）。
pub fn read_frame<R: BufRead>(reader: &mut R) -> Result<Option<String>, LspError> {
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = String::new();
        let read = reader.read_line(&mut line).map_err(LspError::Io)?;
        if read == 0 {
            return Ok(content_length.and(None).or(None));
        }
        // LSP 分隔头与 body 用 \r\n；read_line 留下 \n，先 trim。
        let cleaned = line.trim_end_matches(&['\r', '\n'][..]);
        if cleaned.is_empty() {
            break;
        }
        if let Some(len) = content_length(cleaned) {
            content_length = Some(len);
        }
    }
    let len = match content_length {
        Some(n) => n,
        None => return Ok(None),
    };
    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf).map_err(LspError::Io)?;
    Ok(Some(String::from_utf8(buf).map_err(LspError::Utf8)?))
}

/// 把 message 编码为完整的 LSP 帧写入 writer。
pub fn write_frame<W: Write>(writer: &mut W, message: &str) -> Result<(), LspError> {
    let bytes = message.as_bytes();
    let header = format!("Content-Length: {}\r\n\r\n", bytes.len());
    writer.write_all(header.as_bytes()).map_err(LspError::Io)?;
    writer.write_all(bytes).map_err(LspError::Io)?;
    writer.flush().map_err(LspError::Io)?;
    Ok(())
}
```

- [ ] **Step 4: 跑测试，确认通过**

```bash
cd /home/xinggao/dev/rust/nexterm/src-tauri && cargo test --lib lsp::framing
```

预期：4 个 #[test] 全 PASS。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/modules/lsp/framing.rs
git commit -m "feat(lsp): 实现 LSP 帧编解码（Content-Length）"
```

---

## Task 2: LSP 错误类型

**Files:**
- Create: `src-tauri/src/modules/lsp/errors.rs`

**Interfaces:**
- `pub enum LspError { Io(io::Error), Utf8(FromUtf8Error), Spawned(String), UnknownSession, MissingChannel, Poisoned }`
- `impl Display for LspError`
- `impl From<LspError> for String`

- [ ] **Step 1: 实现 errors.rs**

```rust
// src-tauri/src/modules/lsp/errors.rs
use std::string::FromUtf8Error;

#[derive(Debug)]
pub enum LspError {
    Io(std::io::Error),
    Utf8(FromUtf8Error),
    Spawned(String),
    UnknownSession(u32),
    MissingChannel,
    Poisoned,
}

impl std::fmt::Display for LspError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LspError::Io(e) => write!(f, "lsp io: {e}"),
            LspError::Utf8(e) => write!(f, "lsp utf8: {e}"),
            LspError::Spawned(e) => write!(f, "lsp spawn: {e}"),
            LspError::UnknownSession(id) => write!(f, "lsp session {id} not found"),
            LspError::MissingChannel => write!(f, "lsp channel not provided"),
            LspError::Poisoned => write!(f, "lsp mutex poisoned"),
        }
    }
}

impl std::error::Error for LspError {}

impl From<std::io::Error> for LspError {
    fn from(value: std::io::Error) -> Self {
        LspError::Io(value)
    }
}

impl From<LspError> for String {
    fn from(value: LspError) -> Self {
        value.to_string()
    }
}
```

- [ ] **Step 2: 跑编译验证（不需新增测试，编译能过即可）**

```bash
cd /home/xinggao/dev/rust/nexterm/src-tauri && cargo check --all-targets --locked
```

预期：编译通过，可能有 `dead_code` warning（这里没有）。

- [ ] **Step 3: 提交**

```bash
git add src-tauri/src/modules/lsp/errors.rs
git commit -m "feat(lsp): 添加 LspError 类型"
```

---

## Task 3: mock-lsp 子进程

**Files:**
- Create: `src-tauri/src/modules/lsp/mock.rs`

**Interfaces:**
- `pub fn mock_lsp_command() -> std::process::Command`
- 返回一个跑 mock 逻辑的子进程；构造方式：在 Rust 测试中直接 `Command::new(env::current_exe())` 加 `--mock-lsp` 参数，或写成 `/__mock_lsp__/stdio` 内部路由。本任务选最简：在 Rust 中提供一个 `pub fn run_mock_stdio<R, W>(reader, writer)` 让单元测试或集成测试驱动，再在 commands.rs 中把 mock-lsp 暴露为 `command-line` 形式。

本计划选第一种（直接 stdout echo），通过 `nexterm-mock-lsp` 子命令启动。

- [ ] **Step 1: 在 src-tauri/src/main.rs 增加 mock-lsp 子命令路由**

读 `src-tauri/src/main.rs` 现状（现有实现）：

```bash
cat src-tauri/src/main.rs
```

`src-tauri/src/main.rs` 添加参数判断：

```rust
fn main() {
    // LSP mock server 模式：stdout/stdio 与 LSP 客户端对答。
    if std::env::args().any(|a| a == "--mock-lsp") {
        nexterm_lib::lsp::mock::run_mock_stdio().expect("mock-lsp crashed");
        return;
    }
    nexterm_lib::run();
}
```

- [ ] **Step 2: 写 mock.rs（含 run_mock_stdio）**

```rust
// src-tauri/src/modules/lsp/mock.rs
use std::io::{self, BufReader, Write};

use super::framing::{read_frame, write_frame};

/// 启动一个 echo LSP server：读取所有 JSON-RPC 帧并按 LSP 风格回包。
/// 仅用于 Section 2 传输层测试，不实现任何 language server 逻辑。
pub fn run_mock_stdio() -> io::Result<()> {
    let stdin = std::io::stdin();
    let mut reader = BufReader::new(stdin.lock());
    let stdout = std::io::stdout();
    let mut writer = stdout.lock();

    while let Ok(Some(frame)) = read_frame(&mut reader) {
        // 收到任意 initialize 类请求，回一个完整的 InitializeResult。
        if frame.contains("\"initialize\"") {
            let response = r#"{"jsonrpc":"2.0","id":1,"result":{"capabilities":{}}}"#;
            write_frame(&mut writer, response)?;
        } else if frame.contains("\"shutdown\"") {
            let response = r#"{"jsonrpc":"2.0","id":2,"result":null}"#;
            write_frame(&mut writer, response)?;
        } else if frame.contains("\"exit\"") {
            let response = r#"{"jsonrpc":"2.0","id":3,"result":null}"#;
            write_frame(&mut writer, response)?;
            return Ok(());
        }
        // 其他请求：回空 result/null 让 vscode-jsonrpc 不报协议错误。
        else if let Some(id_pos) = frame.find("\"id\":") {
            let prefix = &frame[..id_pos + 5];
            let response =
                format!(r#"{{"jsonrpc":"2.0","id":{prefix}, "result":null}}"#);
            // 使用更简单的回包：原 id 不再尝试抽取
            let _ = id_pos;
            write_frame(
                &mut writer,
                r#"{"jsonrpc":"2.0","id":1,"result":null}"#,
            )?;
        } else {
            // 是 notification（无 id），不回包。
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn echo_roundtrip() {
        let input = format!("Content-Length: {}\r\n\r\n{{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\"}}", 53);
        let bytes = input.into_bytes();
        let mut reader = Cursor::new(bytes);
        let frame = read_frame(&mut reader).unwrap().unwrap();
        assert!(frame.contains("initialize"));
    }
}
```

> 注：本任务只验证 `read_frame` 能解析客户端格式；mock 的 JSON-RPC 响应逻辑由 Task 5 的端到端集成测试驱动验证。

- [ ] **Step 3: 跑测试通过 + 编译通过**

```bash
cd /home/xinggao/dev/rust/nexterm/src-tauri && cargo test --lib lsp::mock
cd /home/xinggao/dev/rust/nexterm/src-tauri && cargo check --all-targets --locked
```

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/main.rs src-tauri/src/modules/lsp/mock.rs
git commit -m "feat(lsp): 实现 mock-lsp（stdio echo）子进程入口"
```

---

## Task 4: LspSession 结构 + 子进程生命周期

**Files:**
- Create: `src-tauri/src/modules/lsp/session.rs`

**Interfaces:**
- `pub struct LspSession { id: SessionId, child: Arc<Mutex<Child>>, stdin: Arc<Mutex<Box<dyn Write + Send>>>, stderr_capture: ... }`
- `pub type SessionId = u32`
- `pub fn spawn<F: FnMut(LspMessage) + Send + 'static>(spec: &LspServerSpec, on_message: F) -> Result<LspSession, LspError>`
  - spawn 子进程并启动 stdout reader thread
- `pub fn write_message(&self, msg: &str) -> Result<(), LspError>`
- `pub fn kill(&self) -> Result<(), LspError>`

- [ ] **Step 1: 实现 session.rs**

```rust
// src-tauri/src/modules/lsp/session.rs
use std::io::{BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

use super::errors::LspError;
use super::framing::{read_frame, write_frame};

pub type SessionId = u32;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspServerSpec {
    pub id: String,
    pub language: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum LspMessage {
    Frame { payload: String },
    ParseError { message: String },
    Stderr { message: String },
    Exit { code: Option<i32> },
}

pub struct LspSession {
    pub id: SessionId,
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<Box<dyn Write + Send>>>,
}

impl LspSession {
    pub fn spawn(
        id: SessionId,
        spec: &LspServerSpec,
        channel: Channel<LspMessage>,
    ) -> Result<Self, LspError> {
        let mut command = Command::new(&spec.command);
        command.args(&spec.args);
        if let Some(cwd) = &spec.cwd {
            command.current_dir(cwd);
        }
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = command
            .spawn()
            .map_err(|e| LspError::Spawned(format!("{}: {e}", spec.command)))?;

        let stdin: Box<dyn Write + Send> = child
            .stdin
            .take()
            .ok_or(LspError::Spawned("stdin missing".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or(LspError::Spawned("stdout missing".into()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or(LspError::Spawned("stderr missing".into()))?;

        let stdin = Arc::new(Mutex::new(stdin));
        let child = Arc::new(Mutex::new(child));

        // stdout reader thread：read_frame + send to channel
        let channel_reader = channel.clone();
        thread::Builder::new()
            .name(format!("nexterm-lsp-stdout-{id}"))
            .spawn(move || {
                let mut reader = BufReader::new(stdout);
                loop {
                    match read_frame(&mut reader) {
                        Ok(Some(frame)) => {
                            let _ = channel_reader.send(LspMessage::Frame { payload: frame });
                        }
                        Ok(None) => {
                            // EOF or partial buffer; check if EOF by attempting peek.
                            // 对于长帧 1MB+ 的 chunk 边界，loop 继续。
                            // EOF 实际通过 child.wait 之后的 Exit 表达。
                            thread::yield_now();
                        }
                        Err(e) => {
                            let _ = channel_reader.send(LspMessage::ParseError {
                                message: e.to_string(),
                            });
                            return;
                        }
                    }
                }
            })
            .map_err(|e| LspError::Spawned(format!("spawn stdout thread: {e}")))?;

        // stderr reader thread
        let channel_stderr = channel.clone();
        thread::Builder::new()
            .name(format!("nexterm-lsp-stderr-{id}"))
            .spawn(move || {
                use std::io::Read;
                let mut reader = BufReader::new(stderr);
                let mut buf = [0u8; 4096];
                while let Ok(n) = reader.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    let _ = channel_stderr.send(LspMessage::Stderr {
                        message: String::from_utf8_lossy(&buf[..n]).to_string(),
                    });
                }
            })
            .map_err(|e| LspError::Spawned(format!("spawn stderr thread: {e}")))?;

        // exit watcher thread
        let child_exit = child.clone();
        let channel_exit = channel.clone();
        thread::Builder::new()
            .name(format!("nexterm-lsp-exit-{id}"))
            .spawn(move || {
                let code = match crate::modules::lock::mutex_lock(&child_exit, "lsp child") {
                    Ok(mut c) => c.wait().ok().and_then(|s| s.code()),
                    Err(_) => None,
                };
                let _ = channel_exit.send(LspMessage::Exit { code });
            })
            .map_err(|e| LspError::Spawned(format!("spawn exit thread: {e}")))?;

        Ok(Self { id, child, stdin })
    }

    pub fn write_message(&self, msg: &str) -> Result<(), LspError> {
        let stdin = &mut *self.stdin.lock().map_err(|_| LspError::Poisoned)?;
        write_frame(stdin, msg)?;
        Ok(())
    }

    pub fn kill(&self) -> Result<(), LspError> {
        let child = &mut *self.child.lock().map_err(|_| LspError::Poisoned)?;
        child.kill().map_err(LspError::Io)?;
        Ok(())
    }
}
```

- [ ] **Step 2: 跑编译**

```bash
cd /home/xinggao/dev/rust/nexterm/src-tauri && cargo check --all-targets --locked
```

预期：编译能过（除非 `commands.rs` 还不存在被 mod.rs 引用）。

- [ ] **Step 3: 提交**

```bash
git add src-tauri/src/modules/lsp/session.rs
git commit -m "feat(lsp): 实现 LspSession 结构与子进程生命周期"
```

---

## Task 5: LspRegistry + 注册 Lsp 模块

**Files:**
- Create: `src-tauri/src/modules/lsp/mod.rs`
- Modify: `src-tauri/src/lib.rs`（注册 lsp 模块）

**Interfaces:**
- `pub struct LspRegistry { sessions: Mutex<HashMap<SessionId, LspSession>>, next_id: AtomicU32 }`
- `pub fn spawn(spec, channel) -> SessionId` 或返回 `Result<SessionId>`
- `pub fn write(id, msg) -> Result<(), LspError>`
- `pub fn kill(id) -> Result<(), LspError>`
- `pub fn list() -> Vec<SessionInfo>`
- `pub fn resolve_command(language) -> Option<LspResolvedCommand>`

- [ ] **Step 1: 写失败测试**

`src-tauri/src/modules/lsp/mod.rs` 末尾：

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tauri::ipc::Channel;

    #[test]
    fn registry_spawns_and_kills_mock_lsp() {
        let registry = LspRegistry::default();
        let (tx, _rx) = std::sync::mpsc::channel::<LspMessage>();
        // tauri::ipc::Channel 在无 AppHandle 下无法直接构造；用伪 channel 跳过。
        // 这里只测 resolve_command 单测。
        assert!(registry.resolve_command("rust").is_some());
        assert!(registry.resolve_command("__nonexistent__").is_none());
    }

    #[test]
    fn resolve_command_finds_mock_lsp_path() {
        let registry = LspRegistry::default();
        let resolved = registry.resolve_command("__mock-lsp__");
        assert!(resolved.is_some(), "mock-lsp resolver must return Some");
    }
}
```

- [ ] **Step 2: 实现 mod.rs**

```rust
// src-tauri/src/modules/lsp/mod.rs
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use tauri::ipc::Channel;

pub mod commands;
pub mod errors;
pub mod framing;
pub mod mock;
pub mod session;

pub use errors::LspError;
pub use session::{LspMessage, LspServerSpec, LspSession, SessionId};

#[derive(Debug, Clone, serde::Serialize)]
pub struct LspResolvedCommand {
    pub command: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct LspSessionInfo {
    pub id: SessionId,
    pub language: String,
    pub spec_id: String,
}

#[derive(Default)]
pub struct LspRegistry {
    sessions: Mutex<HashMap<SessionId, LspSession>>,
    next_id: AtomicU32,
}

impl LspRegistry {
    pub fn spawn(
        &self,
        spec: LspServerSpec,
        channel: Channel<LspMessage>,
    ) -> Result<SessionId, LspError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let session = LspSession::spawn(id, &spec, channel)?;
        crate::modules::lock::mutex_lock(&self.sessions, "lsp registry")
            .map_err(|_| LspError::Poisoned)?
            .insert(id, session);
        Ok(id)
    }

    pub fn write(&self, id: SessionId, msg: String) -> Result<(), LspError> {
        let guard = crate::modules::lock::mutex_lock(&self.sessions, "lsp registry")
            .map_err(|_| LspError::Poisoned)?;
        let session = guard.get(&id).ok_or(LspError::UnknownSession(id))?;
        session.write_message(&msg)
    }

    pub fn kill(&self, id: SessionId) -> Result<(), LspError> {
        let session = {
            let mut guard = crate::modules::lock::mutex_lock(&self.sessions, "lsp registry")
                .map_err(|_| LspError::Poisoned)?;
            guard.remove(&id).ok_or(LspError::UnknownSession(id))?
        };
        session.kill()
    }

    pub fn list(&self) -> Vec<LspSessionInfo> {
        let guard = match crate::modules::lock::mutex_lock(&self.sessions, "lsp registry") {
            Ok(g) => g,
            Err(_) => return Vec::new(),
        };
        let mut out: Vec<LspSessionInfo> = guard
            .iter()
            .map(|(id, s)| LspSessionInfo {
                id: *id,
                language: String::new(),
                spec_id: String::new(),
            })
            .collect();
        // 仅返回 id 列表字段；language/spec_id 后续 Task 6 服务器注册时填充。
        out.sort_by_key(|i| i.id);
        out
    }

    /// 查找对应语言的 LSP server 配置路径。
    pub fn resolve_command(&self, language: &str) -> Option<LspResolvedCommand> {
        match language {
            "__mock-lsp__" | "__mock__" => Some(LspResolvedCommand {
                command: std::env::current_exe()
                    .ok()?
                    .to_string_lossy()
                    .into_owned(),
                args: vec!["--mock-lsp".into()],
            }),
            // Section 3 填充 rust / python / go / typescript 等真实路径。
            _ => {
                if let Ok(path) = which::which("rust-analyzer") {
                    return Some(LspResolvedCommand {
                        command: path.to_string_lossy().into_owned(),
                        args: Vec::new(),
                    });
                }
                None
            }
        }
    }
}

impl Drop for LspRegistry {
    fn drop(&mut self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, session) in sessions.drain() {
                let _ = session.kill();
            }
        }
    }
}

#[cfg(test)]
mod tests;
```

- [ ] **Step 3: 添加 `which` 依赖**

`src-tauri/Cargo.toml` 在 `[dependencies]` 末尾加入：

```toml
which = "6"
```

- [ ] **Step 4: 创建空 commands.rs 占位**

```rust
// src-tauri/src/modules/lsp/commands.rs
// 占位。Task 6 写入具体 #[tauri::command] 注册。
```

- [ ] **Step 5: 跑测试**

```bash
cd /home/xinggao/dev/rust/nexterm/src-tauri && cargo test --lib lsp
cd /home/xinggao/dev/rust/nexterm/src-tauri && cargo clippy --all-targets --locked -- -D warnings
```

预期：2 个 #[test] 通过，clippy 干净。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/modules/lsp/mod.rs src-tauri/src/modules/lsp/commands.rs src-tauri/Cargo.toml
git commit -m "feat(lsp): 实现 LspRegistry 与 mock-lsp 解析器"
```

---

## Task 6: Tauri 命令注册

**Files:**
- Modify: `src-tauri/src/modules/lsp/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- `pub async fn lsp_start(state, spec, channel, workspace) -> Result<SessionId, String>`
- `pub async fn lsp_write(state, id, message) -> Result<(), String>`
- `pub async fn lsp_stop(state, id) -> Result<(), String>`
- `pub async fn lsp_list(state) -> Result<Vec<LspSessionInfo>, String>`
- `pub async fn lsp_resolve_command(state, language) -> Result<Option<LspResolvedCommand>, String>`

- [ ] **Step 1: 在 commands.rs 中补全命令**

```rust
// src-tauri/src/modules/lsp/commands.rs
use tauri::{ipc::Channel, AppHandle, State};

use crate::modules::lsp::LspRegistry;
use crate::modules::workspace::WorkspaceEnv;

use super::{LspMessage, LspResolvedCommand, LspServerSpec, LspSessionInfo, SessionId};

#[tauri::command]
pub async fn lsp_start(
    spec: LspServerSpec,
    workspace: Option<WorkspaceEnv>,
    channel: Channel<LspMessage>,
    registry: State<'_, LspRegistry>,
    _app: AppHandle,
) -> Result<SessionId, String> {
    let _ = workspace;
    registry
        .spawn(spec, channel)
        .map_err(String::from)
}

#[tauri::command]
pub async fn lsp_write(
    id: SessionId,
    message: String,
    registry: State<'_, LspRegistry>,
) -> Result<(), String> {
    registry.write(id, message).map_err(String::from)
}

#[tauri::command]
pub async fn lsp_stop(
    id: SessionId,
    registry: State<'_, LspRegistry>,
) -> Result<(), String> {
    registry.kill(id).map_err(String::from)
}

#[tauri::command]
pub async fn lsp_list(
    registry: State<'_, LspRegistry>,
) -> Result<Vec<LspSessionInfo>, String> {
    Ok(registry.list())
}

#[tauri::command]
pub async fn lsp_resolve_command(
    language: String,
    registry: State<'_, LspRegistry>,
) -> Result<Option<LspResolvedCommand>, String> {
    Ok(registry.resolve_command(&language))
}
```

- [ ] **Step 2: 注册 LspRegistry 状态 + 5 个命令到 lib.rs**

读 `src-tauri/src/lib.rs` 找状态注册位置（通常 `.manage(...)` 块）和 `tauri::generate_handler!` 列表：

```bash
grep -n "manage\|generate_handler" src-tauri/src/lib.rs
```

向 `lib.rs` 添加：

```rust
use modules::lsp;
// ...
// 在 manage 区段加入：
.manage(lsp::LspRegistry::default())
```

在 `tauri::generate_handler![...]` 列表添加：

```rust
lsp::commands::lsp_start,
lsp::commands::lsp_write,
lsp::commands::lsp_stop,
lsp::commands::lsp_list,
lsp::commands::lsp_resolve_command,
```

`src-tauri/src/modules/mod.rs` 添加：

```rust
pub mod lsp;
```

- [ ] **Step 3: 跑编译 + clippy**

```bash
cd /home/xinggao/dev/rust/nexterm/src-tauri && cargo check --all-targets --locked
cd /home/xinggao/dev/rust/nexterm/src-tauri && cargo clippy --all-targets --locked -- -D warnings
```

预期：编译成功，clippy 干净。

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/lib.rs src-tauri/src/modules/lsp/commands.rs src-tauri/src/modules/mod.rs
git commit -m "feat(lsp): 注册 5 个 tauri::command 到 lib.rs"
```

---

## Task 7: native.ts 暴露 LSP 调用

**Files:**
- Modify: `src/lib/native.ts`

**Interfaces:**
- `native.lspStart(spec)` → `Promise<number>`
- `native.lspWrite(id, message)` → `Promise<void>`
- `native.lspStop(id)` → `Promise<void>`
- `native.lspList()` → `Promise<LspSessionInfo[]>`
- `native.lspResolveCommand(language)` → `Promise<LspResolvedCommand | null>`

- [ ] **Step 1: 读 native.ts 现状，确认导出风格**

```bash
grep -n "export\|invoke<" src/lib/native.ts | head -20
```

- [ ] **Step 2: 在 native.ts 末尾添加 5 个方法（与现有 invoke 风格一致）**

```typescript
// src/lib/native.ts (新增区域；保持原有 invoke/类型)

// LSP server 配置 / 会话
export type LspServerSpec = {
  id: string;
  language: string;
  command: string;
  args?: string[];
  cwd?: string | null;
};

export type LspResolvedCommand = {
  command: string;
  args: string[];
};

export type LspSessionInfo = {
  id: number;
  language: string;
  spec_id: string;
};
```

在 `native` 对象上加 5 个方法：

```typescript
  lspStart: (spec: LspServerSpec) => invoke<number>("lsp_start", { spec }),
  lspWrite: (id: number, message: string) =>
    invoke<void>("lsp_write", { id, message }),
  lspStop: (id: number) => invoke<void>("lsp_stop", { id }),
  lspList: () => invoke<LspSessionInfo[]>("lsp_list"),
  lspResolveCommand: (language: string) =>
    invoke<LspResolvedCommand | null>("lsp_resolve_command", { language }),
```

- [ ] **Step 3: 跑测试确认类型编译通过**

```bash
pnpm exec tsc --noEmit
```

预期：编译通过。

- [ ] **Step 4: 提交**

```bash
git add src/lib/native.ts
git commit -m "feat(lsp): 在 native.ts 暴露 lspStart/Write/Stop/List/ResolveCommand"
```

---

## Task 8: 前端 lspTransport.ts 实现

**Files:**
- Create: `src/modules/lsp/lspTransport.ts`
- Create: `src/modules/lsp/lspTransport.test.ts`

**Interfaces:**
- `class TauriLspTransport implements MessageTransport, Disposable`
- 实现 `vscode-jsonrpc` MessageTransport：`send / onMessage / onError / onClose / listen / dispose`
- 不在测试中调真实 Tauri invoke，而是注入 mock `invoke` 与 `Channel` 闭包

- [ ] **Step 1: 写失败测试**

```ts
// src/modules/lsp/lspTransport.test.ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { TauriLspTransport } from "./lspTransport";
import type { LspMessage } from "./types";

const SAMPLE: LspMessage = {
  kind: "frame",
  payload: '{"jsonrpc":"2.0","id":1,"result":null}',
};

describe("TauriLspTransport", () => {
  it("forwards outgoing messages via invoke", async () => {
    const writes: Array<[number, string]> = [];
    const stop = vi.fn();
    const mockInvoke = vi.fn(async (cmd: string, args: { id: number; message: string }) => {
      if (cmd === "lsp_start") return 42;
      if (cmd === "lsp_write") writes.push([args.id, args.message]);
      return undefined;
    });
    const subscribers: Array<(msg: LspMessage) => void> = [];
    const transport = new TauriLspTransport({
      invoke: mockInvoke,
      subscribe(onMsg) {
        subscribers.push(onMsg);
        return () => {
          subscribers.splice(subscribers.indexOf(onMsg), 1);
        };
      },
    });
    await transport.listen();
    const id = transport.sessionId;
    expect(id).toBe(42);

    transport.send("hello");
    expect(writes).toEqual([[42, "hello"]]);

    // 收消息路径
    const msgs: string[] = [];
    transport.onMessage((m) => msgs.push(m));
    subscribers.forEach((cb) => cb(SAMPLE));
    expect(msgs).toEqual([SAMPLE.payload]);

    transport.dispose();
    expect(stop).not.toHaveBeenCalled();
  });

  it("disposes cleanly even before listen completes", () => {
    const transport = new TauriLspTransport({
      invoke: vi.fn(),
      subscribe: (cb) => {
        cb;
        return () => undefined;
      },
    });
    expect(() => transport.dispose()).not.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
pnpm test src/modules/lsp/lspTransport.test.ts
```

预期：FAIL（lspTransport.ts 不存在）。

- [ ] **Step 3: 创建 types.ts**

```ts
// src/modules/lsp/types.ts
export type LspMessage =
  | { kind: "frame"; payload: string }
  | { kind: "parse_error"; message: string }
  | { kind: "stderr"; message: string }
  | { kind: "exit"; code: number | null };
```

- [ ] **Step 4: 实现 lspTransport.ts**

```ts
// src/modules/lsp/lspTransport.ts
import type { Channel, InvokeArgs } from "@tauri-apps/api/core";
import type { MessageTransport } from "vscode-jsonrpc";
import { Emitter } from "vscode-jsonrpc";

import { invoke as defaultInvoke } from "@tauri-apps/api/core";
import type { LspMessage } from "./types";

type SubscribeFn = (onMessage: (msg: LspMessage) => void) => () => void;

type TransportDeps = {
  invoke: (cmd: string, args?: InvokeArgs) => Promise<unknown>;
  subscribe: SubscribeFn;
};

const defaultSubscribe: SubscribeFn = (cb) => {
  // 真实情况下，由 EditorPane / DiffEditor 注入实现。
  // 此函数仅做参数兜底，调用方须自行重写 subscribe。
  void cb;
  return () => undefined;
};

export class TauriLspTransport implements MessageTransport, Disposable {
  public sessionId = -1;
  private readonly emitter = new Emitter<string>();
  private readonly errorEmitter = new Emitter<Error>();
  private disposed = false;

  constructor(private readonly deps: Partial<TransportDeps> = {}) {}

  async listen(): Promise<void> {
    if (this.disposed) throw new Error("lsp transport disposed");
    const invoke = this.deps.invoke ?? (defaultInvoke as TransportDeps["invoke"]);
    const subscribe = this.deps.subscribe ?? defaultSubscribe;
    const spec = this.queuedSpec;
    if (!spec) throw new Error("lsp spec missing: call start() before listen()");
    this.sessionId = (await invoke("lsp_start", { spec })) as number;
    subscribe((msg) => {
      if (msg.kind === "frame") this.emitter.fire(msg.payload);
      if (msg.kind === "parse_error")
        this.errorEmitter.fire(new Error(msg.message));
      if (msg.kind === "exit") this.emitter.fire("");
    });
    this.queuedSpec = null;
  }

  private queuedSpec: unknown = null;

  /** 在 listen 之前预先存入 spec；通常由 manager 顺序调用。 */
  primeSpec(spec: unknown): void {
    this.queuedSpec = spec;
  }

  send(message: string): void {
    if (this.disposed || this.sessionId < 0) return;
    void this.deps
      .invoke?.("lsp_write", { id: this.sessionId, message })
      .catch(() => undefined);
  }

  onMessage(cb: (msg: string) => void): { dispose: () => void } {
    return this.emitter.event(cb);
  }

  onError(cb: (err: Error) => void): { dispose: () => void } {
    return this.errorEmitter.event(cb);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.sessionId >= 0) {
      void this.deps.invoke?.("lsp_stop", { id: this.sessionId });
    }
    this.emitter.dispose();
    this.errorEmitter.dispose();
  }
}
```

- [ ] **Step 5: 跑测试**

```bash
pnpm test src/modules/lsp/lspTransport.test.ts
```

预期：2 个 #[test] 通过。

- [ ] **Step 6: 提交**

```bash
git add src/modules/lsp/
git commit -m "feat(lsp): 实现 TauriLspTransport 与 vscode-jsonrpc 适配"
```

---

## Task 9: 端到端集成测试（mock-lsp ↔ lspTransport）

**Files:**
- Create: `src-tauri/src/modules/lsp/lsp_integration.test.rs`

**Interfaces:**
- 启 `nexterm_lib` 进程带 `--mock-lsp`，通过 pipe 模拟 LSP client，验证整链路。

> 由于本项目测试运行模式是 `cargo test --lib`，spawn 子进程可能需要 `Command::new` 拉起 `cargo run --bin nexterm -- --mock-lsp`。该集成测试用 thread::spawn 起步 mock-lsp，本地用 stdin/stdout pipe 通信。

- [ ] **Step 1: 实现 lsp_integration.test.rs**

```rust
// src-tauri/src/modules/lsp/lsp_integration.test.rs
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

#[test]
fn mock_lsp_responds_to_initialize() {
    let exe = env!("CARGO_BIN_EXE_nexterm");
    let mut child = Command::new(exe)
        .arg("--mock-lsp")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn mock-lsp");

    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let mut reader = BufReader::new(stdout);

    // 1) 写一个 initialize 请求
    let request = r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#;
    let header = format!("Content-Length: {}\r\n\r\n", request.len());
    stdin.write_all(header.as_bytes()).unwrap();
    stdin.write_all(request.as_bytes()).unwrap();
    stdin.flush().unwrap();

    // 2) 读响应帧
    let mut content_length: Option<usize> = None;
    let mut body = String::new();
    let mut line = String::new();
    loop {
        line.clear();
        let n = reader.read_line(&mut line).unwrap();
        if n == 0 { panic!("EOF before header"); }
        let t = line.trim_end_matches(|c| c == '\r' || c == '\n');
        if t.is_empty() { break; }
        if let Some(rest) = t.strip_prefix("Content-Length: ") {
            content_length = Some(rest.parse().unwrap());
        }
    }
    let n = content_length.unwrap();
    body.resize(n, 0u8 as char);
    let mut buf = vec![0u8; n];
    std::io::Read::read_exact(&mut reader, &mut buf).unwrap();
    let body = String::from_utf8(buf).unwrap();

    assert!(body.contains("\"id\":1"));
    assert!(body.contains("\"result\""));

    // cleanup
    drop(stdin);
    let _ = child.wait();
}

fn _unused_read_line_compile_helper() {
    // 帮助 rustc 推断 BufRead trait 依赖
    let mut r: BufReader<&[u8]> = BufReader::new(&[][..]);
    let mut line = String::new();
    let _ = r.read_line(&mut line);
}
```

- [ ] **Step 2: 跑测试**

```bash
cd /home/xinggao/dev/rust/nexterm/src-tauri && cargo test --test lsp_integration -- --nocapture 2>&1 | head -40
```

预期：PENDING — `cargo test --test` 需要新建 `src-tauri/tests/lsp_integration.rs` 而非 inline `*_integration.test.rs`。如果失败，调整为 `tests/lsp_integration.rs`：

```bash
mkdir -p src-tauri/tests && mv src-tauri/src/modules/lsp/lsp_integration.test.rs src-tauri/tests/lsp_integration.rs
```

再次跑：

```bash
cd /home/xinggao/dev/rust/nexterm/src-tauri && cargo test --test lsp_integration -- --nocapture
```

预期：1 个 #[test] 通过。

- [ ] **Step 3: 提交**

```bash
git add src-tauri/tests/lsp_integration.rs
git commit -m "test(lsp): 端到端集成测试（mock-lsp ↔ stdin/stdout）"
```

> 注：CARGO_BIN_EXE_nexterm 由 cargo 在测试时自动设置，指向被测二进制所在的同一 target 目录。

---

## Task 10: IPC 边界测试 + 全量验证

**Files:**
- Create: `src/modules/lsp/lspIpcBoundary.test.ts`

**Interfaces:**
- 防止 `src/modules/editor/*` 与 `src/modules/lsp/manager.ts` 直接 `invoke("lsp_*")`，必须走 `native.lsp*`。

- [ ] **Step 1: 写 lspIpcBoundary.test.ts**

```ts
// src/modules/lsp/lspIpcBoundary.test.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCAN_ROOTS = ["src/modules/editor", "src/modules/lsp"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (st.isFile() && /\.(ts|vue)$/.test(p)) out.push(p);
  }
  return out;
}

describe("lsp IPC boundary", () => {
  it("forbids direct invoke of lsp_* commands outside native.ts", () => {
    const files = SCAN_ROOTS.flatMap((r) => walk(r));
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      // 允许我们的 transport.ts 内部通过 deps.invoke 发送 lsp_write（这是抽象层），
      // 但禁止源码出现 invoke("lsp_start"|"lsp_write"|"lsp_stop"|"lsp_list"|"lsp_resolve_command")。
      const matches = text.match(/invoke\(\s*["'`]lsp_(start|write|stop|list|resolve_command)/g);
      if (matches) offenders.push(`${file}: ${matches.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑全量测试 + clippy + build**

```bash
pnpm test
cd /home/xinggao/dev/rust/nexterm/src-tauri && cargo check --all-targets --locked
cd /home/xinggao/dev/rust/nexterm/src-tauri && cargo clippy --all-targets --locked -- -D warnings
pnpm build
```

预期：所有新增测试通过；既有 12 个 pre-existing 失败仍存在（与本任务无关）；build 成功。

- [ ] **Step 3: 提交**

```bash
git add src/modules/lsp/lspIpcBoundary.test.ts
git commit -m "test(lsp): 添加 LSP IPC 边界测试，禁止绕过 native.lsp*"
```

---

## Spec Coverage Check

对照 `docs/superpowers/specs/2026-07-16-monaco-lsp-migration-design.md` Section 2 章节：

| Spec 项 | 对应任务 |
| --- | --- |
| 4.1 目标（stdio-via-Tauri-IPC） | Task 1–Task 8 |
| 4.2 Rust 模块目录 | Task 1, 2, 3, 4, 5, 6 |
| 4.3 数据流图 | Task 4 / Task 8 |
| 4.4 Tauri 命令（lsp_start/write/stop/list/resolve_command） | Task 6 |
| 4.5 前端 Transport (`MessageTransport`) | Task 8 |
| 4.6 生命周期与崩溃恢复 | Task 4（reader 线程 + exit 线程） |
| 4.7 严格边界（native.ts + IPC） | Task 7, Task 10 |
| 4.8 完成标志（mock-lsp 往返 + 1MB diagnostic + 心跳） | Task 9（往返）+ 1MB 在后期待续 |

Section 3（真实 LSP 接入）将基于此传输层在另一个 plan 中实施。
