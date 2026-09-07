# 04. 安全模型

> 本文件描述 Nexterm 的安全边界、威胁模型与实现细节。新增系统访问相关代码前请先阅读。

## 1. 威胁模型

| 攻击面 | 威胁 | 缓解 |
|--------|------|------|
| Webview XSS | 攻击者在 terminal / markdown / preview 中注入恶意代码 | Rust 是唯一 IPC 出口；`nativeBoundary` 禁止 webview 直接 invoke；markdown / preview 输出做白名单 |
| 路径遍历 | 攻击者通过 `fs_read_file` 越权访问 | `WorkspaceRegistry.authorize_*` 在 Rust 端先 canonicalize 并检查前缀 |
| 进程逃逸 | shell 子进程脱离 Tauri 控制继续运行 | Windows `Job Object` 强制随父进程终止 |
| PTY 资源耗尽 | 大量终端会话占用内存 | 标签页关闭时显式 `pty_close`；transcript 上限；pending buffer 上限 |
| 深链滥用 | 恶意 `nexterm://` URL 打开任意工作区 | URL 在 Rust 端解析为 `DeepLinkOpenRequest` 再发给前端；前端不直接解析 URL |
| 子进程控制台闪烁 | Windows shell 弹窗 | `process::suppress_command_window` 隐藏窗口 |
| ConPTY 管道卡住 | 并发启动 PTY 阻塞首屏输出 | `pty_open` 互斥序列化保护 |
| React 残留 | 历史迁移未清理导致跨框架漏洞 | 5 个 React 边界测试 + `vueShellBoundary` |
| 远程终端 | 攻击者注入远程连接回源 | `noRemoteTerminalBoundary.test.ts` 禁止相关符号 |

## 2. 唯一系统访问层

Webview **永远不**直接接触：

- 文件系统（无 `fs` 提案、无 Node `fs`）
- 进程（无 `child_process`）
- shell（无 `os.exec` / `popen`）
- 任何 native API

**所有 IPC 必须经 `src/lib/native.ts`**。`src/lib/nativeBoundary.test.ts` 用静态扫描保证：

- `src/` 内除 `src/lib/native.ts` 与测试文件外不允许出现 `invoke(`、`listen(`、`emit(`。
- 不允许 import `@tauri-apps/api/core`、`@tauri-apps/api/event`（除 `native.ts` 外）。

## 3. WorkspaceRegistry 授权

`src-tauri/src/modules/workspace/registry.rs` 的 `WorkspaceRegistry` 维护"已授权工作区根集合"。

### 3.1 授权 API

```rust
registry.authorize(path) -> io::Result<PathBuf>
registry.is_authorized(target) -> bool
registry.longest_authorized_root(target) -> Option<String>
registry.canonicalize_cached(path) -> io::Result<PathBuf>
```

### 3.2 关键不变量

- 任何 `fs_*` / `pty_*` / `shell_*` / `git_*` 命令必须先调用 `authorize_*`（不同模块有不同 helper）。
- `is_authorized` 用 `target.starts_with(root)` 判定（**不是**字符串相等）。
- 毒化的 `Mutex` 视作"未授权"，要求调用方重新 bootstrap。
- canonical 缓存 TTL = 1s，cap = 256，控制 TOCTOU 窗口。

### 3.3 授权触发点

| 触发 | 命令 |
|------|------|
| 用户在 UI 打开工作区 | `workspace_authorize` |
| 应用冷启动带 launch_dir | `bootstrap_registry_with_launch_dir` |
| PTY 启动子进程 | `authorize_spawn_cwd` |
| 文件 / shell / git 命令 | 各自 `authorize_*` |

## 4. Windows Job Object

`src-tauri/src/modules/pty/job.rs` 在 Windows 上为 PTY 创建 Job Object：

