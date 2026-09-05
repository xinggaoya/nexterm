//! nexterm-agent:Nexterm 在 WSL 发行版内运行的常驻代理。
//!
//! 设计参照 VS Code Remote 的 server 模型:宿主(Windows)侧通过
//! `wsl.exe --exec` 拉起本进程,之后所有 fs 读操作与 exec 都在这一个
//! 持久 stdio 通道上以 JSON-lines 协议完成,替代逐次 `wsl.exe` shell-out。
//!
//! 协议约定:
//! - 每行一个 JSON 消息,UTF-8,`\n` 结尾;
//! - 请求:`{"id":<u64>,"method":"...","params":{...}}`;
//! - 响应:`{"id":<u64>,"ok":true,"result":...}` 或
//!   `{"id":<u64>,"ok":false,"error":"..."}`;
//! - stdin EOF 即退出(wsl.exe 被杀时管道关闭,agent 随之退场,不留孤儿)。

pub const PROTOCOL_VERSION: &str = "1";

pub mod handlers;
pub mod protocol;
pub mod search;
pub mod server;
pub mod watch;
