//! Phase 2:SSH 远端执行层 —— 在 SSH 连接上安装并调用 nexterm-agent。
//!
//! 传输形态:每操作一个 exec 通道(`nexterm-agent once`,请求经 stdin、
//! 响应经 stdout)。russh 的 TCP 连接本身持久,开通道成本远低于重新握手;
//! 持久 serve 通道的复用属后续优化,协议不变。
//!
//! 连接来源:`SshConnectionPool`(Tauri managed state)。`ssh_connect_test`
//! 探针成功后把已认证的 Handle 存入池,fs/git 等后续操作复用;连接被
//! keepalive 判死后操作报错,用户重新打开工作区即可重建。

use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use russh::client::Handle;
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;

use super::client::{self, ClientHandler};
use super::profiles::SshProfile;
use crate::modules::fs::wsl_ops::{WslDirEntry, WslFileStat};

/// 单次远端操作超时。
const REMOTE_OP_TIMEOUT: Duration = Duration::from_secs(30);
/// 安装(推送二进制)超时。
const INSTALL_TIMEOUT: Duration = Duration::from_secs(60);

type SharedHandle = Arc<tokio::sync::Mutex<Handle<ClientHandler>>>;

/// 每档案一条持久 russh 连接。终端会话持有各自独立的连接,本池专供
/// fs/git 等非终端操作复用。
#[derive(Default)]
pub struct SshConnectionPool {
    // 连接注册表存于静态镜像(cell):同步命令上下文无需经过 state 实例。
}

/// 全局连接池(键:profile id)。静态镜像让同步命令也能取到连接。
pub fn global_pool() -> &'static SshConnectionPool {
    static POOL: OnceLock<SshConnectionPool> = OnceLock::new();
    POOL.get_or_init(SshConnectionPool::default)
}

impl SshConnectionPool {
    fn cell() -> &'static Mutex<std::collections::HashMap<String, SharedHandle>> {
        static POOL: OnceLock<Mutex<std::collections::HashMap<String, SharedHandle>>> =
            OnceLock::new();
        POOL.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
    }

    /// 池本体是 managed state 的字段;静态镜像让同步命令也能够到连接。
    /// 键为 profile id;重复存入以新连接为准。
    fn mirror_insert(&self, profile_id: &str, handle: SharedHandle) {
        if let Ok(mut pool) = Self::cell().lock() {
            pool.insert(profile_id.to_string(), handle);
        }
    }

    pub(crate) fn store(&self, profile_id: &str, handle: Handle<ClientHandler>) {
        self.mirror_insert(profile_id, Arc::new(tokio::sync::Mutex::new(handle)));
    }

    fn get(&self, profile_id: &str) -> Option<SharedHandle> {
        Self::cell().lock().ok()?.get(profile_id).cloned()
    }

    /// 探针成功后调用:认证完成的 Handle 入池。
    pub async fn connect_and_store(
        &self,
        profile: &SshProfile,
        secret: Option<&str>,
        known_hosts: PathBuf,
    ) -> Result<(), String> {
        let connection = client::connect(profile, secret, known_hosts).await?;
        self.store(&profile.id, connection.handle);
        Ok(())
    }

    fn evict(&self, profile_id: &str) {
        if let Ok(mut pool) = Self::cell().lock() {
            pool.remove(profile_id);
        }
    }
}

/// 远端 agent 固定安装路径(版本 + 宿主架构进文件名,升级自然换代)。
fn remote_agent_path(version: &str) -> String {
    format!(
        "$HOME/.cache/nexterm/agent/nexterm-agent-{version}-{}",
        std::env::consts::ARCH
    )
}

/// 确保远端已安装当前版本 agent,返回可执行路径。
pub(crate) async fn ensure_remote_agent(handle: &mut Handle<ClientHandler>) -> Result<String, String> {
    let bytes = agent_install::asset_bytes()?;
    let path = remote_agent_path(agent_install::agent_version());

    // 存在且可执行且大小一致则跳过推送。
    let probe = client::exec_simple(
        handle,
        &format!(
            "test -x {path} && test \"$(stat -c %s {path} 2>/dev/null || echo 0)\" -eq {}",
            bytes.len()
        ),
        Duration::from_secs(10),
    )
    .await;
    if probe.ok().map(|output| output.exit_code == Some(0)).unwrap_or(false) {
        return Ok(path);
    }

    push_agent_binary(handle, &path, &bytes).await?;
    Ok(path)
}

