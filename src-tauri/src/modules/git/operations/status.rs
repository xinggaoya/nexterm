use std::ffi::OsString;

use crate::modules::git::errors::{GitError, Result};
use crate::modules::git::parser::parse_porcelain_v2;
use crate::modules::git::process::{
    ensure_git_available, ensure_success, git_show_text, git_stdout_line_opt, read_text_file,
    run_git,
};
use crate::modules::git::types::{
    GitChangedFile, GitDiffContentResult, GitDiffResult, GitPanelSnapshot, GitRepoInfo,
    GitStatusSnapshot, TextSource, DEFAULT_TIMEOUT_SECS, MAX_CHANGED_FILES,
};
use crate::modules::git::utils::{canonical_dir, resolve_within_repo, ResolvedGitDirectory};
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

use super::{pathspec, pathspec_from_input, resolve_repo_in_authorized, with_repo};

pub fn resolve_repo(
    registry: &WorkspaceRegistry,
    cwd: &str,
    workspace: &WorkspaceEnv,
) -> Result<Option<GitRepoInfo>> {
    let cwd = canonical_dir(registry, cwd, workspace)?;
    if !registry.is_authorized(&cwd.local_path) {
        return Err(GitError::PathOutsideWorkspace(cwd.local_path));
    }
    ensure_git_available(&cwd.workspace)?;
    resolve_repo_in_authorized(registry, &cwd)
}

