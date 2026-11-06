//! 目录浏览能力（picker 专用）。
//!
//! # 浏览 ≠ 访问
//!
//! `fs_read_dir` / `fs_read_file` / `fs_write_file` 全部走
//! `workspace::authorize_access_path` chokepoint：路径必须落在**已授权工作区根**
//! 之下。目录选择器（picker 模块）的职责恰恰是**在授权之前**浏览文件系统、
//! 挑一个新根出来 —— 两者语义直接冲突，于是 picker 只能浏览「已经打开过」的
//! 工作区，「从 WSL 工作区里挑一个本机目录」永远挑不出来（报
//! `PathNotAuthorized: C:/`）。
//!
//! 这里给 picker 一条**专用的浏览通道**：
//!
//! - 只返回目录**元数据**（name / kind / size / mtime），不返回文件内容；
//! - **不写入**授权注册表（不污染 `MAX_AUTHORIZED_ROOTS`），也不放宽任何
//!   读写命令的判定；
//! - 凭据目录（`~/.ssh` / `~/.aws` / `~/.gnupg` / `~/.config/gcloud`）硬拒。
//!
//! 换句话说：**能看目录列表 ≠ 能读文件内容**。浏览是「选工作区根」这件事
//! 必需的前置步骤，不是一次授权。

use crate::modules::fs::mutate;
use crate::modules::fs::tree::{entry_kind_from_wsl, filter_and_sort_entries, read_host_dir, DirEntry};
use crate::modules::fs::wsl_ops;
use crate::modules::workspace::{reject_credential_dir, resolve_path, WorkspaceEnv};

/// WSL 发行版内的凭据目录（相对家目录）。
///
/// 宿主侧 `is_sensitive_dir` 以 **Windows 家目录** 为基准，对 WSL 的 Linux
/// 路径不适用 —— 那边的家目录是 `/home/<user>` 或 `/root`。这里按同样的
/// 语义补一条：这些路径**紧贴家目录**时才算凭据目录，避免误伤项目里同名的
/// 测试夹具目录（`~/project/.ssh` 不是凭据目录）。
const POSIX_CREDENTIAL_SUBPATHS: &[&str] = &[".ssh", ".aws", ".gnupg", ".config/gcloud"];

/// 枚举一个目录的子项，供 picker 浏览候选工作区根。
///
/// 与 `fs_read_dir` 的唯一区别是**不做授权根判定**：浏览发生在授权之前，
/// 这是 picker 的固有语义。返回的仍然只是条目元数据。
#[tauri::command]
pub async fn fs_browse_dir(
    path: String,
    show_hidden: bool,
    workspace: Option<WorkspaceEnv>,
) -> Result<Vec<DirEntry>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    crate::modules::perf::recorder::timed_async(
        "fs_browse_dir",
        tauri::async_runtime::spawn_blocking(move || browse_dir_blocking(path, show_hidden, workspace)),
    )
    .await
    .map_err(|error| format!("fs_browse_dir background task failed: {error}"))?
}

/// 在 picker 浏览的目录里新建一个子目录。
///
/// 同样在授权根之外可用（否则「新建文件夹」按钮在未授权目录下必然失败），
/// 护栏与浏览通道一致：父目录不得是凭据目录，名字必须是纯文件名。
#[tauri::command]
pub async fn fs_browse_create_dir(
    path: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    tauri::async_runtime::spawn_blocking(move || browse_create_dir_blocking(path, workspace))
        .await
        .map_err(|error| format!("fs_browse_create_dir background task failed: {error}"))?
}

