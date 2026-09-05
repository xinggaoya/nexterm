use std::path::Path;

use tauri::State;

use crate::modules::fs::watcher::{
    emit_workspace_fs_changed_with_kinds, events::FsChangeKind, FsWatcherState,
};
use crate::modules::fs::wsl_ops;
use crate::modules::workspace::{resolve_path, WorkspaceEnv, WorkspaceRegistry};

/// Creates a new empty file. Fails if the file already exists.
#[tauri::command]
pub fn fs_create_file(
    path: String,
    workspace: Option<WorkspaceEnv>,
    registry: State<'_, WorkspaceRegistry>,
    watcher: State<'_, FsWatcherState>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    // SSH:写操作经远端 agent 执行(Phase 2)。
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        return tauri::async_runtime::block_on(crate::modules::ssh::remote::remote_create_file(
            crate::modules::ssh::remote::global_pool(),
            profile_id,
            &path,
        ));
    }
    let p = resolve_path(&path, &workspace);
    // Phase 0b:WSL 非 drvfs 路径经常驻 agent 写,消除 UNC 双轨;失败回退 UNC。
    if let WorkspaceEnv::Wsl { distro } = &workspace {
        if wsl_ops::should_use_wsl_ops(&path, &workspace)
            && crate::modules::agent::create_file(distro, &path).is_ok()
        {
            notify_workspace_fs_changed(
                &registry,
                &watcher,
                &p,
                vec![path.clone()],
                vec![FsChangeKind::Create],
            );
            return Ok(());
        }
    }
    if p.exists() {
        return Err(format!("already exists: {}", p.display()));
    }
    std::fs::write(&p, "").map_err(|e| {
        log::debug!("fs_create_file({}) failed: {e}", p.display());
        e.to_string()
    })?;
    notify_workspace_fs_changed(
        &registry,
        &watcher,
        &p,
        vec![path.clone()],
        vec![FsChangeKind::Create],
    );
    Ok(())
}

/// Creates a new directory. Fails if the directory already exists.
/// Parents are created as needed — matches the common "new folder" UX
/// where typing "a/b/c" creates the full chain.
#[tauri::command]
pub fn fs_create_dir(
    path: String,
    workspace: Option<WorkspaceEnv>,
    registry: State<'_, WorkspaceRegistry>,
    watcher: State<'_, FsWatcherState>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        return tauri::async_runtime::block_on(crate::modules::ssh::remote::remote_create_dir(
            crate::modules::ssh::remote::global_pool(),
            profile_id,
            &path,
        ));
    }
    let p = resolve_path(&path, &workspace);
    if let WorkspaceEnv::Wsl { distro } = &workspace {
        if wsl_ops::should_use_wsl_ops(&path, &workspace)
            && crate::modules::agent::create_dir(distro, &path).is_ok()
        {
            notify_workspace_fs_changed(
                &registry,
                &watcher,
                &p,
                vec![path.clone()],
                vec![FsChangeKind::Create],
            );
            return Ok(());
        }
    }
    if p.exists() {
        return Err(format!("already exists: {}", p.display()));
    }
    std::fs::create_dir_all(&p).map_err(|e| {
        log::debug!("fs_create_dir({}) failed: {e}", p.display());
        e.to_string()
    })?;
    notify_workspace_fs_changed(
        &registry,
        &watcher,
        &p,
        vec![path.clone()],
        vec![FsChangeKind::Create],
    );
    Ok(())
}