// 注:与其他 operations 一致,`workspace` 统一放在参数列表末尾,
// 便于与 commands.rs 的宏包装一一对应。
pub fn panel_snapshot(
    registry: &WorkspaceRegistry,
    cwd: &str,
    untracked_files: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<GitPanelSnapshot> {
    let cwd = canonical_dir(registry, cwd, workspace)?;
    if !registry.is_authorized(&cwd.local_path) {
        return Err(GitError::PathOutsideWorkspace(cwd.local_path));
    }
    ensure_git_available(&cwd.workspace)?;
    let Some(root_line) = git_stdout_line_opt(
        &cwd.workspace,
        &cwd.git_path,
        ["rev-parse", "--show-toplevel"],
    )?
    else {
        return Ok(GitPanelSnapshot {
            repo: None,
            status: None,
        });
    };
    let canonical_root = canonical_dir(registry, &root_line, &cwd.workspace)?;
    let _ = registry.authorize(&canonical_root.local_path);

    let status = status_inner(&canonical_root, untracked_files)?;
    let repo = GitRepoInfo {
        repo_root: canonical_root.git_path.clone(),
        branch: status.branch.clone(),
        upstream: status.upstream.clone(),
        is_detached: status.is_detached,
    };
    Ok(GitPanelSnapshot {
        repo: Some(repo),
        status: Some(status),
    })
}

pub fn status(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    untracked_files: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<GitStatusSnapshot> {
    with_repo(registry, repo_root, workspace, |repo_root| {
        status_inner(repo_root, untracked_files)
    })
}

fn status_inner(
    repo_root: &ResolvedGitDirectory,
    untracked_files: Option<&str>,
) -> Result<GitStatusSnapshot> {
    // 默认 `normal`:只查直接未跟踪文件(目录本身),不再递归
    // 展开 untracked 内容。`all` 在 monorepo 首次开目录时会
    // 把整个 node_modules / dist 树扫一遍,单次 50-200ms 起步。
    // 用户主动点 "show untracked all" 时(由前端传 `untracked_files`
    // 进来)再切到 `all`。
    let untracked_arg = match untracked_files {
        Some(v) if v == "all" || v == "normal" || v == "none" => v,
        _ => "normal",
    };
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        [
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            &format!("--untracked-files={untracked_arg}"),
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git status failed")?;

    let stdout = std::str::from_utf8(&output.stdout).unwrap_or("");
    let parsed = parse_porcelain_v2(stdout);

    let (changed_files, truncated_by_count) = apply_changed_files_limit(parsed.files);
    let truncated = output.truncated || truncated_by_count;

    Ok(GitStatusSnapshot {
        repo_root: repo_root.git_path.clone(),
        branch: parsed.branch,
        upstream: parsed.upstream,
        ahead: parsed.ahead,
        behind: parsed.behind,
        is_detached: parsed.is_detached,
        truncated,
        changed_files,
    })
}

/// Bound the number of changed files surfaced to the UI. Returns the
/// truncated list and a flag indicating whether any entries were dropped.
/// See `MAX_CHANGED_FILES` for the rationale.
pub(crate) fn apply_changed_files_limit(files: Vec<GitChangedFile>) -> (Vec<GitChangedFile>, bool) {
    if files.len() <= MAX_CHANGED_FILES {
        return (files, false);
    }
    let mut truncated = files;
    truncated.truncate(MAX_CHANGED_FILES);
    (truncated, true)
}

pub fn diff(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    path: Option<&str>,
    staged: bool,
    workspace: &WorkspaceEnv,
) -> Result<GitDiffResult> {
    with_repo(registry, repo_root, workspace, |repo_root| {
        diff_inner(repo_root, path, staged)
    })
}

fn diff_inner(
    repo_root: &ResolvedGitDirectory,
    path: Option<&str>,
    staged: bool,
) -> Result<GitDiffResult> {
    let mut args: Vec<OsString> = vec!["diff".into(), "--no-ext-diff".into()];
    if staged {
        args.push("--cached".into());
    }
    let pathspec = match path.filter(|p| !p.is_empty()) {
        Some(p) => Some(pathspec_from_input(&repo_root.local_path, p)?),
        None => None,
    };
    if let Some(spec) = pathspec.as_ref() {
        args.push("--".into());
        args.push(spec.clone().into());
    }
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        args,
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git diff failed")?;

    let diff_text = match String::from_utf8(output.stdout) {
        Ok(text) => text,
        Err(e) => String::from_utf8_lossy(&e.into_bytes()).into_owned(),
    };
    Ok(GitDiffResult {
        diff_text,
        truncated: output.truncated,
    })
}

pub fn diff_content(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    path: &str,
    staged: bool,
    original_path: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<GitDiffContentResult> {
    with_repo(registry, repo_root, workspace, |repo_root| {
        let worktree_path = resolve_within_repo(&repo_root.local_path, path)?;
        let rel_path = pathspec(&repo_root.local_path, &worktree_path);

        let original_rel = match original_path {
            Some(orig) if !orig.is_empty() => {
                let resolved = resolve_within_repo(&repo_root.local_path, orig)?;
                Some(pathspec(&repo_root.local_path, &resolved))
            }
            _ => None,
        };

        let original = if staged {
            let spec = original_rel.as_deref().unwrap_or(&rel_path);
            git_show_text(
                &repo_root.workspace,
                &repo_root.git_path,
                &format!("HEAD:{spec}"),
            )?
        } else {
            git_show_text(
                &repo_root.workspace,
                &repo_root.git_path,
                &format!(":{rel_path}"),
            )?
        };
        let modified = if staged {
            git_show_text(
                &repo_root.workspace,
                &repo_root.git_path,
                &format!(":{rel_path}"),
            )?
        } else {
            read_text_file(&worktree_path)?
        };
        let patch = diff_inner(repo_root, Some(&rel_path), staged)?;
        let is_binary =
            matches!(original, TextSource::Binary) || matches!(modified, TextSource::Binary);

        Ok(GitDiffContentResult {
            original_content: original.into_text(),
            modified_content: modified.into_text(),
            is_binary,
            fallback_patch: patch.diff_text,
            truncated: patch.truncated,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::apply_changed_files_limit;
    use crate::modules::git::types::{GitChangedFile, MAX_CHANGED_FILES};

    fn make_files(count: usize) -> Vec<GitChangedFile> {
        (0..count)
            .map(|i| GitChangedFile {
                path: format!("file_{i}.txt"),
                original_path: None,
                index_status: " ".into(),
                worktree_status: "M".into(),
                staged: false,
                unstaged: true,
                untracked: false,
                status_label: "Modified".into(),
            })
            .collect()
    }

    #[test]
    fn changed_files_limit_returns_input_when_under_cap() {
        let files = make_files(100);
        let original_len = files.len();
        let (kept, truncated) = apply_changed_files_limit(files);
        assert_eq!(kept.len(), original_len);
        assert!(!truncated);
    }

    #[test]
    fn changed_files_limit_truncates_at_cap() {
        let files = make_files(MAX_CHANGED_FILES + 250);
        let (kept, truncated) = apply_changed_files_limit(files);
        assert_eq!(kept.len(), MAX_CHANGED_FILES);
        assert!(truncated);
    }

    #[test]
    fn changed_files_limit_keeps_first_entries() {
        let files = make_files(MAX_CHANGED_FILES + 5);
        let (kept, truncated) = apply_changed_files_limit(files);
        assert_eq!(kept.len(), MAX_CHANGED_FILES);
        assert!(truncated);
        // Order is preserved: first entry kept is the first one we built.
        assert_eq!(kept.first().map(|f| f.path.as_str()), Some("file_0.txt"));
    }
}
