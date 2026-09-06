//! Phase 2:SSH 远端执行层 —— 在 SSH 连接上安装并调用 nexterm-agent。
//!
//! 传输形态:每操作一个 exec 通道(`nexterm-agent once`,请求经 stdin、
//! 响应经 stdout)。russh 的 TCP 连接本身持久,开通道成本远低于重新握手;
//! 持久 serve 通道的复用属后续优化,协议不变。
//!
//! 连接池:进程级静态 cell(键:profile id),不是 Tauri managed state ——
//! 同步上下文与异步命令都能取到连接。`ssh_connect_test` 探针成功后把已
//! 认证的 Handle 存入池,fs/git 等后续操作复用;通道/超时类失败按错误
//! 类别驱逐连接,用户重新打开工作区即可重建。
//!
//! agent 探针缓存:已验证的 agent 安装路径按 profile id 缓存,省掉每次
//! 操作前的 `test -x && stat` 往返。路径含版本号与架构,版本升级自然失效;
//! 连接被替换或驱逐时同步清掉对应缓存。

use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use russh::client::Handle;
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;

use super::client::{self, ClientHandler};
use crate::modules::agent::install as agent_install;
use crate::modules::agent::protocol;
use crate::modules::fs::wsl_ops::{WslDirEntry, WslFileStat};
use crate::modules::lock::mutex_lock;

/// 单次远端操作超时。
const REMOTE_OP_TIMEOUT: Duration = Duration::from_secs(30);
/// 安装(推送二进制)超时。
const INSTALL_TIMEOUT: Duration = Duration::from_secs(60);

type SharedHandle = Arc<tokio::sync::Mutex<Handle<ClientHandler>>>;

/// 远端失败的类别:决定 [`with_remote_agent`] 是否应驱逐池化连接。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RemoteFailure {
    /// SSH 通道打开/写入失败 —— 连接大概率已死,应驱逐。
    Channel,
    /// 操作超时 —— 连接可能已被 keepalive 判死而成"假活",应驱逐。
    Timeout,
    /// agent 协议/业务层失败 —— 传输层仍健康,保留连接。
    Other,
}

impl RemoteFailure {
    /// 该类别是否应驱逐连接。
    fn should_evict(self) -> bool {
        matches!(self, Self::Channel | Self::Timeout)
    }
}

/// 携带类别的远端错误:[`Display`](fmt::Display) 即原始文案,对外错误
/// 信息不丢失任何细节;类别只在连接池内部参与驱逐决策。
#[derive(Debug)]
pub(crate) struct RemoteError {
    failure: RemoteFailure,
    message: String,
}

impl RemoteError {
    pub(crate) fn channel(message: impl Into<String>) -> Self {
        Self {
            failure: RemoteFailure::Channel,
            message: message.into(),
        }
    }

    pub(crate) fn timeout(message: impl Into<String>) -> Self {
        Self {
            failure: RemoteFailure::Timeout,
            message: message.into(),
        }
    }

    pub(crate) fn other(message: impl Into<String>) -> Self {
        Self {
            failure: RemoteFailure::Other,
            message: message.into(),
        }
    }

    /// 该错误是否应驱逐连接。
    fn should_evict(&self) -> bool {
        self.failure.should_evict()
    }
}

impl fmt::Display for RemoteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

/// `?` 到 `String` 错误通道的自动降级:调用方只关心文案时无需逐处 map_err。
impl From<RemoteError> for String {
    fn from(error: RemoteError) -> Self {
        error.message
    }
}

/// 全局连接池静态 cell(键:profile id)。每档案一条持久 russh 连接,
/// 终端会话持有各自独立的连接,本池专供 fs/git 等非终端操作复用。
fn pool_cell() -> &'static Mutex<HashMap<String, SharedHandle>> {
    static POOL: OnceLock<Mutex<HashMap<String, SharedHandle>>> = OnceLock::new();
    POOL.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 已验证 agent 安装路径缓存(键:profile id,值:带版本号的远端路径)。
fn agent_path_cache() -> &'static Mutex<HashMap<String, String>> {
    static CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 当前版本的 agent 期望安装路径。
fn current_agent_path() -> String {
    remote_agent_path(agent_install::agent_version())
}