/// Renames (or moves) a path. Refuses to overwrite an existing target.
#[tauri::command]
pub fn fs_rename(
    from: String,
    to: String,
    workspace: Option<WorkspaceEnv>,
    registry: State<'_, WorkspaceRegistry>,
    watcher: State<'_, FsWatcherState>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        return tauri::async_runtime::block_on(crate::modules::ssh::remote::remote_rename(
            crate::modules::ssh::remote::global_pool(),
            profile_id,
            &from,
            &to,
        ));
    }
    let from_p = resolve_path(&from, &workspace);
    let to_p = resolve_path(&to, &workspace);
    if let WorkspaceEnv::Wsl { distro } = &workspace {
        if wsl_ops::should_use_wsl_ops(&from, &workspace)
            && crate::modules::agent::rename(distro, &from, &to).is_ok()
        {
            notify_workspace_fs_changed(
                &registry,
                &watcher,
                &from_p,
                vec![from.clone(), to.clone()],
                vec![FsChangeKind::Delete, FsChangeKind::Create],
            );
            return Ok(());
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
    let parent = from_p.parent().unwrap_or(&from_p);
    notify_workspace_fs_changed(
        &registry,
        &watcher,
        parent,
        vec![from.clone(), to],
        vec![FsChangeKind::Delete, FsChangeKind::Create],
    );
    Ok(())
}

/// Deletes a file or directory (recursively for dirs). Callers are
/// responsible for confirming destructive operations with the user.
#[tauri::command]
pub fn fs_delete(
    path: String,
    workspace: Option<WorkspaceEnv>,
    registry: State<'_, WorkspaceRegistry>,
    watcher: State<'_, FsWatcherState>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        return tauri::async_runtime::block_on(crate::modules::ssh::remote::remote_delete(
            crate::modules::ssh::remote::global_pool(),
            profile_id,
            &path,
        ));
    }
    let p = resolve_path(&path, &workspace);
    if let WorkspaceEnv::Wsl { distro } = &workspace {
        if wsl_ops::should_use_wsl_ops(&path, &workspace)
            && crate::modules::agent::delete(distro, &path).is_ok()
        {
            let parent = p.parent().unwrap_or(&p);
            notify_workspace_fs_changed(
                &registry,
                &watcher,
                parent,
                vec![path],
                vec![FsChangeKind::Delete],
            );
            return Ok(());
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

    let parent = p.parent().unwrap_or(&p);
    notify_workspace_fs_changed(
        &registry,
        &watcher,
        parent,
        vec![path],
        vec![FsChangeKind::Delete],
    );
    Ok(())
}

/// Copies a file or directory recursively. Refuses to overwrite an
/// existing destination so callers can choose the target name without
/// surprise data loss.
#[tauri::command]
pub fn fs_copy(
    from: String,
    to: String,
    workspace: Option<WorkspaceEnv>,
    registry: State<'_, WorkspaceRegistry>,
    watcher: State<'_, FsWatcherState>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        return tauri::async_runtime::block_on(crate::modules::ssh::remote::remote_copy(
            crate::modules::ssh::remote::global_pool(),
            profile_id,
            &from,
            &to,
        ));
    }
    let from_p = resolve_path(&from, &workspace);
    let to_p = resolve_path(&to, &workspace);
    if let WorkspaceEnv::Wsl { distro } = &workspace {
        if wsl_ops::should_use_wsl_ops(&from, &workspace)
            && crate::modules::agent::copy(distro, &from, &to).is_ok()
        {
            let dst_parent = to_p.parent().unwrap_or(&to_p);
            notify_workspace_fs_changed(
                &registry,
                &watcher,
                dst_parent,
                vec![to.clone()],
                vec![FsChangeKind::Create],
            );
            return Ok(());
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
    let dst_parent = to_p.parent().unwrap_or(&to_p);
    notify_workspace_fs_changed(
        &registry,
        &watcher,
        dst_parent,
        vec![to],
        vec![FsChangeKind::Create],
    );
    Ok(())
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

fn notify_workspace_fs_changed(
    registry: &WorkspaceRegistry,
    watcher: &FsWatcherState,
    host_path: &std::path::Path,
    paths: Vec<String>,
    kinds: Vec<FsChangeKind>,
) {
    let Some(root) = registry.longest_authorized_root(host_path) else {
        return;
    };
    emit_workspace_fs_changed_with_kinds(watcher, &root, paths, true, Some(kinds));
}
