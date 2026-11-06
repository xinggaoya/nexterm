//! 性能录制会话：会话配置、报告落盘、后端命令耗时。
//!
//! ## 录制态开关
//!
//! 默认**关闭**。只有满足下列任一条件才进入录制态：
//! - 环境变量 `NEXTERM_PERF_DIR=<目录>`；
//! - 命令行参数 `--perf-dir=<目录>`（让"已安装的 exe"也能直接开录）。
//!
//! 关闭时本模块的三个命令只返回 `enabled: false` / 报错，前端不做任何
//! 采集，生产行为与之前完全一致。
//!
//! ## 安全边界
//!
//! `perf_write_report` 是 webview 可达的写文件 IPC，必须收口：
//! - 只有配置了会话目录时才可用；
//! - 文件名走白名单（`frontend` / `backend`），不接受任意路径；
//! - 内容有大小上限，避免被当成任意写 + 撑爆磁盘的通道。
//!
//! 目录路径本身不会回传给 webview（`perf_config` 只回 `sessionId`），
//! 避免把宿主机目录结构暴露给前端。

pub mod recorder;

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;

use recorder::CommandStat;

/// 环境变量：性能报告输出目录。
pub const PERF_DIR_ENV: &str = "NEXTERM_PERF_DIR";
/// 命令行参数前缀：性能报告输出目录。
pub const PERF_DIR_ARG: &str = "--perf-dir=";

/// 报告类型 → 文件名白名单。
const REPORT_FILE_NAMES: [(&str, &str); 2] = [
    ("frontend", "frontend.json"),
    ("backend", "backend.json"),
];

/// 单份报告的最大字节数（16MB）。
const MAX_REPORT_BYTES: usize = 16 * 1024 * 1024;

/// 报告 schema 版本，与前端 `perfTypes.ts` 对齐。
pub const PERF_SCHEMA: &str = "nexterm-perf/1";

/// 前端拿到的录制配置。**不含目录路径**。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfConfig {
    pub enabled: bool,
    pub session_id: String,
}

/// 后端运行时信息。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub os: String,
    pub arch: String,
}

/// 后端命令耗时快照（前端落盘为 `backend.json`）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendSnapshot {
    pub schema: &'static str,
    pub kind: &'static str,
    pub session_id: String,
    pub started_at_ms: u64,
    pub ended_at_ms: u64,
    pub app: AppInfo,
    pub commands: Vec<CommandStat>,
    pub slowest: Vec<CommandStat>,
    pub total_recorded_ms: f64,
}

/// 录制会话状态（由 Tauri `manage` 注入）。
pub struct PerfSession {
    pub session_id: String,
    pub output_dir: Option<PathBuf>,
    pub started_at_ms: u64,
}

impl PerfSession {
    /// 探测录制态：环境变量优先，其次命令行参数。
    pub fn detect() -> Self {
        let output_dir = resolve_output_dir();
        let session_id = output_dir
            .as_ref()
            .and_then(|dir| dir.file_name())
            .and_then(|name| name.to_str())
            .unwrap_or("inactive")
            .to_string();
        recorder::set_enabled(output_dir.is_some());
        Self {
            session_id,
            output_dir,
            started_at_ms: recorder::now_ms(),
        }
    }
}

fn resolve_output_dir() -> Option<PathBuf> {
    let raw = std::env::var(PERF_DIR_ENV).ok().or_else(|| {
        std::env::args()
            .skip(1)
            .find_map(|arg| arg.strip_prefix(PERF_DIR_ARG).map(|value| value.to_string()))
    })?;
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let path = PathBuf::from(raw);
    if std::fs::create_dir_all(&path).is_err() {
        return None;
    }
    Some(path)
}

/// 录制态配置。
#[tauri::command]
pub fn perf_config(session: State<'_, PerfSession>) -> PerfConfig {
    PerfConfig {
        enabled: session.output_dir.is_some(),
        session_id: session.session_id.clone(),
    }
}

/// 把一份报告写进会话目录。文件名由白名单决定，不接受任意路径。
#[tauri::command]
pub fn perf_write_report(
    session: State<'_, PerfSession>,
    kind: String,
    content: String,
) -> Result<String, String> {
    write_report_into(&session, &kind, &content)
}

