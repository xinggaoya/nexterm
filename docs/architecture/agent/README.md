# nexterm-agent(WSL 常驻代理)

## 职责

`nexterm-agent` 是一个独立的 Linux 二进制(`src-tauri/agent/` crate),在 WSL
发行版内以常驻进程运行,通过**单一 stdio JSON-lines 通道**承载宿主侧需要的
远程操作。目标是替代"每个操作 spawn 一次 `wsl.exe`"的 legacy 路径
(参照 VS Code Remote 的 server 模型;方案讨论见 Phase 0 设计)。

当前(Phase 0 + 0b)覆盖:

| method / 模式 | 作用 | 替代的 legacy 路径 |
|--------|------|--------------------|
| `ping` | 探活 + 版本协商 | 每次 spawn 前的多次 `wsl.exe` 探测 |
| `fs.readDir` / `fs.stat` / `fs.readFile` | fs 读操作(结构化 JSON 返回) | `fs/wsl_ops.rs` 的 `wsl.exe --exec cat/sh` shell-out |
| `fs.writeFile` / `createFile` / `createDir` / `rename` / `delete` / `copy` | fs 写操作(原子写/存在性检查/递归拷贝,语义对齐 `fs/mutate.rs`) | UNC `\wsl.localhost` 写双轨 |
| `fs.search` / `fs.listFiles` / `fs.grep` / `fs.glob` | 文件名搜索/文件列表/内容查找/glob(`ignore`+`grep` 三件套,常量与剪枝规则逐项对齐) | 宿主侧走 UNC 9P 的遍历 |
| `exec` | 无 shell 直执行 argv,可选 cwd/env/stdin,超时击杀,输出上限 | `git/process.rs` 的全部 30 个 git 命令、git 可用性探测 |
| `watch --root`(子命令) | 文件监听,stdout 逐事件 JSON 行,**带逐路径 kinds**(create/modify/remove) | 原 `wsl-watcher-helper` crate(已删除并入) |

运行模式三种:
- `serve`(默认):stdio JSON-lines 常驻循环,WSL 传输使用;
- `once`:stdin 读一行请求、stdout 写一行响应即退出,SSH 逐通道 exec
  传输使用(见 `docs/architecture/ssh/README.md` Phase 2);
- `watch --root <path>`:文件监听事件流,供 `fs/watcher/wsl.rs` 消费。

## 协议

- 传输:stdin/stdout,每行一个 JSON,UTF-8;stderr 仅诊断。
- 请求:`{"id":<u64>,"method":"...","params":{...}}`
- 响应:`{"id":<u64>,"ok":true,"result":...}` / `{"id":<u64>,"ok":false,"error":"..."}`
- 响应可乱序(worker 并发),客户端按 id 路由。
- **stdin EOF 即退出**:宿主关闭 wsl.exe 时管道断开,agent 自行退场,
  不在发行版里留孤儿进程 —— 这是依赖 wsl.exe 传输而不自建守护进程的
  核心安全设计。
- `exec` 语义对齐 legacy:`exitCode`(超时/信号为 null)、`timedOut`、
  `truncated`(超过 `maxOutputBytes`);env 为覆盖集(保留父环境)。

## 安装与嵌入

- 构建:`cd src-tauri && cargo build -p nexterm-agent --release --target x86_64-unknown-linux-musl`
  (Windows 宿主请在 WSL 内构建;纯 Rust 依赖,`rust-lld` 即可链接:
  `RUSTFLAGS="-C linker=rust-lld"`)。
- 产物落在 `target/x86_64-unknown-linux-musl/release/nexterm-agent` 时,
  `build.rs` 自动以 `include_bytes!` 内嵌(与 watcher helper 同机制);
  也可用 `NEXTERM_AGENT` 环境变量指向现成二进制。
- 运行期安装:经 `wsl.exe sh -c 'mkdir -p && cat > && chmod 755'` 管道写入
  `~/.cache/nexterm/agent/nexterm-agent-<版本>-<架构>`;已存在且大小一致则跳过。
- **资产缺失时 agent 整体不可用**,所有调用方自动回退 legacy 路径,行为与
  改造前完全一致(渐进发布的安全网)。

## 客户端(src-tauri/src/modules/agent/)

- `connection.rs`:单连接管理 —— spawn、按 id 路由响应、请求超时即自杀重建。
- `manager.rs`:每 distro 一个连接;连续 3 次失败熔断 60s,期间直接走 legacy。
- `install.rs`:资产解析 + 管道安装(带 wsl_home 缓存)。
- `protocol.rs`:宽松解析(agent 是独立 crate,协议演进时旧宿主需容忍未知字段)。

调用契约:**agent 永远只是加速路径**。`fs/wsl_ops.rs` 与 `git/process.rs`
在 agent Err 时必须回退原路径,错误信息保持不变。

## 端到端冒烟

```bash
cd src-tauri
cargo run --example agent_smoke -- Ubuntu /tmp
```

覆盖 安装 → spawn → ping → fs.readDir/fs.stat → exec git 全链路。

## 测试

- agent crate(`cargo test -p nexterm-agent`):协议往返、serve 循环、
  fs handlers(跨平台)、exec(unix 专项:输出捕获/env/cwd/超时击杀/stdin)。
- 宿主侧:protocol 解析、install 路径、manager 熔断语义;
  `cfg(test)` 下 agent 恒不可用,保证测试不触碰真实 WSL。
- git/fs 的既有测试同时充当回退路径的回归保护。