/// 管道推送二进制:exec `mkdir && cat > path && chmod`,stdin 写入内容。
async fn push_agent_binary(
    handle: &mut Handle<ClientHandler>,
    path: &str,
    bytes: &[u8],
) -> Result<(), String> {
    use russh::ChannelMsg;

    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|error| format!("open install channel: {error}"))?;
    channel
        .exec(
            true,
            format!("mkdir -p \"$(dirname {path})\" && cat > {path} && chmod 755 {path}"),
        )
        .await
        .map_err(|error| format!("exec install script: {error}"))?;
    {
        let mut writer = channel.make_writer();
        use tokio::io::AsyncWriteExt;
        writer
            .write_all(bytes)
            .await
            .map_err(|error| format!("push agent binary: {error}"))?;
        writer.flush().await.ok();
    } // drop writer → stdin EOF

    let mut stderr = Vec::new();
    let wait = tokio::time::timeout(INSTALL_TIMEOUT, async {
        loop {
            match channel.wait().await {
                Some(ChannelMsg::ExtendedData { ref data, .. }) => stderr.extend_from_slice(data),
                Some(ChannelMsg::Close) | None => break,
                Some(_) => {}
            }
        }
    })
    .await;
    if wait.is_err() {
        return Err(format!("remote agent install timed out after {INSTALL_TIMEOUT:?}"));
    }
    if !stderr.is_empty() {
        return Err(format!(
            "remote agent install failed: {}",
            String::from_utf8_lossy(&stderr).trim()
        ));
    }
    log::info!("pushed nexterm-agent to remote: {path}");
    Ok(())
}

/// 执行一次 `nexterm-agent once`:stdin 送请求行,stdout 收响应行。
pub(crate) async fn agent_once(
    handle: &mut Handle<ClientHandler>,
    agent_path: &str,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    use russh::ChannelMsg;

    let request = json!({ "id": 1, "method": method, "params": params });
    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|error| format!("open ssh channel: {error}"))?;
    channel
        .exec(true, format!("{agent_path} once"))
        .await
        .map_err(|error| format!("exec {agent_path} once: {error}"))?;
    {
        let mut writer = channel.make_writer();
        writer
            .write_all(request.to_string().as_bytes())
            .await
            .map_err(|error| format!("write agent request: {error}"))?;
        writer.write_all(b"\n").await.ok();
        writer.flush().await.ok();
    } // stdin EOF → agent 处理并退出

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let wait = tokio::time::timeout(REMOTE_OP_TIMEOUT, async {
        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { ref data }) => stdout.extend_from_slice(data),
                Some(ChannelMsg::ExtendedData { ref data, .. }) => stderr.extend_from_slice(data),
                Some(ChannelMsg::Close) | None => break,
                Some(_) => {}
            }
        }
    })
    .await;
    if wait.is_err() {
        return Err(format!("remote agent {method}: timed out after {REMOTE_OP_TIMEOUT:?}"));
    }
    if stdout.is_empty() {
        let message = String::from_utf8_lossy(&stderr);
        return Err(format!(
            "remote agent produced no response: {}",
            message.trim().chars().take(160).collect::<String>()
        ));
    }
    let line = String::from_utf8_lossy(&stdout);
    match crate::modules::agent::protocol::parse_line(line.trim()) {
        crate::modules::agent::protocol::ParsedLine::Response(incoming) => {
            if incoming.ok {
                incoming
                    .result
                    .ok_or_else(|| "agent response missing result".to_string())
            } else {
                Err(incoming.error.unwrap_or_else(|| "unknown agent error".into()))
            }
        }
        _ => Err(format!(
            "unexpected agent output: {}",
            line.trim().chars().take(120).collect::<String>()
        )),
    }
}

