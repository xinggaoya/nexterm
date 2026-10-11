# 04. 安全模型

> 本文件描述 Nexterm 的安全边界、威胁模型与实现细节。新增系统访问相关代码前请先阅读。

## 1. 威胁模型

| 攻击面 | 威胁 | 缓解 |
|--------|------|------|
| Webview XSS | 攻击者在 terminal / markdown / preview 中注入恶意代码 | Rust 是唯一 IPC 出口（`nativeBoundary` + `tauriSurfaceBoundary` 两条测试守住整个 `@tauri-apps` 能力面）；markdown 渲染器的 `data:` 图片走**整体正则白名单**而非 `startsWith`（`markdownRenderer.test.ts` 有针对属性注入的回归用例） |
| 路径遍历 | 攻击者通过 `fs_read_file` 越权访问 | 每个碰本地文件系统的命令入口都调 `workspace::authorize_access_path`：canonicalize（消掉 `..` 与符号链接）→ 必须落在已授权根之下。**唯一出口**，不是每个模块各写一份 |
| 进程逃逸 | shell 子进程脱离 Tauri 控制继续运行 | Windows `Job Object` 强制随父进程终止 |
| PTY 资源耗尽 | 大量终端会话占用内存 | 标签页关闭时显式 `pty_close`；transcript 上限；pending buffer 上限 |
| 深链自授权 | 恶意 `nexterm://open?workspacePath=~/.ssh` 把凭据目录变成工作区 | URL 在 Rust 端解析为 `DeepLinkOpenRequest`；前端**必须先弹确认**（`lib/confirmDeepLink.ts`）才调 `workspace_authorize`。`WorkspaceRegistry::authorize` 另外硬性拒绝 `~/.ssh`、`~/.aws`、`~/.gnupg` 等目录 |
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

- 任何碰本地文件系统的命令（`fs_*`、`git_*` 的 repo root、`lsp_start` 的 cwd）必须在入口调用 `workspace::authorize_access_path`；任何创建子进程的路径（`pty_open` / `shell_bg_spawn` / `lsp_start`）必须调用 `authorize_spawn_cwd`。
- `lsp_start` 只接受 `language`：可执行文件来自后端白名单（`lsp::servers::resolve_for_language`），**不接受来自 IPC 的 `command`** —— 否则它就是一个以宿主权限执行任意程序的接口。
- `is_authorized` 用 `target.starts_with(root)` 判定（**不是**字符串相等）。
- 毒化的 `Mutex` 视作"未授权"，要求调用方重新 bootstrap。
- canonical 缓存 TTL = 1s，cap = 256，控制 TOCTOU 窗口。

### 3.3 授权触发点

| 触发 | 命令 |
|------|------|
| 用户在 UI 打开工作区 | `workspace_authorize`（Rust 侧无用户交互校验，所以**深链路径必须由前端先确认**） |
| 应用冷启动带 launch_dir | `bootstrap_registry_with_launch_dir` |
| PTY 启动子进程 | `authorize_spawn_cwd` |
| 文件命令 | `authorize_access_path`（写路径用 `_lenient` 版本，允许目标尚不存在） |
| shell / pty / lsp 的 cwd | `authorize_spawn_cwd`（缺省 cwd 落到当前工作区根，不是「不检查」） |

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
- [x] 命令执行前过 `authorize_*` —— 守护测试：`src/lib/commandRegistrationContract.test.ts`
      （每个已注册命令都必须有前端出口）、`src-tauri/src/modules/workspace/registry.rs`
      的 `auth_tests` 模块（符号链接逃逸、越权目录、凭据目录、容量上限）。
- [ ] 返回值是 `Result<T, String>`。
- [ ] panic 安全：所有 `Mutex` / `RwLock` 走 `lock.rs`。
- [ ] Windows shell 进程挂 Job Object。
- [ ] 高频流式数据走 `Channel`，不滥用 `EventBus`。
- [ ] 路径边界处显式归一化。
- [ ] 错误路径有结构化日志（`log::warn!` / `log::error!`）。
- [ ] 前端调用走 `native.*`，不直接 `invoke`。

## 11. 已落实的加固

这一节记录**代码里真实存在**的约束及其守护位置，避免下一个人重新论证一遍。

| 约束 | 位置 | 守护 |
|------|------|------|
| 路径访问统一 chokepoint | `workspace::authorize_access_path` | `registry.rs::auth_tests` |
| 凭据目录永不被授权 | `registry.rs::is_sensitive_dir` | `authorize_refuses_sensitive_home_subdirectories` |
| 启动时**不**授权整个 `$HOME` | `bootstrap_registry_with_launch_dir` + `resolve_launch_dir`（后者不再兜底到家目录） | `bootstrap_stays_empty_when_there_is_no_real_launch_dir` |
| 授权根数量有上限 | `MAX_AUTHORIZED_ROOTS = 64` | `authorized_roots_are_capped` |
| 进程创建的 cwd 不可绕过 | `authorize_spawn_cwd` | `falls_back_to_the_active_root` |
| LSP 命令只能来自后端白名单 | `lsp::LspRegistry::resolve_spec` | `unknown_language_resolves_to_none` + `commandRegistrationContract.test.ts`（断言 `lsp_start` 的 IPC 参数里没有 `command`） |
| markdown `data:` 图片整体白名单 | `markdownRenderer.ts` | `blocks attribute-breaking payloads…` |
| release 不带 WebView 检查器 | `Cargo.toml` 的 `features.devtools`（默认关） | `GeneralSection.vue` 用 `devtools_available` 探测后整行不渲染 |
| 禁用 `ssh-rsa`（Marvin Attack） | `ssh::client::preferred_algorithms` | `drops_sha1_rsa_host_key_algorithms` |
| 远端通道输出有上限 | `ssh::bounded::BoundedBuffer`（2 MiB） | `accumulates_until_the_cap` / `drops_everything_past_the_cap` |
| 每个已注册命令都有前端出口 | — | `commandRegistrationContract.test.ts` |

已知的、**未**解决的：

- `rsa 0.10.0-rc.18` 的 RUSTSEC-2023-0071 上游无修复版本；已通过禁用 SHA-1
  算法族规避，`src-tauri/audit.toml` 记录了这次风险接受。
- SSH 口令仍只在 webview 内存里（`modules/ssh/sshSecrets.ts`），未接 OS keychain。
- 深链的授权确认是 `window.confirm`，不是原生对话框（深链路径在 `app.mount()`
  之前运行，拿不到 Vue 的 dialog provider）。
