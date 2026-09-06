use std::path::{Path, PathBuf};

use tauri::State;

use crate::modules::fs::watcher::{
    emit_workspace_fs_changed_with_kinds, events::FsChangeKind, FsWatcherState,
};
use crate::modules::fs::wsl_ops;
use crate::modules::workspace::{resolve_path, WorkspaceEnv, WorkspaceRegistry};

/// 写操作完成后的 watcher 通知意图:`host_path` 用于解析授权根,
/// `paths`/`kinds` 原样转发给事件 batcher。
///
/// 命令壳是 async fn:重 I/O(远端 agent 往返、磁盘读写)下沉
/// `spawn_blocking`,拿到意图后在异步侧完成通知(仅锁 + channel 发送,
/// 不阻塞)。SSH 分支在远端完成写入,本地 watcher 不适用,返回 `None`。
pub(crate) struct FsNotifyIntent {
    host_path: PathBuf,
    paths: Vec<String>,
    kinds: Vec<FsChangeKind>,
}

impl FsNotifyIntent {
    pub(crate) fn new(host_path: PathBuf, paths: Vec<String>, kinds: Vec<FsChangeKind>) -> Self {
        Self {
            host_path,
            paths,
            kinds,
        }
    }
}

/// Creates a new empty file. Fails if the file already exists.
#[tauri::command]
pub async fn fs_create_file(
    path: String,
    workspace: Option<WorkspaceEnv>,
    registry: State<'_, WorkspaceRegistry>,
    watcher: State<'_, FsWatcherState>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let watcher = watcher.inner().clone();
    let intent =
        tauri::async_runtime::spawn_blocking(move || create_file_blocking(&path, workspace))
            .await
            .map_err(|error| format!("fs_create_file background task failed: {error}"))??;
    if let Some(intent) = intent {
        notify_workspace_fs_changed(registry.inner(), &watcher, &intent);
    }
    Ok(())
}

fn create_file_blocking(
    path: &str,
    workspace: WorkspaceEnv,
) -> Result<Option<FsNotifyIntent>, String> {
    // SSH:写操作经远端 agent 执行(Phase 2)。
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        tauri::async_runtime::block_on(crate::modules::ssh::remote::remote_create_file(
            profile_id,
            path,
        ))?;
        return Ok(None);
    }
    let p = resolve_path(path, &workspace);
    // Phase 0b:WSL 非 drvfs 路径经常驻 agent 写,消除 UNC 双轨;失败回退 UNC。
    if let WorkspaceEnv::Wsl { distro } = &workspace {
        if wsl_ops::should_use_wsl_ops(path, &workspace)
            && crate::modules::agent::create_file(distro, path).is_ok()
        {
            return Ok(Some(FsNotifyIntent::new(
                p,
                vec![path.to_string()],
                vec![FsChangeKind::Create],
            )));
        }
    }
    if p.exists() {
        return Err(format!("already exists: {}", p.display()));
    }
    std::fs::write(&p, "").map_err(|e| {
        log::debug!("fs_create_file({}) failed: {e}", p.display());
        e.to_string()
    })?;
    Ok(Some(FsNotifyIntent::new(
        p,
        vec![path.to_string()],
        vec![FsChangeKind::Create],
    )))
}

/// Creates a new directory. Fails if the directory already exists.
/// Parents are created as needed — matches the common "new folder" UX
/// where typing "a/b/c" creates the full chain.
#[tauri::command]
pub async fn fs_create_dir(
    path: String,
    workspace: Option<WorkspaceEnv>,
    registry: State<'_, WorkspaceRegistry>,
    watcher: State<'_, FsWatcherState>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let watcher = watcher.inner().clone();
    let intent =
        tauri::async_runtime::spawn_blocking(move || create_dir_blocking(&path, workspace))
            .await
            .map_err(|error| format!("fs_create_dir background task failed: {error}"))??;
    if let Some(intent) = intent {
        notify_workspace_fs_changed(registry.inner(), &watcher, &intent);
    }
    Ok(())
}