/// 带池化连接的远端操作入口:解析 workspace → 连接 → 确认 agent → 执行。
pub(crate) async fn with_remote_agent<T>(
    pool: &SshConnectionPool,
    profile_id: &str,
    method: &str,
    params: Value,
    parse: impl Fn(Value) -> Result<T, String>,
) -> Result<T, String> {
    let handle = pool.get(profile_id).ok_or_else(|| {
        "ssh workspace is not connected; reopen the workspace to reconnect".to_string()
    })?;
    let mut guard = handle.lock().await;
    let agent_path = ensure_remote_agent(&mut guard).await?;
    let value = match agent_once(&mut guard, &agent_path, method, params).await {
        Ok(value) => value,
        Err(error) => {
            // 连接死亡(keepalive 超时等)时驱逐,下次重开工作区重建。
            if error.contains("timed out") || error.contains("ssh channel") {
                pool.evict(profile_id);
            }
            return Err(error);
        }
    };
    parse(value)
}

pub(crate) async fn remote_read_dir(
    pool: &SshConnectionPool,
    profile_id: &str,
    path: &str,
) -> Result<Vec<WslDirEntry>, String> {
    with_remote_agent(pool, profile_id, "fs.readDir", json!({ "path": path }), |value| {
        crate::modules::agent::parse_dir_entries(&value)
    })
    .await
}

pub(crate) async fn remote_stat(
    pool: &SshConnectionPool,
    profile_id: &str,
    path: &str,
) -> Result<WslFileStat, String> {
    with_remote_agent(pool, profile_id, "fs.stat", json!({ "path": path }), |value| {
        crate::modules::agent::parse_stat(&value)
    })
    .await
}

pub(crate) async fn remote_read_file(
    pool: &SshConnectionPool,
    profile_id: &str,
    path: &str,
) -> Result<Vec<u8>, String> {
    with_remote_agent(pool, profile_id, "fs.readFile", json!({ "path": path }), |value| {
        crate::modules::agent::parse_file_bytes(&value)
    })
    .await
}

/// 远端 git 执行:经 agent `exec` 跑 git(与 WSL 侧相同的 argv 形状)。
pub(crate) async fn remote_git_exec(
    pool: &SshConnectionPool,
    profile_id: &str,
    cwd: Option<&str>,
    argv: &[String],
    env: &[(&str, &str)],
    timeout: Duration,
    max_output_bytes: usize,
) -> Result<crate::modules::agent::ExecOutcome, String> {
    let handle = pool.get(profile_id).ok_or_else(|| {
        "ssh workspace is not connected; reopen the workspace to reconnect".to_string()
    })?;
    let mut guard = handle.lock().await;
    let agent_path = ensure_remote_agent(&mut guard).await?;

    let mut env_map = serde_json::Map::new();
    for (key, value) in env {
        env_map.insert((*key).to_string(), Value::String((*value).to_string()));
    }
    let params = json!({
        "argv": argv,
        "cwd": cwd,
        "env": Value::Object(env_map),
        "timeoutMs": timeout.as_millis() as u64,
        "maxOutputBytes": max_output_bytes,
    });
    let value = with_timeout_guard(agent_once(&mut guard, &agent_path, "exec", params), timeout).await?;
    crate::modules::agent::parse_exec_outcome(&value)
}

async fn with_timeout_guard<T>(
    future: impl std::future::Future<Output = Result<T, String>>,
    timeout: Duration,
) -> Result<T, String> {
    match tokio::time::timeout(timeout + Duration::from_secs(5), future).await {
        Ok(result) => result,
        Err(_) => Err(format!("remote exec timed out after {timeout:?}")),
    }
}

use crate::modules::agent::install as agent_install;
// ---- Phase 0b/2:远端写操作与 search 家族 ----
// 解析复用 modules/agent 的共享函数;返回值即宿主命令要回给前端的形状。

pub(crate) async fn remote_create_file(
    pool: &SshConnectionPool,
    profile_id: &str,
    path: &str,
) -> Result<(), String> {
    with_remote_agent(pool, profile_id, "fs.createFile", json!({ "path": path }), |_| Ok(()))
        .await
}

