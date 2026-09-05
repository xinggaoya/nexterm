# SSH(Phase 1 传输骨架 + Phase 2 远端一致性)

## 职责

Phase 1 提供「能用的 SSH 终端」:

- **连接档案管理**:CRUD 存储于 `app_data_dir/ssh-profiles.json`(Rust 侧独占,前端经命令读写);
- **TOFU known_hosts**:`ssh-known-hosts.json`,首连记录、匹配放行、**指纹变化一律拒绝**(错误带 `SshHostKeyChanged: ` 稳定前缀);接受变化 UI 属 Phase 3;
- **SSH 终端**:russh `request_pty` + `request_shell`(或 `cd <cwd> && exec $SHELL -l`),输出经 Tauri `Channel` 回流 —— 与本地 ConPTY 相同的 IPC 形状,前端 `sessions.ts` 零改动;
- **WorkspaceEnv::Ssh 贯通**:工作区环境选择器新增 SSH 档案项;fs/git/shell 命令入口由 `workspace::reject_ssh_unsupported` 统一拒绝(Phase 1 边界,清晰报错而非误走本地路径)。

## 凭据安全边界(重要)

- 密码 / 私钥 passphrase **永不落盘**:前端 `sshSecrets.ts` 内存缓存(按
  workspace scope key),每次 `pty_open` 经 `authSecret` 参数单次传递;
- OS keychain(`keyring` crate)接入属 Phase 3;
- 私钥档案只存路径,passphrase 连接时询问。

## Phase 2:远端一致性(agent-over-SSH)

SSH 工作区的能力经 SSH 通道上的 **nexterm-agent** 提供:

- **连接池**:`SshConnectionPool`(每 profile 一条持久 russh 连接)。
  `ssh_connect_test` 探针成功后入池;keepalive 判死后操作报错,重新打开
  工作区重建(Phase 3 keychain 落地前无凭据可自动重连)。
- **agent 安装**:`ensure_remote_agent` 校验远端
  `~/.cache/nexterm/agent/nexterm-agent-<版本>-<架构>`(存在且大小一致则
  跳过),否则把内嵌二进制经 exec 通道 stdin 管道推送。
- **执行形态**:每操作一个 exec 通道(`nexterm-agent once`:stdin 一行
  请求、stdout 一行响应)。TCP 连接持久,开通道成本可控;持久 serve
  通道复用属后续优化,协议不变。
- **已接入的远端能力**:`fs_read_dir` / `fs_read_file` / `fs_read_file_base64`
  (资源管理器 + 编辑器读路径)、**全部 git 命令**(`run_git_uncached`
  的 SSH 分支,env 覆盖集与本地一致),以及 Phase 0b 后的 **fs 写操作**
  (createFile/createDir/rename/delete/copy/writeFile)与
  **search/listFiles/grep/glob**。
- **仍被 `reject_ssh_unsupported` 拒绝**:fs watcher(事件流尚未经 SSH
  传输;可后续挂 agent watch)与后台 shell(`shell_bg_*` 的日志环仍在
  宿主侧)。

## Tauri 命令

| 命令 | 作用 |
|------|------|
| `ssh_profile_list` / `ssh_profile_save` / `ssh_profile_delete` | 连接档案 CRUD |
| `ssh_known_hosts_list` / `ssh_known_hosts_remove` | 主机密钥查看/移除(重建服务器后清理) |
| `ssh_connect_test` | 连接探针:校验凭据 + 解析远端 HOME/登录 shell |

另有 `pty_open` 的 `authSecret` 参数(SSH 分流),前端无需感知差异。

## 前端流程

打开 SSH 工作区 = `pickWorkspaceDirectory({kind:"ssh"})` →
`SshConnectDialog`(选档案/新建 + 输入口令)→ `ssh_connect_test` 探针
(远端 HOME 即工作区根)→ 口令入内存缓存 → 正常工作区流。

## 测试

- **loopback 集成测试**(`modules/ssh/tests.rs`):进程内 russh server,
  真实 SSH 协议往返 —— 连接、TOFU 记录、错误密码拒绝、exec 回显、
  PTY 终端读写与回显;
- profiles/known_hosts 的存储与 TOFU 语义单测(跨平台);
- 前端:`sshSecrets` 行为、`workspaceEnvContract`(TS/Rust env 契约漂移守卫)。

## 依赖

`russh = "0.63"`(默认关闭,`ring` + `flate2` + `rsa` features;Windows MSVC
可编译)。循环回环测试另需 dev-deps `tokio(rt-multi-thread,macros)`。

## Phase 3 路线

1. known_hosts 变化确认 UI(当前指纹变化直接拒绝,需手动清理条目);
2. keychain 凭据存储(解锁断线自动重连);
3. 跳板机、端口转发面板、持久 serve 通道复用;
4. 文件写入下沉远端 agent + SFTP 优雅降级、watcher-over-ssh(轮询兜底)。