fn cache_agent_path(profile_id: &str, path: &str) {
    match mutex_lock(agent_path_cache(), "ssh agent path cache") {
        Ok(mut cache) => {
            cache.insert(profile_id.to_string(), path.to_string());
        }
        Err(error) => log::warn!("{error}"),
    }
}

fn clear_agent_cache(profile_id: &str) {
    if let Ok(mut cache) = agent_path_cache().lock() {
        cache.remove(profile_id);
    }
}

/// 命中条件:缓存的路径与当前版本期望路径一致。agent 路径含版本号与
/// 架构,版本换代后旧缓存自动不命中。
fn cached_agent_path(profile_id: &str) -> Option<String> {
    let cache = match mutex_lock(agent_path_cache(), "ssh agent path cache") {
        Ok(cache) => cache,
        Err(error) => {
            log::warn!("{error}");
            return None;
        }
    };
    let expected = current_agent_path();
    cache
        .get(profile_id)
        .filter(|cached| cached.as_str() == expected)
        .cloned()
}

/// 探针成功后调用:认证完成的 Handle 入池。重复存入以新连接为准,
/// 同时失效 agent 路径缓存(新连接可能指向另一台主机)。
pub(crate) fn store_connection(profile_id: &str, handle: Handle<ClientHandler>) {
    match mutex_lock(pool_cell(), "ssh connection pool") {
        Ok(mut pool) => {
            pool.insert(
                profile_id.to_string(),
                Arc::new(tokio::sync::Mutex::new(handle)),
            );
        }
        Err(error) => log::warn!("{error}"),
    }
    clear_agent_cache(profile_id);
}

/// 取池化连接;锁中毒按未连接处理(调用方会提示重开工作区)。
fn get_connection(profile_id: &str) -> Option<SharedHandle> {
    match mutex_lock(pool_cell(), "ssh connection pool") {
        Ok(pool) => pool.get(profile_id).cloned(),
        Err(error) => {
            log::warn!("{error}");
            None
        }
    }
}

/// 连接死亡(keepalive 超时等)时驱逐,下次重开工作区重建。
fn evict_connection(profile_id: &str) {
    match mutex_lock(pool_cell(), "ssh connection pool") {
        Ok(mut pool) => {
            pool.remove(profile_id);
        }
        Err(error) => log::warn!("{error}"),
    }
    clear_agent_cache(profile_id);
}

/// 远端 agent 固定安装路径(版本 + 宿主架构进文件名,升级自然换代)。
fn remote_agent_path(version: &str) -> String {
    format!(
        "$HOME/.cache/nexterm/agent/nexterm-agent-{version}-{}",
        std::env::consts::ARCH
    )
}

/// agent 存在性探针命令:存在、可执行且字节数与宿主内嵌资产一致才免推送。
fn agent_probe_command(path: &str, byte_len: usize) -> String {
    format!(
        "test -x {path} && test \"$(stat -c %s {path} 2>/dev/null || echo 0)\" -eq {byte_len}"
    )
}

/// 确保远端已安装当前版本 agent,返回可执行路径。
/// 已验证路径按 profile id 缓存,跳过重复的 `test -x && stat` 往返。
pub(crate) async fn ensure_remote_agent(
    profile_id: &str,
    handle: &mut Handle<ClientHandler>,
) -> Result<String, RemoteError> {
    if let Some(path) = cached_agent_path(profile_id) {
        return Ok(path);
    }

    let bytes = agent_install::asset_bytes().map_err(RemoteError::other)?;
    let path = current_agent_path();

    // 存在且可执行且大小一致则跳过推送。
    let probe = client::exec_simple(
        handle,
        &agent_probe_command(&path, bytes.len()),
        Duration::from_secs(10),
    )
    .await;
    if probe
        .ok()
        .map(|output| output.exit_code == Some(0))
        .unwrap_or(false)
    {
        cache_agent_path(profile_id, &path);
        return Ok(path);
    }

    push_agent_binary(handle, &path, &bytes).await?;
    cache_agent_path(profile_id, &path);
    Ok(path)
}

