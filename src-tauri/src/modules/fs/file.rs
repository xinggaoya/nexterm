use std::io::Write;
use std::path::Path;

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
    let target = resolve_path(&path, &workspace);

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
}