fn create_dir_blocking(
    path: &str,
    workspace: WorkspaceEnv,
) -> Result<Option<FsNotifyIntent>, String> {
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        tauri::async_runtime::block_on(crate::modules::ssh::remote::remote_create_dir(
            profile_id,
            path,
        ))?;
        return Ok(None);
    }
    let p = resolve_path(path, &workspace);
    if let WorkspaceEnv::Wsl { distro } = &workspace {
        if wsl_ops::should_use_wsl_ops(path, &workspace)
            && crate::modules::agent::create_dir(distro, path).is_ok()
        {
            return Ok(Some(FsNotifyIntent::new(
                p,
                vec![path.to_string()],
                vec![FsChangeKind::Create],
            )));
        }
    }
    if p.exists() {
        return Err(format!("already exists: {}", p.display()));
    }
    std::fs::create_dir_all(&p).map_err(|e| {
        log::debug!("fs_create_dir({}) failed: {e}", p.display());
        e.to_string()
    })?;
    Ok(Some(FsNotifyIntent::new(
        p,
        vec![path.to_string()],
        vec![FsChangeKind::Create],
    )))
}

/// Renames (or moves) a path. Refuses to overwrite an existing target.
#[tauri::command]
pub async fn fs_rename(
    from: String,
    to: String,
    workspace: Option<WorkspaceEnv>,
    registry: State<'_, WorkspaceRegistry>,
    watcher: State<'_, FsWatcherState>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let watcher = watcher.inner().clone();
    let intent = tauri::async_runtime::spawn_blocking(move || {
        rename_blocking(&from, &to, workspace)
    })
    .await
    .map_err(|error| format!("fs_rename background task failed: {error}"))??;
    if let Some(intent) = intent {
        notify_workspace_fs_changed(registry.inner(), &watcher, &intent);
    }
    Ok(())
}

fn rename_blocking(
    from: &str,
    to: &str,
    workspace: WorkspaceEnv,
) -> Result<Option<FsNotifyIntent>, String> {
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        tauri::async_runtime::block_on(crate::modules::ssh::remote::remote_rename(
            profile_id,
            from,
            to,
        ))?;
        return Ok(None);
    }
    let from_p = resolve_path(from, &workspace);
    let to_p = resolve_path(to, &workspace);
    if let WorkspaceEnv::Wsl { distro } = &workspace {
        if wsl_ops::should_use_wsl_ops(from, &workspace)
            && crate::modules::agent::rename(distro, from, to).is_ok()
        {
            return Ok(Some(FsNotifyIntent::new(
                from_p,
                vec![from.to_string(), to.to_string()],
                vec![FsChangeKind::Delete, FsChangeKind::Create],
            )));
        }
    }
    if !from_p.exists() {
        return Err(format!("not found: {}", from_p.display()));
    }
    if to_p.exists() {
        return Err(format!("already exists: {}", to_p.display()));
    }
    std::fs::rename(&from_p, &to_p).map_err(|e| {
        log::debug!(
            "fs_rename({} -> {}) failed: {e}",
            from_p.display(),
            to_p.display()
        );
        e.to_string()
    })?;
    // The old path is gone (Delete) and the new path appeared (Create),
    // so emit both kinds so the file explorer's silent refresh always
    // rebuilds instead of trusting the patch path's stale snapshot.
    let parent = from_p.parent().unwrap_or(&from_p).to_path_buf();
    Ok(Some(FsNotifyIntent::new(
        parent,
        vec![from.to_string(), to.to_string()],
        vec![FsChangeKind::Delete, FsChangeKind::Create],
    )))
}

/// Deletes a file or directory (recursively for dirs). Callers are
/// responsible for confirming destructive operations with the user.
#[tauri::command]
pub async fn fs_delete(
    path: String,
    workspace: Option<WorkspaceEnv>,
    registry: State<'_, WorkspaceRegistry>,
    watcher: State<'_, FsWatcherState>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let watcher = watcher.inner().clone();
    let intent = tauri::async_runtime::spawn_blocking(move || delete_blocking(&path, workspace))
        .await
        .map_err(|error| format!("fs_delete background task failed: {error}"))??;
    if let Some(intent) = intent {
        notify_workspace_fs_changed(registry.inner(), &watcher, &intent);
    }
    Ok(())
}