/// 管道推送二进制:exec `mkdir && cat > path && chmod`,stdin 写入内容。
async fn push_agent_binary(
    handle: &mut Handle<ClientHandler>,
    path: &str,
    bytes: &[u8],
) -> Result<(), RemoteError> {
    use russh::ChannelMsg;

    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|error| RemoteError::channel(format!("open install channel: {error}")))?;
    channel
        .exec(
            true,
            format!("mkdir -p \"$(dirname {path})\" && cat > {path} && chmod 755 {path}"),
        )
        .await
        .map_err(|error| RemoteError::channel(format!("exec install script: {error}")))?;
    {
        let mut writer = channel.make_writer();
        writer
            .write_all(bytes)
            .await
            .map_err(|error| RemoteError::channel(format!("push agent binary: {error}")))?;
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
        return Err(RemoteError::timeout(format!(
            "remote agent install timed out after {INSTALL_TIMEOUT:?}"
        )));
    }
    if !stderr.is_empty() {
        return Err(RemoteError::other(format!(
            "remote agent install failed: {}",
            String::from_utf8_lossy(&stderr).trim()
        )));
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
) -> Result<Value, RemoteError> {
    use russh::ChannelMsg;

    let request = json!({ "id": 1, "method": method, "params": params });
    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|error| RemoteError::channel(format!("open ssh channel: {error}")))?;
    channel
        .exec(true, format!("{agent_path} once"))
        .await
        .map_err(|error| RemoteError::channel(format!("exec {agent_path} once: {error}")))?;
    {
        let mut writer = channel.make_writer();
        writer
            .write_all(request.to_string().as_bytes())
            .await
            .map_err(|error| RemoteError::channel(format!("write agent request: {error}")))?;
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
        return Err(RemoteError::timeout(format!(
            "remote agent {method}: timed out after {REMOTE_OP_TIMEOUT:?}"
        )));
    }
    if stdout.is_empty() {
        let message = String::from_utf8_lossy(&stderr);
        return Err(RemoteError::other(format!(
            "remote agent produced no response: {}",
            message.trim().chars().take(160).collect::<String>()
        )));
    }
    let line = String::from_utf8_lossy(&stdout);
    match crate::modules::agent::protocol::parse_line(line.trim()) {
        crate::modules::agent::protocol::ParsedLine::Response(incoming) => {
            if incoming.ok {
                incoming
                    .result
                    .ok_or_else(|| RemoteError::other("agent response missing result"))
            } else {
                Err(RemoteError::other(
                    incoming
                        .error
                        .unwrap_or_else(|| "unknown agent error".into()),
                ))
            }
        }
        _ => Err(RemoteError::other(format!(
            "unexpected agent output: {}",
            line.trim().chars().take(120).collect::<String>()
        ))),
    }
}

/// 带池化连接的远端操作入口:取连接 → 确认 agent → 执行。
/// 通道/超时类失败驱逐连接(并失效 agent 缓存);agent 业务错误保留连接。
pub(crate) async fn with_remote_agent<T>(
    profile_id: &str,
    method: &str,
    params: Value,
    parse: impl Fn(Value) -> Result<T, String>,
) -> Result<T, String> {
    let handle = get_connection(profile_id).ok_or_else(|| {
        "ssh workspace is not connected; reopen the workspace to reconnect".to_string()
    })?;
    let mut guard = handle.lock().await;
    let value = match ensure_remote_agent(profile_id, &mut guard).await {
        Ok(agent_path) => agent_once(&mut guard, &agent_path, method, params).await,
        Err(error) => Err(error),
    };
    match value {
        Ok(value) => parse(value),
        Err(error) => {
            if error.should_evict() {
                evict_connection(profile_id);
            }
            Err(error.into())
        }
    }
}

pub(crate) async fn remote_read_dir(
    profile_id: &str,
    path: &str,
) -> Result<Vec<WslDirEntry>, String> {
    with_remote_agent(
        profile_id,
        protocol::METHOD_FS_READ_DIR,
        protocol::fs_read_dir_params(path),
        |value| crate::modules::agent::parse_dir_entries(&value),
    )
    .await
}

pub(crate) async fn remote_stat(
    profile_id: &str,
    path: &str,
) -> Result<WslFileStat, String> {
    with_remote_agent(
        profile_id,
        protocol::METHOD_FS_STAT,
        protocol::fs_stat_params(path),
        |value| crate::modules::agent::parse_stat(&value),
    )
    .await
}

