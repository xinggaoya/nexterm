use std::io::Write;
use std::path::Path;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use serde::Serialize;
use tauri::State;
use tempfile::NamedTempFile;

use crate::modules::fs::wsl_ops;
use crate::modules::fs::watcher::{emit_workspace_fs_changed, FsWatcherState};
use crate::modules::workspace::{resolve_path, WorkspaceEnv, WorkspaceRegistry};

const MAX_READ_BYTES: u64 = 10 * 1024 * 1024; // 10 MB
const BINARY_SNIFF_BYTES: usize = 8 * 1024;

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ReadResult {
    Text {
        content: String,
        size: u64,
    },
    Binary {
        size: u64,
    },
    /// File exceeds MAX_READ_BYTES. UI decides whether to offer "open anyway".
    TooLarge {
        size: u64,
        limit: u64,
    },
}

#[tauri::command]
pub fn fs_read_file(path: String, workspace: Option<WorkspaceEnv>) -> Result<ReadResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    match read_file_bytes(&path, &workspace)? {
        FileBytes::Read { bytes, size } => Ok(bytes_to_read_result(bytes, size)),
        FileBytes::TooLarge { size, limit } => Ok(ReadResult::TooLarge { size, limit }),
    }
}

/// 字节读取的共享内部表示:两条命令对"超限"都需要结构化返回而非错误。
enum FileBytes {
    Read { bytes: Vec<u8>, size: u64 },
    TooLarge { size: u64, limit: u64 },
}

/// 本地与 WSL 统一的字节读取路径。超限不是错误:调用方按各自 serde
/// 形状把 TooLarge 映射回前端,由 UI 决定是否提示。
fn read_file_bytes(path: &str, workspace: &WorkspaceEnv) -> Result<FileBytes, String> {
    if let WorkspaceEnv::Ssh { profile_id } = workspace {
        // Phase 2:远端文件经 SSH 通道上的 agent 读取。
        let stat = tauri::async_runtime::block_on(crate::modules::ssh::remote::remote_stat(
            crate::modules::ssh::remote::global_pool(),
            profile_id,
            path,
        ))?;
        if stat.size > MAX_READ_BYTES {
            return Ok(FileBytes::TooLarge {
                size: stat.size,
                limit: MAX_READ_BYTES,
            });
        }
        let bytes = tauri::async_runtime::block_on(crate::modules::ssh::remote::remote_read_file(
            crate::modules::ssh::remote::global_pool(),
            profile_id,
            path,
        ))?;
        return Ok(FileBytes::Read { bytes, size: stat.size });
    }
    if let WorkspaceEnv::Wsl { distro } = workspace {
        if wsl_ops::should_use_wsl_ops(path, workspace) {
            let stat = wsl_ops::stat_path(distro, path)?;
            if stat.size > MAX_READ_BYTES {
                return Ok(FileBytes::TooLarge {
                    size: stat.size,
                    limit: MAX_READ_BYTES,
                });
            }
            let bytes = wsl_ops::read_file(distro, path)?;
            return Ok(FileBytes::Read {
                bytes,
                size: stat.size,
            });
        }
    }

    let p = resolve_path(path, workspace);
    let meta = std::fs::metadata(&p).map_err(|e| {
        log::debug!("read_file_bytes stat({}) failed: {e}", p.display());
        e.to_string()
    })?;

    let size = meta.len();
    if size > MAX_READ_BYTES {
        return Ok(FileBytes::TooLarge {
            size,
            limit: MAX_READ_BYTES,
        });
    }

    let bytes = std::fs::read(&p).map_err(|e| {
        log::debug!("read_file_bytes read({}) failed: {e}", p.display());
        e.to_string()
    })?;

    Ok(FileBytes::Read { bytes, size })
}

fn bytes_to_read_result(bytes: Vec<u8>, size: u64) -> ReadResult {
    // Null-byte sniff on the first chunk. Not perfect (misses UTF-16 BOM
    // cases) but catches the common "this is a PNG" mistake cheaply.
    let sniff_len = bytes.len().min(BINARY_SNIFF_BYTES);
    if bytes[..sniff_len].contains(&0) {
        return ReadResult::Binary { size };
    }

    match String::from_utf8(bytes) {
        Ok(content) => ReadResult::Text { content, size },
        Err(_) => ReadResult::Binary { size },
    }
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Base64ReadResult {
    /// `content` 是原始文件字节的 standard base64。图片预览是预期消费方:
    /// webview 把它拼成 `data:` URL 交给 `<img>`。svg 等文本图片也走这里,
    /// `<img>` 渲染不会执行内嵌脚本。
    Content { content: String, size: u64 },
    TooLarge { size: u64, limit: u64 },
}

/// 与 `fs_read_file` 同源的字节读取,但原样返回内容(base64)而不是做
/// 二进制嗅探丢弃。文件类型过滤由前端扩展名白名单负责;此处与
/// `fs_read_file` 一样只受 10MB 上限约束。
#[tauri::command]
pub fn fs_read_file_base64(
    path: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<Base64ReadResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    match read_file_bytes(&path, &workspace)? {
        FileBytes::Read { bytes, size } => Ok(Base64ReadResult::Content {
            content: BASE64_STANDARD.encode(bytes),
            size,
        }),
        FileBytes::TooLarge { size, limit } => Ok(Base64ReadResult::TooLarge { size, limit }),
    }
}

/// Atomic write via O_EXCL tempfile in the target's parent, then rename.
/// The random suffix is what blocks pre-staged symlink attacks.
fn write_atomic(target: &Path, content: &[u8]) -> std::io::Result<()> {
    let parent = target.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no parent")
    })?;
    let mut tmp = NamedTempFile::new_in(parent)?;
    tmp.as_file_mut().write_all(content)?;
    tmp.as_file_mut().sync_all()?;
    tmp.persist(target).map_err(|e| e.error)?;
    Ok(())
}

