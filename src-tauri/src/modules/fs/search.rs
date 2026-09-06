use ignore::WalkBuilder;
use serde::Serialize;

use super::to_canon;
use crate::modules::fs::wsl_ops;
use crate::modules::workspace::{resolve_path, WorkspaceEnv};

#[derive(Serialize)]
pub struct SearchHit {
    /// Absolute path of the matched file.
    pub path: String,
    /// Path relative to the search root, for display.
    pub rel: String,
    /// File name only.
    pub name: String,
    pub is_dir: bool,
}

#[derive(Serialize)]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    /// True if the scan stopped early (entry budget or hit cap reached).
    pub truncated: bool,
}

/// Hard cap on entries the walker is allowed to visit before bailing. Protects
/// against pathological roots like $HOME where there's no .gitignore and the
/// tree is effectively unbounded.
const MAX_SCANNED: usize = 50_000;

/// Directory names pruned unconditionally — they're rarely useful in a
/// file-explorer search and they dominate scan time when present.
const PRUNE_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".cache",
    ".venv",
    "__pycache__",
];

/// SSH 分支含网络 I/O(超时可达数十秒):整体下沉阻塞线程池,避免冻结
/// UI;本地/WSL 的同步逻辑原样保留在闭包内。
#[tauri::command]
pub async fn fs_search(
    root: String,
    query: String,
    limit: Option<usize>,
    workspace: Option<WorkspaceEnv>,
    show_hidden: Option<bool>,
) -> Result<SearchResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        fs_search_blocking(root, query, limit, workspace, show_hidden)
    })
    .await
    .map_err(|error| format!("fs_search background task failed: {error}"))?
}

fn fs_search_blocking(
    root: String,
    query: String,
    limit: Option<usize>,
    workspace: Option<WorkspaceEnv>,
    show_hidden: Option<bool>,
) -> Result<SearchResult, String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(SearchResult {
            hits: Vec::new(),
            truncated: false,
        });
    }
    let cap = limit.unwrap_or(200).min(1000);
    let show_hidden = show_hidden.unwrap_or(false);
    let workspace = WorkspaceEnv::from_option(workspace);
    // Phase 0b/2:WSL 非 drvfs 与 SSH 根经 agent 搜索(原生路径语义),
    // agent 不可用时回退宿主 UNC 遍历。
    if let WorkspaceEnv::Wsl { distro } = &workspace {
        if wsl_ops::should_use_wsl_ops(&root, &workspace) {
            if let Ok(parsed) =
                crate::modules::agent::search(distro, &root, &q, Some(cap), show_hidden, &root)
            {
                let hits = parsed
                    .hits
                    .into_iter()
                    .map(|hit| SearchHit {
                        path: hit.path,
                        rel: hit.rel,
                        name: hit.name,
                        is_dir: hit.is_dir,
                    })
                    .collect();
                return Ok(SearchResult {
                    hits,
                    truncated: parsed.truncated,
                });
            }
        }
    }
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        let parsed = tauri::async_runtime::block_on(crate::modules::ssh::remote::remote_search(
            profile_id,
            &root,
            &q,
            Some(cap),
            show_hidden,
            &root,
        ))?;
        let hits = parsed
            .hits
            .into_iter()
            .map(|hit| SearchHit {
                path: hit.path,
                rel: hit.rel,
                name: hit.name,
                is_dir: hit.is_dir,
            })
            .collect();
        return Ok(SearchResult {
            hits,
            truncated: parsed.truncated,
        });
    }
    let root_path = resolve_path(&root, &workspace);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }

    let mut out: Vec<SearchHit> = Vec::with_capacity(cap.min(64));
    let mut scanned: usize = 0;
    let mut truncated = false;

    let walker = WalkBuilder::new(&root_path)
        .hidden(!show_hidden)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .parents(true)
        .follow_links(false)
        .filter_entry(|dent| {
            // Prune known-heavy dirs even when no .gitignore is present (e.g.
            // searching from $HOME).
            if dent.depth() == 0 {
                return true;
            }
            match dent.file_name().to_str() {
                Some(name) => !PRUNE_DIRS.contains(&name),
                None => true,
            }
        })
        .build();

    for dent in walker.flatten() {
        scanned += 1;
        if scanned > MAX_SCANNED {
            truncated = true;
            break;
        }
        if out.len() >= cap {
            truncated = true;
            break;
        }
        let path = dent.path();
        if path == root_path {
            continue;
        }
        let rel = match path.strip_prefix(&root_path) {
            Ok(r) => to_canon(r),
            Err(_) => continue,
        };
        if !rel.to_lowercase().contains(&q) {
            continue;
        }
        let name = path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        let is_dir = dent.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(SearchHit {
            path: display_path(path, &root_path, &root, &workspace),
            rel,
            name,
            is_dir,
        });
    }

    // Rank: filename matches first, then shorter relative paths.
    out.sort_by(|a, b| {
        let an = a.name.to_lowercase().contains(&q);
        let bn = b.name.to_lowercase().contains(&q);
        bn.cmp(&an).then(a.rel.len().cmp(&b.rel.len()))
    });

    Ok(SearchResult {
        hits: out,
        truncated,
    })
}