pub(crate) async fn remote_read_file(
    profile_id: &str,
    path: &str,
) -> Result<Vec<u8>, String> {
    with_remote_agent(
        profile_id,
        protocol::METHOD_FS_READ_FILE,
        protocol::fs_read_file_params(path),
        |value| crate::modules::agent::parse_file_bytes(&value),
    )
    .await
}

/// 远端 git 执行:经 agent `exec` 跑 git(与 WSL 侧相同的 argv 形状)。
pub(crate) async fn remote_git_exec(
    profile_id: &str,
    cwd: Option<&str>,
    argv: &[String],
    env: &[(&str, &str)],
    timeout: Duration,
    max_output_bytes: usize,
) -> Result<crate::modules::agent::ExecOutcome, String> {
    let handle = get_connection(profile_id).ok_or_else(|| {
        "ssh workspace is not connected; reopen the workspace to reconnect".to_string()
    })?;
    let mut guard = handle.lock().await;

    // stdin=None:SSH git 桥不需要 stdin,协议层会省略 stdinBase64 字段。
    let params = protocol::exec_params(cwd, argv, env, None, timeout, max_output_bytes);
    let outcome = async {
        let agent_path = ensure_remote_agent(profile_id, &mut guard).await?;
        with_timeout_guard(
            agent_once(&mut guard, &agent_path, protocol::METHOD_EXEC, params),
            timeout,
        )
        .await
    }
    .await;
    match outcome {
        Ok(value) => crate::modules::agent::parse_exec_outcome(&value),
        Err(error) => {
            // 与 with_remote_agent 一致:通道/超时类失败驱逐死连接。
            if error.should_evict() {
                evict_connection(profile_id);
            }
            Err(error.into())
        }
    }
}

async fn with_timeout_guard<T>(
    future: impl std::future::Future<Output = Result<T, RemoteError>>,
    timeout: Duration,
) -> Result<T, RemoteError> {
    match tokio::time::timeout(timeout + Duration::from_secs(5), future).await {
        Ok(result) => result,
        Err(_) => Err(RemoteError::timeout(format!(
            "remote exec timed out after {timeout:?}"
        ))),
    }
}

// ---- Phase 0b/2:远端写操作与 search 家族 ----
// 解析复用 modules/agent 的共享函数;返回值即宿主命令要回给前端的形状。

pub(crate) async fn remote_create_file(
    profile_id: &str,
    path: &str,
) -> Result<(), String> {
    with_remote_agent(
        profile_id,
        protocol::METHOD_FS_CREATE_FILE,
        protocol::fs_create_file_params(path),
        |_| Ok(()),
    )
    .await
}

pub(crate) async fn remote_create_dir(
    profile_id: &str,
    path: &str,
) -> Result<(), String> {
    with_remote_agent(
        profile_id,
        protocol::METHOD_FS_CREATE_DIR,
        protocol::fs_create_dir_params(path),
        |_| Ok(()),
    )
    .await
}

pub(crate) async fn remote_delete(profile_id: &str, path: &str) -> Result<(), String> {
    with_remote_agent(
        profile_id,
        protocol::METHOD_FS_DELETE,
        protocol::fs_delete_params(path),
        |_| Ok(()),
    )
    .await
}

pub(crate) async fn remote_rename(
    profile_id: &str,
    from: &str,
    to: &str,
) -> Result<(), String> {
    with_remote_agent(
        profile_id,
        protocol::METHOD_FS_RENAME,
        protocol::fs_rename_params(from, to),
        |_| Ok(()),
    )
    .await
}

pub(crate) async fn remote_copy(profile_id: &str, from: &str, to: &str) -> Result<(), String> {
    with_remote_agent(
        profile_id,
        protocol::METHOD_FS_COPY,
        protocol::fs_copy_params(from, to),
        |_| Ok(()),
    )
    .await
}

pub(crate) async fn remote_write_file(
    profile_id: &str,
    path: &str,
    content_base64: &str,
) -> Result<(), String> {
    with_remote_agent(
        profile_id,
        protocol::METHOD_FS_WRITE_FILE,
        protocol::fs_write_file_params(path, content_base64),
        |_| Ok(()),
    )
    .await
}

