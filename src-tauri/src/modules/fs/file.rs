use std::io::Write;
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::Emitter;
use tempfile::NamedTempFile;

use crate::modules::fs::wsl_ops::{self, WslEntryKind};
use crate::modules::workspace::{normalize_host_path, resolve_path, WorkspaceEnv};

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

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StatKind {
    File,
    Dir,
    Symlink,
}

#[derive(Serialize)]
pub struct FileStat {
    pub size: u64,
    pub mtime: u64,
    pub kind: StatKind,
}

#[tauri::command]
pub fn fs_read_file(path: String, workspace: Option<WorkspaceEnv>) -> Result<ReadResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if let WorkspaceEnv::Wsl { distro } = &workspace {
        if wsl_ops::should_use_wsl_ops(&path, &workspace) {
            let stat = wsl_ops::stat_path(distro, &path)?;
            if stat.size > MAX_READ_BYTES {
                return Ok(ReadResult::TooLarge {
                    size: stat.size,
                    limit: MAX_READ_BYTES,
                });
            }
            let bytes = wsl_ops::read_file(distro, &path)?;
            return Ok(bytes_to_read_result(bytes, stat.size));
        }
    }

    let p = resolve_path(&path, &workspace);
    let meta = std::fs::metadata(&p).map_err(|e| {
        log::debug!("fs_read_file stat({}) failed: {e}", p.display());
        e.to_string()
    })?;

    let size = meta.len();
    if size > MAX_READ_BYTES {
        return Ok(ReadResult::TooLarge {
            size,
            limit: MAX_READ_BYTES,
        });
    }

    let bytes = std::fs::read(&p).map_err(|e| {
        log::debug!("fs_read_file read({}) failed: {e}", p.display());
        e.to_string()
    })?;

    Ok(bytes_to_read_result(bytes, size))
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

#[derive(Serialize, Clone)]
struct FileWrittenEvent {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
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
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let target = resolve_path(&path, &workspace);

    write_atomic(&target, content.as_bytes()).map_err(|e| {
        log::warn!("fs_write_file({}) failed: {e}", target.display());
        e.to_string()
    })?;

    let _ = app.emit(
        "fs:file-written",
        FileWrittenEvent {
            path: path.clone(),
            source,
        },
    );

    Ok(())
}

#[tauri::command]
pub fn fs_canonicalize(path: String, workspace: Option<WorkspaceEnv>) -> Result<String, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    let canon = normalize_host_path(std::fs::canonicalize(&p).map_err(|e| e.to_string())?);
    Ok(canon.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
pub fn fs_stat(path: String, workspace: Option<WorkspaceEnv>) -> Result<FileStat, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if let WorkspaceEnv::Wsl { distro } = &workspace {
        if wsl_ops::should_use_wsl_ops(&path, &workspace) {
            let stat = wsl_ops::stat_path(distro, &path)?;
            return Ok(FileStat {
                size: stat.size,
                mtime: stat.mtime,
                kind: stat_kind_from_wsl(stat.kind),
            });
        }
    }

    let p = resolve_path(&path, &workspace);
    let meta = std::fs::metadata(&p).map_err(|e| e.to_string())?;
    let kind = if meta.is_dir() {
        StatKind::Dir
    } else if meta.file_type().is_symlink() {
        StatKind::Symlink
    } else {
        StatKind::File
    };
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(FileStat {
        size: meta.len(),
        mtime,
        kind,
    })
}

fn stat_kind_from_wsl(kind: WslEntryKind) -> StatKind {
    match kind {
        WslEntryKind::File => StatKind::File,
        WslEntryKind::Dir => StatKind::Dir,
        WslEntryKind::Symlink => StatKind::Symlink,
    }
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
}