#[derive(Serialize)]
pub struct ListFilesResult {
    pub files: Vec<String>,
    pub truncated: bool,
}

#[tauri::command]
pub async fn fs_list_files(
    root: String,
    limit: Option<usize>,
    max_depth: Option<usize>,
    workspace: Option<WorkspaceEnv>,
    show_hidden: Option<bool>,
) -> Result<ListFilesResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        fs_list_files_blocking(root, limit, max_depth, workspace, show_hidden)
    })
    .await
    .map_err(|error| format!("fs_list_files background task failed: {error}"))?
}

fn fs_list_files_blocking(
    root: String,
    limit: Option<usize>,
    max_depth: Option<usize>,
    workspace: Option<WorkspaceEnv>,
    show_hidden: Option<bool>,
) -> Result<ListFilesResult, String> {
    const DEFAULT_LIMIT: usize = 2_000;
    const HARD_LIMIT: usize = 10_000;
    const DEFAULT_DEPTH: usize = 8;
    const HARD_DEPTH: usize = 16;

    let cap = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, HARD_LIMIT);
    let depth = max_depth.unwrap_or(DEFAULT_DEPTH).clamp(1, HARD_DEPTH);
    let show_hidden = show_hidden.unwrap_or(false);
    let workspace = WorkspaceEnv::from_option(workspace);
    if let WorkspaceEnv::Wsl { distro } = &workspace {
        if wsl_ops::should_use_wsl_ops(&root, &workspace) {
            if let Ok((files, truncated)) =
                crate::modules::agent::list_files(distro, &root, Some(cap), Some(depth), show_hidden)
            {
                return Ok(ListFilesResult { files, truncated });
            }
        }
    }
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        let (files, truncated) = tauri::async_runtime::block_on(
            crate::modules::ssh::remote::remote_list_files(
                profile_id,
                &root,
                Some(cap),
                Some(depth),
                show_hidden,
            ),
        )?;
        return Ok(ListFilesResult { files, truncated });
    }
    let root_path = resolve_path(&root, &workspace);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }

    let walker = WalkBuilder::new(&root_path)
        .hidden(!show_hidden)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .parents(true)
        .follow_links(false)
        .max_depth(Some(depth))
        .filter_entry(|dent| {
            if dent.depth() == 0 {
                return true;
            }
            match dent.file_name().to_str() {
                Some(name) => !PRUNE_DIRS.contains(&name),
                None => true,
            }
        })
        .build();

    let mut files: Vec<String> = Vec::with_capacity(cap.min(256));
    let mut scanned: usize = 0;
    let mut truncated = false;

    for dent in walker.flatten() {
        scanned += 1;
        if scanned > MAX_SCANNED {
            truncated = true;
            break;
        }
        let is_file = dent.file_type().map(|t| t.is_file()).unwrap_or(false);
        if !is_file {
            continue;
        }
        let path = dent.path();
        let rel = match path.strip_prefix(&root_path) {
            Ok(r) => to_canon(r),
            Err(_) => continue,
        };
        if rel.is_empty() {
            continue;
        }
        files.push(rel);
        if files.len() >= cap {
            truncated = true;
            break;
        }
    }

    files.sort_by_key(|a| a.to_lowercase());
    Ok(ListFilesResult { files, truncated })
}

fn display_path(
    path: &std::path::Path,
    root_path: &std::path::Path,
    root_display: &str,
    workspace: &WorkspaceEnv,
) -> String {
    if workspace.is_wsl() {
        if let Ok(rel) = path.strip_prefix(root_path) {
            let rel = to_canon(rel);
            return if rel.is_empty() {
                root_display.to_string()
            } else if root_display.ends_with('/') {
                format!("{root_display}{rel}")
            } else {
                format!("{root_display}/{rel}")
            };
        }
    }
    to_canon(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_path_joins_root_display_for_wsl_workspaces() {
        let root = std::path::Path::new("/home/dev/repo");
        let file = root.join("src/main.rs");
        let wsl = WorkspaceEnv::Wsl {
            distro: "Ubuntu".to_string(),
        };
        assert_eq!(
            display_path(&file, root, "//wsl$/Ubuntu/home/dev/repo", &wsl),
            "//wsl$/Ubuntu/home/dev/repo/src/main.rs"
        );
    }

    #[test]
    fn display_path_falls_back_to_canonical_path_for_local_workspaces() {
        let root = std::path::Path::new("/tmp/repo");
        assert_eq!(
            display_path(&root.join("a.txt"), root, "/tmp/repo", &WorkspaceEnv::Local),
            "/tmp/repo/a.txt"
        );
    }
}
