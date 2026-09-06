use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::modules::fs::wsl_ops::{self, WslEntryKind};
use crate::modules::workspace::{resolve_path, WorkspaceEnv};

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Dir,
    Symlink,
}

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub kind: EntryKind,
    pub size: u64,
    /// Milliseconds since UNIX epoch; 0 if unavailable.
    pub mtime: u64,
}

/// Lists immediate children of `path`. Dirs first, then files, each sorted
/// case-insensitively. Dot-prefixed entries (files and dirs) are hidden unless
/// `show_hidden` is set.
///
/// SSH 分支含网络 I/O(超时可达数十秒):整体下沉阻塞线程池,避免占住
/// 异步 worker 或冻结 UI;本地/WSL 的同步逻辑原样保留在闭包内。
#[tauri::command]
pub async fn fs_read_dir(
    path: String,
    show_hidden: bool,
    workspace: Option<WorkspaceEnv>,
) -> Result<Vec<DirEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || fs_read_dir_blocking(path, show_hidden, workspace))
        .await
        .map_err(|error| format!("fs_read_dir background task failed: {error}"))?
}

fn fs_read_dir_blocking(
    path: String,
    show_hidden: bool,
    workspace: Option<WorkspaceEnv>,
) -> Result<Vec<DirEntry>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        // Phase 2:远端条目经 SSH 通道上的 agent 读取。
        let entries = tauri::async_runtime::block_on(crate::modules::ssh::remote::remote_read_dir(
            profile_id,
            &path,
        ))?
        .into_iter()
        .map(|entry| DirEntry {
            name: entry.name,
            kind: entry_kind_from_wsl(entry.kind),
            size: entry.size,
            mtime: entry.mtime,
        })
        .collect();
        return Ok(filter_and_sort_entries(entries, show_hidden));
    }
    if let WorkspaceEnv::Wsl { distro } = &workspace {
        if wsl_ops::should_use_wsl_ops(&path, &workspace) {
            let entries = wsl_ops::read_dir(distro, &path)?
                .into_iter()
                .map(|entry| DirEntry {
                    name: entry.name,
                    kind: entry_kind_from_wsl(entry.kind),
                    size: entry.size,
                    mtime: entry.mtime,
                })
                .collect();
            return Ok(filter_and_sort_entries(entries, show_hidden));
        }
    }

    let root = resolve_path(&path, &workspace);
    let read = std::fs::read_dir(&root).map_err(|e| {
        log::debug!("fs_read_dir({}) failed: {e}", root.display());
        e.to_string()
    })?;

    let entries: Vec<DirEntry> = read
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;

            // `metadata()` follows symlinks → it returns the target's stat in
            // one syscall (file_type + size + mtime all derived from it). We
            // fall back to `symlink_metadata` for broken symlinks so we don't
            // silently drop them from the listing.
            let (meta, was_symlink) = match std::fs::metadata(entry.path()) {
                Ok(m) => (Some(m), false),
                Err(_) => (entry.metadata().ok(), true),
            };
            let meta = meta?;

            let kind = if was_symlink {
                EntryKind::Symlink
            } else if meta.is_dir() {
                EntryKind::Dir
            } else {
                EntryKind::File
            };

            let size = meta.len();
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            Some(DirEntry {
                name,
                kind,
                size,
                mtime,
            })
        })
        .collect();

    Ok(filter_and_sort_entries(entries, show_hidden))
}

fn entry_kind_from_wsl(kind: WslEntryKind) -> EntryKind {
    match kind {
        WslEntryKind::File => EntryKind::File,
        WslEntryKind::Dir => EntryKind::Dir,
        WslEntryKind::Symlink => EntryKind::Symlink,
    }
}

fn filter_and_sort_entries(mut entries: Vec<DirEntry>, show_hidden: bool) -> Vec<DirEntry> {
    if !show_hidden {
        entries.retain(|entry| !entry.name.starts_with('.'));
    }
    entries.sort_by(|a, b| {
        let rank = |k: &EntryKind| match k {
            EntryKind::Dir => 0,
            EntryKind::Symlink => 1,
            EntryKind::File => 2,
        };
        rank(&a.kind)
            .cmp(&rank(&b.kind))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_hidden_entries_and_sorts_dirs_first() {
        let entries = filter_and_sort_entries(
            vec![
                DirEntry {
                    name: "z.txt".into(),
                    kind: EntryKind::File,
                    size: 0,
                    mtime: 0,
                },
                DirEntry {
                    name: ".env".into(),
                    kind: EntryKind::File,
                    size: 0,
                    mtime: 0,
                },
                DirEntry {
                    name: "src".into(),
                    kind: EntryKind::Dir,
                    size: 0,
                    mtime: 0,
                },
            ],
            false,
        );

        assert_eq!(
            entries
                .into_iter()
                .map(|entry| entry.name)
                .collect::<Vec<_>>(),
            vec!["src", "z.txt"]
        );
    }
}