pub(crate) async fn remote_search(
    profile_id: &str,
    root: &str,
    query: &str,
    limit: Option<usize>,
    show_hidden: bool,
    root_display: &str,
) -> Result<crate::modules::agent::SearchResultParsed, String> {
    with_remote_agent(
        profile_id,
        protocol::METHOD_FS_SEARCH,
        protocol::fs_search_params(root, query, limit, show_hidden, root_display),
        |value| crate::modules::agent::parse_search_result(&value),
    )
    .await
}

pub(crate) async fn remote_list_files(
    profile_id: &str,
    root: &str,
    limit: Option<usize>,
    max_depth: Option<usize>,
    show_hidden: bool,
) -> Result<(Vec<String>, bool), String> {
    with_remote_agent(
        profile_id,
        protocol::METHOD_FS_LIST_FILES,
        protocol::fs_list_files_params(root, limit, max_depth, show_hidden),
        |value| crate::modules::agent::parse_list_files(&value),
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn remote_grep(
    profile_id: &str,
    pattern: &str,
    root: &str,
    glob: Option<Vec<String>>,
    case_insensitive: bool,
    max_results: Option<usize>,
    root_display: &str,
) -> Result<crate::modules::agent::GrepResponseParsed, String> {
    with_remote_agent(
        profile_id,
        protocol::METHOD_FS_GREP,
        protocol::fs_grep_params(
            pattern,
            root,
            glob.as_deref(),
            case_insensitive,
            max_results,
            root_display,
        ),
        |value| crate::modules::agent::parse_grep_response(&value),
    )
    .await
}

pub(crate) async fn remote_glob(
    profile_id: &str,
    pattern: &str,
    root: &str,
    max_results: Option<usize>,
    root_display: &str,
) -> Result<(Vec<crate::modules::agent::GlobHitParsed>, bool), String> {
    with_remote_agent(
        profile_id,
        protocol::METHOD_FS_GLOB,
        protocol::fs_glob_params(pattern, root, max_results, root_display),
        |value| crate::modules::agent::parse_glob(&value),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_agent_path_embeds_version_and_arch() {
        let path = remote_agent_path("0.1.2");
        assert!(path.starts_with("$HOME/.cache/nexterm/agent/nexterm-agent-0.1.2-"));
        assert!(path.contains(std::env::consts::ARCH));
    }

    #[test]
    fn probe_command_checks_exec_bit_and_byte_size() {
        let cmd = agent_probe_command(
            "/home/u/.cache/nexterm/agent/nexterm-agent-0.1.2-x86_64",
            1024,
        );
        assert!(cmd.starts_with(
            "test -x /home/u/.cache/nexterm/agent/nexterm-agent-0.1.2-x86_64"
        ));
        assert!(cmd.contains("stat -c %s"));
        assert!(cmd.ends_with("-eq 1024"));
    }

    #[test]
    fn channel_and_timeout_failures_request_eviction_but_agent_errors_do_not() {
        assert!(RemoteError::channel("open ssh channel: disconnected").should_evict());
        assert!(RemoteError::timeout("remote agent fs.readDir: timed out after 30s")
            .should_evict());
        assert!(!RemoteError::other("unknown agent error").should_evict());
    }

    #[test]
    fn remote_error_display_keeps_original_message() {
        let error = RemoteError::timeout("remote agent exec: timed out after 30s");
        assert_eq!(error.to_string(), "remote agent exec: timed out after 30s");
        let as_string: String = error.into();
        assert_eq!(as_string, "remote agent exec: timed out after 30s");
    }

    #[test]
    fn agent_path_cache_is_per_profile_and_version_sensitive() {
        // 带 pid 后缀的唯一键,避免并行测试互踩同一个静态缓存。
        let profile_id = format!("cache-test-{}", std::process::id());
        let expected = current_agent_path();

        assert_eq!(cached_agent_path(&profile_id), None);
        // 与当前版本期望路径不一致 → 视为版本换代,不命中。
        cache_agent_path(&profile_id, "stale-version-path");
        assert_eq!(cached_agent_path(&profile_id), None);
        cache_agent_path(&profile_id, &expected);
        assert_eq!(cached_agent_path(&profile_id).as_deref(), Some(expected.as_str()));
        clear_agent_cache(&profile_id);
        assert_eq!(cached_agent_path(&profile_id), None);
    }
}