/// 落盘核心逻辑（与 IPC 解耦，便于单测）。
fn write_report_into(
    session: &PerfSession,
    kind: &str,
    content: &str,
) -> Result<String, String> {
    let Some(dir) = session.output_dir.as_ref() else {
        return Err("perf session is not enabled".to_string());
    };
    let Some((_, file_name)) = REPORT_FILE_NAMES.iter().find(|(name, _)| *name == kind) else {
        return Err(format!("unsupported perf report kind: {kind}"));
    };
    if content.len() > MAX_REPORT_BYTES {
        return Err(format!(
            "perf report too large: {} bytes (max {})",
            content.len(),
            MAX_REPORT_BYTES
        ));
    }
    let target = dir.join(file_name);
    write_atomically(&target, content.as_bytes())?;
    // 只回文件名，不回目录路径。
    Ok(file_name.to_string())
}

fn write_atomically(target: &Path, content: &[u8]) -> Result<(), String> {
    let temp = target.with_extension("tmp");
    std::fs::write(&temp, content).map_err(|error| format!("write {}: {error}", temp.display()))?;
    std::fs::rename(&temp, target)
        .map_err(|error| format!("rename {}: {error}", target.display()))?;
    Ok(())
}

/// 后端命令耗时快照。
#[tauri::command]
pub fn perf_backend_snapshot(session: State<'_, PerfSession>) -> BackendSnapshot {
    let commands = recorder::snapshot();
    let total_recorded_ms: f64 = commands.iter().map(|stat| stat.total_ms).sum();
    let mut slowest = commands.clone();
    slowest.sort_by(|left, right| {
        right
            .max_ms
            .partial_cmp(&left.max_ms)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    slowest.truncate(20);
    BackendSnapshot {
        schema: PERF_SCHEMA,
        kind: "backend",
        session_id: session.session_id.clone(),
        started_at_ms: session.started_at_ms,
        ended_at_ms: recorder::now_ms(),
        app: AppInfo {
            version: env!("CARGO_PKG_VERSION").to_string(),
            os: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
        },
        commands,
        slowest,
        total_recorded_ms: (total_recorded_ms * 100.0).round() / 100.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_file_names_are_a_fixed_whitelist() {
        let names: Vec<&str> = REPORT_FILE_NAMES.iter().map(|(_, file)| *file).collect();
        assert_eq!(names, vec!["frontend.json", "backend.json"]);
    }

    #[test]
    fn write_report_rejects_unknown_kind() {
        let session = PerfSession {
            session_id: "test".to_string(),
            output_dir: Some(std::env::temp_dir().join("nexterm-perf-test")),
            started_at_ms: 0,
        };
        let error = write_report_into(&session, "../../etc/passwd", "{}")
            .expect_err("unknown kind must be rejected");
        assert!(error.contains("unsupported perf report kind"));
    }

    #[test]
    fn write_report_rejects_disabled_session() {
        let session = PerfSession {
            session_id: "inactive".to_string(),
            output_dir: None,
            started_at_ms: 0,
        };
        let error = write_report_into(&session, "frontend", "{}")
            .expect_err("disabled session must be rejected");
        assert!(error.contains("not enabled"));
    }

    #[test]
    fn write_report_writes_into_session_dir_only() {
        let dir = std::env::temp_dir().join("nexterm-perf-write-test");
        let _ = std::fs::remove_dir_all(&dir);
        // 会话目录由 `PerfSession::detect()` 在真实路径上创建；测试里没有
        // 那个会话，所以自己建一个 —— 否则写文件会因为父目录不存在而失败。
        std::fs::create_dir_all(&dir).expect("create session dir");
        let session = PerfSession {
            session_id: "test".to_string(),
            output_dir: Some(dir.clone()),
            started_at_ms: 0,
        };
        let file = write_report_into(&session, "frontend", "{\"ok\":true}")
            .expect("write should succeed");
        assert_eq!(file, "frontend.json");
        let written = std::fs::read_to_string(dir.join("frontend.json")).expect("report file");
        assert_eq!(written, "{\"ok\":true}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
