use std::collections::HashMap;
use std::path::PathBuf;

use tauri::State;

use crate::modules::fs::watcher::{
    emit_workspace_fs_changed_with_kinds, events::FsChangeKind, FsWatcherState,
};
use crate::modules::fs::wsl_ops;
use crate::modules::workspace::{resolve_path, WorkspaceEnv, WorkspaceRegistry};
use nexterm_fs_core::{ConflictPolicy, TransferItem, TransferMode, TransferResult};

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
    // 复制语义（目录 / 文件 / 符号链接）统一交给 nexterm-fs-core：
    // 旧的本地 copy_dir_recursive 用 file_type() 同时判 is_dir/is_file，
    // 两头都不匹配时**静默跳过符号链接**（仓库里的 node_modules 符号链接
    // 复制后会凭空消失）。共享实现按链接本身重建，并在 Windows 上给出
    // 无法重建的告警。
    let mut warnings = Vec::new();
    nexterm_fs_core::copy_path(&from_p, &to_p, &mut warnings).map_err(|e| {
        log::debug!("fs_copy({} -> {}) failed: {e}", from_p.display(), to_p.display());
        e
    })?;
    for warning in &warnings {
        log::warn!("fs_copy warning: {warning}");
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

// ── 批量搬运（拖拽移动 / 复制、剪贴板粘贴共用）─────────────────────────
//
// 搬运规则（冲突三策略、跨设备回落、防自疍、符号链接）全在 nexterm-fs-core，
// 本地直接调用，WSL / SSH 转给 agent —— 三条路径执行的是同一份代码。

/// 批量移动。`items` 里的 from/to 都是**用户视角路径**（WSL 侧是 Linux
/// 路径），解析与执行位置由 `workspace` 决定。
#[tauri::command]
pub async fn fs_move_many(
    items: Vec<TransferItem>,
    conflict: Option<ConflictPolicy>,
    workspace: Option<WorkspaceEnv>,
    registry: State<'_, WorkspaceRegistry>,
    watcher: State<'_, FsWatcherState>,
) -> Result<TransferResult, String> {
    dispatch_transfer(
        items,
        conflict.unwrap_or_default(),
        TransferMode::Move,
        workspace,
        registry,
        watcher,
    )
    .await
}

/// 批量复制。语义与 `fs_move_many` 一致，只是不删源。
#[tauri::command]
pub async fn fs_copy_many(
    items: Vec<TransferItem>,
    conflict: Option<ConflictPolicy>,
    workspace: Option<WorkspaceEnv>,
    registry: State<'_, WorkspaceRegistry>,
    watcher: State<'_, FsWatcherState>,
) -> Result<TransferResult, String> {
    dispatch_transfer(
        items,
        conflict.unwrap_or_default(),
        TransferMode::Copy,
        workspace,
        registry,
        watcher,
    )
    .await
}

async fn dispatch_transfer(
    items: Vec<TransferItem>,
    policy: ConflictPolicy,
    mode: TransferMode,
    workspace: Option<WorkspaceEnv>,
    registry: State<'_, WorkspaceRegistry>,
    watcher: State<'_, FsWatcherState>,
) -> Result<TransferResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let watcher = watcher.inner().clone();
    if items.is_empty() {
        return Ok(TransferResult::default());
    }
    let (result, intent) = tauri::async_runtime::spawn_blocking(move || {
        transfer_blocking(items, policy, mode, workspace)
    })
    .await
    .map_err(|error| format!("fs transfer background task failed: {error}"))??;
    if let Some(intent) = intent {
        notify_workspace_fs_changed(registry.inner(), &watcher, &intent);
    }
    Ok(result)
}

type TransferOutcome = (TransferResult, Option<FsNotifyIntent>);