pub(crate) async fn remote_create_dir(
    pool: &SshConnectionPool,
    profile_id: &str,
    path: &str,
) -> Result<(), String> {
    with_remote_agent(pool, profile_id, "fs.createDir", json!({ "path": path }), |_| Ok(()))
        .await
}

pub(crate) async fn remote_delete(
    pool: &SshConnectionPool,
    profile_id: &str,
    path: &str,
) -> Result<(), String> {
    with_remote_agent(pool, profile_id, "fs.delete", json!({ "path": path }), |_| Ok(()))
        .await
}

pub(crate) async fn remote_rename(
    pool: &SshConnectionPool,
    profile_id: &str,
    from: &str,
    to: &str,
) -> Result<(), String> {
    with_remote_agent(pool, profile_id, "fs.rename", json!({ "from": from, "to": to }), |_| {
        Ok(())
    })
    .await
}

pub(crate) async fn remote_copy(
    pool: &SshConnectionPool,
    profile_id: &str,
    from: &str,
    to: &str,
) -> Result<(), String> {
    with_remote_agent(pool, profile_id, "fs.copy", json!({ "from": from, "to": to }), |_| {
        Ok(())
    })
    .await
}

pub(crate) async fn remote_write_file(
    pool: &SshConnectionPool,
    profile_id: &str,
    path: &str,
    content_base64: &str,
) -> Result<(), String> {
    with_remote_agent(
        pool,
        profile_id,
        "fs.writeFile",
        json!({ "path": path, "contentBase64": content_base64 }),
        |_| Ok(()),
    )
    .await
}

pub(crate) async fn remote_search(
    pool: &SshConnectionPool,
    profile_id: &str,
    root: &str,
    query: &str,
    limit: Option<usize>,
    show_hidden: bool,
    root_display: &str,
) -> Result<crate::modules::agent::SearchResultParsed, String> {
    with_remote_agent(
        pool,
        profile_id,
        "fs.search",
        json!({
            "root": root,
            "query": query,
            "limit": limit,
            "showHidden": show_hidden,
            "rootDisplay": root_display,
        }),
        |value| crate::modules::agent::parse_search_result(&value),
    )
    .await
}

pub(crate) async fn remote_list_files(
    pool: &SshConnectionPool,
    profile_id: &str,
    root: &str,
    limit: Option<usize>,
    max_depth: Option<usize>,
    show_hidden: bool,
) -> Result<(Vec<String>, bool), String> {
    with_remote_agent(
        pool,
        profile_id,
        "fs.listFiles",
        json!({
            "root": root,
            "limit": limit,
            "maxDepth": max_depth,
            "showHidden": show_hidden,
        }),
        |value| crate::modules::agent::parse_list_files(&value),
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn remote_grep(
    pool: &SshConnectionPool,
    profile_id: &str,
    pattern: &str,
    root: &str,
    glob: Option<Vec<String>>,
    case_insensitive: bool,
    max_results: Option<usize>,
    root_display: &str,
) -> Result<crate::modules::agent::GrepResponseParsed, String> {
    with_remote_agent(
        pool,
        profile_id,
        "fs.grep",
        json!({
            "pattern": pattern,
            "root": root,
            "glob": glob,
            "caseInsensitive": case_insensitive,
            "maxResults": max_results,
            "rootDisplay": root_display,
        }),
        |value| crate::modules::agent::parse_grep_response(&value),
    )
    .await
}

pub(crate) async fn remote_glob(
    pool: &SshConnectionPool,
    profile_id: &str,
    pattern: &str,
    root: &str,
    max_results: Option<usize>,
    root_display: &str,
) -> Result<(Vec<crate::modules::agent::GlobHitParsed>, bool), String> {
    with_remote_agent(
        pool,
        profile_id,
        "fs.glob",
        json!({
            "pattern": pattern,
            "root": root,
            "maxResults": max_results,
            "rootDisplay": root_display,
        }),
        |value| crate::modules::agent::parse_glob(&value),
    )
    .await
}