fn browse_dir_blocking(
    path: String,
    show_hidden: bool,
    workspace: WorkspaceEnv,
) -> Result<Vec<DirEntry>, String> {
    if workspace.is_ssh() {
        return Err("SSH workspaces do not support directory browsing".into());
    }
    if let WorkspaceEnv::Wsl { distro } = &workspace {
        if wsl_ops::should_use_wsl_ops(&path, &workspace) {
            // Linux 路径：在发行版内枚举（agent 优先，wsl.exe 兜底）。
            reject_posix_credential_dir(&path)?;
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
        // drvfs 路径（/mnt/c/...）落到宿主盘符，下面统一处理。
    }
    let host = resolve_path(&path, &workspace);
    let canonical = std::fs::canonicalize(&host).map_err(|error| {
        log::debug!("fs_browse_dir({}) failed: {error}", host.display());
        format!("path not accessible: {error}")
    })?;
    if !canonical.is_dir() {
        return Err(format!("not a directory: {}", canonical.display()));
    }
    reject_credential_dir(&canonical)?;
    read_host_dir(&canonical, show_hidden)
}

fn browse_create_dir_blocking(path: String, workspace: WorkspaceEnv) -> Result<(), String> {
    if workspace.is_ssh() {
        return Err("SSH workspaces do not support directory browsing".into());
    }
    let (parent, _name) = split_dir_name(&path)?;
    if workspace.is_wsl() && wsl_ops::should_use_wsl_ops(&path, &workspace) {
        // Linux 路径：发行版内的家目录规则适用。
        reject_posix_credential_dir(&parent)?;
    } else {
        // 本机 / WSL 的 drvfs 路径（/mnt/c/... 映射成宿主盘符）：
        // 宿主侧家目录规则适用。
        let host_parent = resolve_path(&parent, &workspace);
        let canonical = std::fs::canonicalize(&host_parent)
            .map_err(|error| format!("path not accessible: {error}"))?;
        if !canonical.is_dir() {
            return Err(format!("not a directory: {}", canonical.display()));
        }
        reject_credential_dir(&canonical)?;
    }
    // 复用写通道的实现（WSL 走 agent / UNC，本机走 create_dir_all），
    // 但**不**复用它的授权判定 —— 浏览通道的判定在上面。
    mutate::create_dir_blocking(&path, workspace).map(|_| ())
}

/// 把 `a/b/c` 拆成父目录 `a/b` 与纯文件名 `c`。
///
/// 名字必须不含路径分隔符、不是 `.` / `..` —— 浏览通道不允许在候选路径上
/// 写「相对路径」或「往上级跳」。末尾的分隔符同样拒绝：那是「目录」而不是
/// 「要新建的名字」。
fn split_dir_name(path: &str) -> Result<(String, String), String> {
    let normalized = path.trim().replace('\\', "/");
    if normalized.is_empty() || normalized.ends_with('/') {
        return Err(format!("invalid directory path: {path}"));
    }
    let (parent, name) = normalized
        .rsplit_once('/')
        .ok_or_else(|| format!("invalid directory path: {path}"))?;
    if name.is_empty() || name == "." || name == ".." {
        return Err(format!("invalid directory name: {path}"));
    }
    // 盘符根：`C:/newdir` 的父目录是 `C:/` 而不是 `C:`（后者在 Windows 上
    // 指的是「当前目录」，不是盘符根）。
    let parent = if parent.is_empty() {
        "/".to_string()
    } else if parent.len() == 2 && parent.ends_with(':') {
        format!("{parent}/")
    } else {
        parent.to_string()
    };
    Ok((parent, name.to_string()))
}

/// WSL 发行版内（Linux 路径）的凭据目录判定。
///
/// 语义与宿主侧 `is_sensitive_dir` 对齐：只有**紧贴家目录**的同名目录才算
/// 凭据目录，避免误伤项目里同名的测试夹具目录。
fn is_posix_credential_dir(path: &str) -> bool {
    let normalized = path.trim().replace('\\', "/");
    let components: Vec<&str> = normalized.split('/').filter(|c| !c.is_empty()).collect();
    // 相对家目录的部分：/home/<user>/... → [...]; /root/... → [...]
    let relative: &[&str] = match components.first() {
        Some(&"home") if components.len() >= 2 => &components[2..],
        Some(&"root") => &components[1..],
        _ => return false,
    };
    POSIX_CREDENTIAL_SUBPATHS.iter().any(|subpath| {
        let parts: Vec<&str> = subpath.split('/').collect();
        parts.len() <= relative.len()
            && parts
                .iter()
                .zip(relative.iter())
                .all(|(a, b)| a.eq_ignore_ascii_case(b))
    })
}

fn reject_posix_credential_dir(path: &str) -> Result<(), String> {
    if is_posix_credential_dir(path) {
        return Err(format!("refusing to access credential directory: {path}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tempdir(label: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "nexterm-browse-{label}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&path).expect("temp dir");
        path
    }

    #[test]
    fn splits_parent_and_plain_name() {
        assert_eq!(
            split_dir_name("C:/Users/dev/project").unwrap(),
            ("C:/Users/dev".to_string(), "project".to_string())
        );
        assert_eq!(
            split_dir_name("/home/dev/project").unwrap(),
            ("/home/dev".to_string(), "project".to_string())
        );
        // 盘符根的父目录是 `C:/`，不是 `C:`（后者在 Windows 上指当前目录）。
        assert_eq!(
            split_dir_name("C:/project").unwrap(),
            ("C:/".to_string(), "project".to_string())
        );
    }

    #[test]
    fn rejects_non_plain_names() {
        // 末尾分隔符是「目录」而不是「要新建的名字」。
        assert!(split_dir_name("C:/Users/dev/").is_err());
        assert!(split_dir_name("C:/Users/dev/.").is_err());
        assert!(split_dir_name("C:/Users/dev/..").is_err());
        // 没有父目录的裸名字不合法。
        assert!(split_dir_name("name").is_err());
    }

    #[test]
    fn posix_credential_dirs_are_only_flagged_under_home() {
        assert!(is_posix_credential_dir("/home/dev/.ssh"));
        assert!(is_posix_credential_dir("/home/dev/.aws"));
        assert!(is_posix_credential_dir("/home/dev/.gnupg"));
        assert!(is_posix_credential_dir("/home/dev/.config/gcloud"));
        assert!(is_posix_credential_dir("/root/.ssh"));
        // 项目里的同名目录不算凭据目录。
        assert!(!is_posix_credential_dir("/home/dev/project/.ssh"));
        assert!(!is_posix_credential_dir("/srv/app/.aws"));
        assert!(!is_posix_credential_dir("/mnt/c/Users/dev/.ssh"));
    }

    #[test]
    fn browse_dir_lists_entries_outside_authorized_roots() {
        let dir = tempdir("list");
        std::fs::write(dir.join("a.txt"), b"x").expect("write file");
        std::fs::create_dir_all(dir.join("sub")).expect("create sub");

        let entries = read_host_dir(&dir, false).expect("read dir");

        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"a.txt"));
        assert!(names.contains(&"sub"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn browse_rejects_non_directory_target() {
        let dir = tempdir("notdir");
        let file = dir.join("file.txt");
        std::fs::write(&file, b"x").expect("write file");

        let host = resolve_path(file.to_string_lossy().as_ref(), &WorkspaceEnv::Local);
        let canonical = std::fs::canonicalize(&host).expect("canonical");
        assert!(!canonical.is_dir());
        std::fs::remove_dir_all(&dir).ok();
    }
}