fn transfer_blocking(
    items: Vec<TransferItem>,
    policy: ConflictPolicy,
    mode: TransferMode,
    workspace: WorkspaceEnv,
) -> Result<TransferOutcome, String> {
    // SSH: 整批交给远端 agent，远端写入不走本地 watcher。
    //
    // 远端链路是 async（通道内交 tokio），但本函数已经跑在 spawn_blocking
    // 的阻塞线程上，所以这里 block_on 是安全的 —— 与同文件既有的
    // remote_create_file / remote_rename 写法一致。
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        let result = tauri::async_runtime::block_on(async {
            match mode {
                TransferMode::Move => {
                    crate::modules::ssh::remote::remote_move_many(profile_id, &items, policy).await
                }
                TransferMode::Copy => {
                    crate::modules::ssh::remote::remote_copy_many(profile_id, &items, policy).await
                }
            }
        })?;
        return Ok((result, None));
    }

    // WSL 非 drvfs 路径：agent 常驻在发行版内，比 UNC 直读快且不受
    // Windows 侧缓存影响。失败则回退到 UNC 路径本地执行。
    if let WorkspaceEnv::Wsl { distro } = &workspace {
        if items
            .iter()
            .all(|item| wsl_ops::should_use_wsl_ops(&item.from, &workspace))
        {
            let via_agent = match mode {
                TransferMode::Move => crate::modules::agent::move_many(distro, &items, policy),
                TransferMode::Copy => crate::modules::agent::copy_many(distro, &items, policy),
            };
            if let Ok(result) = via_agent {
                // agent 内的写入本地 watcher 看不到，按既有约定发一次
                // 显式通知让 explorer 重读（host_path 用 UNC 解析授权根，
                // 事件里的 paths 仍是用户可见的 Linux 路径）。
                let intent = transfer_intent(&items, &result, &workspace);
                return Ok((result, intent));
            }
        }
    }

    // 本地执行：先把用户视角路径翻成本机路径。
    //
    // `display_of` 记下「本机路径 → 用户可见路径」的反查表：只有 Windows
    // 上的 WSL UNC 回退路径会真的发生形变，本地/非 Windows 是恒等映射。
    // 搬运结果里的路径要原样回传给前端去刷新目录与跟随 tab，所以必须还原。
    let mut display_of: HashMap<String, String> = HashMap::new();
    let resolved: Vec<TransferItem> = items
        .iter()
        .map(|item| {
            let from_resolved = resolve_path(&item.from, &workspace);
            let to_resolved = resolve_path(&item.to, &workspace);
            let from_text = from_resolved.to_string_lossy().into_owned();
            let to_text = to_resolved.to_string_lossy().into_owned();
            // 先到先得：链式操作里同一个路径可能既是上一条的落点又是下一条的
            // 源，保持先写入的映射以保证确定性。
            display_of
                .entry(from_text.clone())
                .or_insert_with(|| item.from.clone());
            display_of
                .entry(to_text.clone())
                .or_insert_with(|| item.to.clone());
            TransferItem {
                from: from_text,
                to: to_text,
            }
        })
        .collect();
    let result = nexterm_fs_core::transfer_all(&resolved, policy, mode);
    for failure in &result.failed {
        log::warn!(
            "fs transfer failed {} -> {}: {}",
            failure.from,
            failure.to,
            failure.error
        );
    }
    let result = TransferResult {
        completed: to_display_paths(&result.completed, &display_of),
        skipped: to_display_paths(&result.skipped, &display_of),
        cross_device: to_display_paths(&result.cross_device, &display_of),
        failed: result
            .failed
            .iter()
            .map(|failure| nexterm_fs_core::TransferFailure {
                from: display_of
                    .get(&failure.from)
                    .cloned()
                    .unwrap_or_else(|| failure.from.clone()),
                to: display_of
                    .get(&failure.to)
                    .cloned()
                    .unwrap_or_else(|| failure.to.clone()),
                error: failure.error.clone(),
            })
            .collect(),
        warnings: result.warnings.clone(),
    };
    let intent = transfer_intent(&items, &result, &workspace);
    Ok((result, intent))
}

/// 把本机路径形态的结果映射回用户可见路径（WSL 侧 UNC → Linux 路径）。
fn to_display_paths(
    items: &[TransferItem],
    display_of: &HashMap<String, String>,
) -> Vec<TransferItem> {
    items
        .iter()
        .map(|item| TransferItem {
            from: display_of
                .get(&item.from)
                .cloned()
                .unwrap_or_else(|| item.from.clone()),
            to: display_of
                .get(&item.to)
                .cloned()
                .unwrap_or_else(|| item.to.clone()),
        })
        .collect()
}

/// 汇总一次批量搬运的 watcher 通知意图。
///
/// 源侧 Delete、目标侧 Create：explorer 靠 kind 区分"这一项没了"与
/// "那一项新出现"，两者缺一都会让树停留在半旧半新的状态。
fn transfer_intent(
    items: &[TransferItem],
    result: &TransferResult,
    workspace: &WorkspaceEnv,
) -> Option<FsNotifyIntent> {
    let mut paths = Vec::new();
    let mut kinds = Vec::new();
    for moved in result
        .completed
        .iter()
        .chain(result.cross_device.iter())
        .chain(result.skipped.iter())
    {
        paths.push(moved.from.clone());
        kinds.push(FsChangeKind::Delete);
        paths.push(moved.to.clone());
        kinds.push(FsChangeKind::Create);
    }
    if paths.is_empty() {
        return None;
    }
    // host_path 只用来解析授权根，整批都在同一工作区下，取任一目标父目录即可。
    let anchor = result
        .cross_device
        .first()
        .or(result.completed.first())
        .or(result.skipped.first())
        .unwrap_or(items.first()?);
    let host_path = resolve_path(&anchor.to, workspace);
    Some(FsNotifyIntent::new(host_path, paths, kinds))
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