- 进程启动后立即挂入 Job。
- 关闭 PTY 时，Job Object 终止 -> 子进程树被强制结束。
- 不能用"轻量替代"（例如只 `Child::kill` 主进程）替换：会留下孤儿子进程。

## 5. ConPTY 序列化保护

Windows ConPTY 在某些场景下并发打开会卡住首屏输出管道。`pty_open` 在 `lib.rs` 装配时通过互斥保护：

- 同一时刻只允许一个 `pty_open` 真正 spawn。
- 其他 `pty_open` 等待互斥释放后再执行。

这条约束的**理由**写在 commit message / `panic_report.rs` 等位置，**不要随意删除**互斥代码。

## 6. Transcript 临时文件

PTY 输出同时走两条路径：

1. **Tauri `Channel<Response>`**：流式推送给 xterm.js 渲染。
2. **`tempfile::NamedTempFile`**：用于 `pty_read_transcript` 在断线 / 慢速前端时回放。

关键常量（`src-tauri/src/modules/pty/session.rs`）：

```rust
const FLUSH_COALESCE: Duration = Duration::from_millis(6);
const FLUSH_MAX_IDLE: Duration = Duration::from_millis(50);
const READ_BUF: usize = 16 * 1024;
const MAX_PENDING: usize = 6 * 1024 * 1024;
const MAX_TRANSCRIPT_READ: usize = 4 * 1024 * 1024;
```

- `FLUSH_COALESCE` 合并短窗口内小 chunk，降低 Channel 帧率。
- `MAX_PENDING` 超过后只丢 live channel（不丢 transcript），前端用 offset 弥补。
- `MAX_TRANSCRIPT_READ` 限制单次 transcript 读大小。

## 7. 深链解析

`nexterm://` URL 在 Rust 端解析，**前端不解析**。

```rust
pub const DEEP_LINK_OPEN_EVENT: &str = "nexterm://deep-link-open";
pub struct DeepLinkOpenRequest { path, env, wsl_distro? }
```

支持的格式：

- `nexterm://open?workspacePath=...&workspaceEnv=local|wsl&wslDistro=...`
- `nexterm:///absolute/path`
- `nexterm://host/absolute/path`

冷启动时（macOS / iOS）插件在 `setup` 之前会保存 URL，setup 钩子里用 `get_current()` 重发。

## 8. Panic Hook

`src-tauri/src/panic_report.rs` 在 `run()` 开头安装一次 panic hook：

- 写 `log::error!`（结构化，含 thread name / payload / location）
- 写 `eprintln!` 到 stderr（便于开发期直接看）

不在 panic hook 里 `unwind` 或 `exit`：让 Tauri 走正常 crash 路径。

## 9. React / 远程终端 / AI 边界

仓库里**不存在**以下代码 / 依赖，且有边界测试守护：

- React（5 个测试覆盖 import、源码、命名）
- 远程终端（`noRemoteTerminalBoundary`）
- AI 功能（`noAiFeaturesBoundary`）

新模块**不允许**引入这些能力。如确有需求，必须：

1. 先开 issue 讨论。
2. 改业务模型（新增配置项、用户主动开启）。
3. 同步更新边界测试的"允许列表"。

## 10. 审计清单

新增 / 修改系统访问代码时自检：

- [ ] 命令注册到 `lib.rs::invoke_handler`。
- [ ] 命令签名包含 `workspace: Option<WorkspaceEnv>`。
- [ ] 命令执行前过 `authorize_*`。
- [ ] 返回值是 `Result<T, String>`。
- [ ] panic 安全：所有 `Mutex` / `RwLock` 走 `lock.rs`。
- [ ] Windows shell 进程挂 Job Object。
- [ ] 高频流式数据走 `Channel`，不滥用 `EventBus`。
- [ ] 路径边界处显式归一化。
- [ ] 错误路径有结构化日志（`log::warn!` / `log::error!`）。
- [ ] 前端调用走 `native.*`，不直接 `invoke`。