fn delete_blocking(path: &str, workspace: WorkspaceEnv) -> Result<Option<FsNotifyIntent>, String> {
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        tauri::async_runtime::block_on(crate::modules::ssh::remote::remote_delete(
            profile_id, path,
        ))?;
        return Ok(None);
    }
    let p = resolve_path(path, &workspace);
    if let WorkspaceEnv::Wsl { distro } = &workspace {
        if wsl_ops::should_use_wsl_ops(path, &workspace)
            && crate::modules::agent::delete(distro, path).is_ok()
        {
            let parent = p.parent().unwrap_or(&p).to_path_buf();
            return Ok(Some(FsNotifyIntent::new(
                parent,
                vec![path.to_string()],
                vec![FsChangeKind::Delete],
            )));
        }
    }
    let meta = std::fs::symlink_metadata(&p).map_err(|e| {
        log::debug!("fs_delete stat({}) failed: {e}", p.display());
        e.to_string()
    })?;

    let result = if meta.is_dir() {
        std::fs::remove_dir_all(&p)
    } else {
        std::fs::remove_file(&p)
    };

    result.map_err(|e| {
        log::warn!("fs_delete({}) failed: {e}", p.display());
        e.to_string()
    })?;

    let parent = p.parent().unwrap_or(&p).to_path_buf();
    Ok(Some(FsNotifyIntent::new(
        parent,
        vec![path.to_string()],
        vec![FsChangeKind::Delete],
    )))
}

/// Copies a file or directory recursively. Refuses to overwrite an
/// existing destination so callers can choose the target name without
/// surprise data loss.
#[tauri::command]
pub async fn fs_copy(
    from: String,
    to: String,
    workspace: Option<WorkspaceEnv>,
    registry: State<'_, WorkspaceRegistry>,
    watcher: State<'_, FsWatcherState>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let watcher = watcher.inner().clone();
    let intent =
        tauri::async_runtime::spawn_blocking(move || copy_blocking(&from, &to, workspace))
            .await
            .map_err(|error| format!("fs_copy background task failed: {error}"))??;
    if let Some(intent) = intent {
        notify_workspace_fs_changed(registry.inner(), &watcher, &intent);
    }
    Ok(())
}

fn copy_blocking(
    from: &str,
    to: &str,
    workspace: WorkspaceEnv,
) -> Result<Option<FsNotifyIntent>, String> {
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        tauri::async_runtime::block_on(crate::modules::ssh::remote::remote_copy(
            profile_id, from, to,
        ))?;
        return Ok(None);
    }
    let from_p = resolve_path(from, &workspace);
    let to_p = resolve_path(to, &workspace);
    if let WorkspaceEnv::Wsl { distro } = &workspace {
        if wsl_ops::should_use_wsl_ops(from, &workspace)
            && crate::modules::agent::copy(distro, from, to).is_ok()
        {
            let dst_parent = to_p.parent().unwrap_or(&to_p).to_path_buf();
            return Ok(Some(FsNotifyIntent::new(
                dst_parent,
                vec![to.to_string()],
                vec![FsChangeKind::Create],
            )));
        }
    }
    if !from_p.exists() {
        return Err(format!("not found: {}", from_p.display()));
    }
    if to_p.exists() {
        return Err(format!("already exists: {}", to_p.display()));
    }
    let meta = std::fs::symlink_metadata(&from_p).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        copy_dir_recursive(&from_p, &to_p)?;
    } else {
        std::fs::copy(&from_p, &to_p).map_err(|e| e.to_string())?;
    }
    // Copying introduces new paths on the destination side. Treat them
    // as Creates so the explorer never confuses a duplicate with a
    // modify. The source side is unmodified, so we leave it out of the
    // emit entirely.
    let dst_parent = to_p.parent().unwrap_or(&to_p).to_path_buf();
    Ok(Some(FsNotifyIntent::new(
        dst_parent,
        vec![to.to_string()],
        vec![FsChangeKind::Create],
    )))
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("mkdir {}: {e}", dst.display()))?;
    for entry in std::fs::read_dir(src).map_err(|e| format!("readdir {}: {e}", src.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        let child_src = entry.path();
        let child_dst = dst.join(entry.file_name());
        if ft.is_dir() {
            copy_dir_recursive(&child_src, &child_dst)?;
        } else if ft.is_file() {
            std::fs::copy(&child_src, &child_dst)
                .map_err(|e| format!("copy {}: {e}", child_src.display()))?;
        }
    }
    Ok(())
}

/// 把通知意图转发给活跃 watcher。找不到授权根时静默跳过 —— 与旧
/// `emit_workspace_fs_changed` 的行为一致。
pub(crate) fn notify_workspace_fs_changed(
    registry: &WorkspaceRegistry,
    watcher: &FsWatcherState,
    intent: &FsNotifyIntent,
) {
    let Some(root) = registry.longest_authorized_root(&intent.host_path) else {
        return;
    };
    emit_workspace_fs_changed_with_kinds(watcher, &root, intent.paths.clone(), true, Some(intent.kinds.clone()));
}