#[tauri::command]
pub fn fs_write_file(
    path: String,
    content: String,
    workspace: Option<WorkspaceEnv>,
    registry: State<'_, WorkspaceRegistry>,
    watcher: State<'_, FsWatcherState>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        let content_b64 = BASE64_STANDARD.encode(content.as_bytes());
        return tauri::async_runtime::block_on(crate::modules::ssh::remote::remote_write_file(
            crate::modules::ssh::remote::global_pool(),
            profile_id,
            &path,
            &content_b64,
        ));
    }
    let target = resolve_path(&path, &workspace);
    // Phase 0b:WSL 非 drvfs 路径经常驻 agent 原子写;失败回退 UNC 原子写。
    if let WorkspaceEnv::Wsl { distro } = &workspace {
        if wsl_ops::should_use_wsl_ops(&path, &workspace) {
            let content_b64 = BASE64_STANDARD.encode(content.as_bytes());
            if crate::modules::agent::write_file(distro, &path, &content_b64).is_ok() {
                if let Some(root) = registry.longest_authorized_root(&target) {
                    emit_workspace_fs_changed(&watcher, &root, vec![path.clone()], true);
                }
                return Ok(());
            }
        }
    }
    write_atomic(&target, content.as_bytes()).map_err(|e| {
        log::warn!("fs_write_file({}) failed: {e}", target.display());
        e.to_string()
    })?;

    // Proactively notify the active watcher so the file explorer and the
    // source-control panel refresh immediately, instead of waiting for the
    // OS-level `notify` round-trip. We mark `git_related = true` because
    // any tracked file write can affect `git status` output; the
    // back-end batcher's 1s repeated-signature throttle absorbs the
    // double-fire from the OS notify callback.
    if let Some(root) = registry.longest_authorized_root(&target) {
        emit_workspace_fs_changed(&watcher, &root, vec![path.clone()], true);
    }

    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn overwrites_existing_target() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("note.txt");
        std::fs::write(&target, b"old").unwrap();
        write_atomic(&target, b"new").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
    }

    #[test]
    fn does_not_follow_legacy_staging_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let outside = dir.path().join("outside.txt");
        std::fs::write(&outside, b"untouched").unwrap();

        let target = dir.path().join("note.txt");
        // Pre-stage a symlink at the legacy deterministic staging path.
        let legacy = dir.path().join(".note.txt.nexterm.tmp");
        symlink(&outside, &legacy).unwrap();

        write_atomic(&target, b"payload").unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), b"payload");
        // The pre-staged symlink target must not have been written through.
        assert_eq!(std::fs::read(&outside).unwrap(), b"untouched");
    }
}

#[cfg(test)]
mod read_result_tests {
    use super::*;

    #[test]
    fn maps_utf8_bytes_to_text_result() {
        match bytes_to_read_result(b"hello".to_vec(), 5) {
            ReadResult::Text { content, size } => {
                assert_eq!(content, "hello");
                assert_eq!(size, 5);
            }
            _ => panic!("expected text result"),
        }
    }

    #[test]
    fn maps_nul_bytes_to_binary_result() {
        match bytes_to_read_result(vec![b'a', 0, b'b'], 3) {
            ReadResult::Binary { size } => assert_eq!(size, 3),
            _ => panic!("expected binary result"),
        }
    }

    #[test]
    fn base64_round_trips_binary_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("logo.png");
        let png_header: &[u8] = b"\x89PNG\r\n\x1a\n";
        std::fs::write(&p, png_header).unwrap();

        match fs_read_file_base64(p.to_string_lossy().to_string(), None).unwrap() {
            Base64ReadResult::Content { content, size } => {
                assert_eq!(BASE64_STANDARD.decode(&content).unwrap(), png_header);
                assert_eq!(size, png_header.len() as u64);
            }
            _ => panic!("expected content result"),
        }
    }

    #[test]
    fn base64_read_missing_file_is_error() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("nope.png");
        assert!(fs_read_file_base64(p.to_string_lossy().to_string(), None).is_err());
    }
}
