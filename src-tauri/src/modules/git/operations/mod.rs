mod branch;
mod commit;
mod discover;
mod log;
mod remote;
mod stage;
mod stash;
mod status;
mod tag;
#[cfg(test)]
pub(crate) mod test_support;

pub use branch::*;
pub use commit::*;
pub use discover::*;
pub use log::*;
pub use remote::*;
pub use stage::*;
pub use stash::*;
pub use status::*;
pub use tag::*;

use std::path::Path;

use crate::modules::git::errors::{GitError, Result};
use crate::modules::git::process::{ensure_git_available, git_stdout_line_opt, git_stdout_lines};
use crate::modules::git::types::{GitOutput, GitRepoInfo};
use crate::modules::git::utils::{
    authorized_repo_root, canonical_dir, resolve_within_repo, ResolvedGitDirectory,
};
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

/// git 操作的公共前奏:规范化 repo_root → 校验工作区授权 →
/// 确认 git 可用,然后把解析出的仓库目录交给 `body`。仅在上述
/// 前奏完全一致的 operations 上使用;cwd 类入口(`resolve_repo` /
/// `panel_snapshot`,先规范化 cwd 再授权)顺序不同,保持原样。
pub(crate) fn with_repo<T>(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
    body: impl FnOnce(&ResolvedGitDirectory) -> Result<T>,
) -> Result<T> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    body(&repo_root)
}

fn resolve_repo_in_authorized(
    registry: &WorkspaceRegistry,
    cwd: &ResolvedGitDirectory,
) -> Result<Option<GitRepoInfo>> {
    let Some(root_line) = git_stdout_line_opt(
        &cwd.workspace,
        &cwd.git_path,
        ["rev-parse", "--show-toplevel"],
    )?
    else {
        return Ok(None);
    };
    let canonical_root = canonical_dir(registry, &root_line, &cwd.workspace)?;
    let _ = registry.authorize(&canonical_root.local_path);

    let basics = git_stdout_lines(
        &canonical_root.workspace,
        &canonical_root.git_path,
        ["rev-parse", "--abbrev-ref", "HEAD"],
    )?;
    let head = basics.into_iter().next().ok_or(GitError::CommandFailed {
        context: "failed to resolve HEAD",
        detail: String::new(),
    })?;

    let upstream = git_stdout_line_opt(
        &canonical_root.workspace,
        &canonical_root.git_path,
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )?;

    Ok(Some(GitRepoInfo {
        repo_root: canonical_root.git_path,
        branch: head.clone(),
        upstream,
        is_detached: head == "HEAD",
    }))
}

fn sha_is_safe(sha: &str) -> bool {
    !sha.is_empty() && sha.len() <= 64 && sha.chars().all(|c| c.is_ascii_hexdigit())
}

fn validate_git_name(input: &str, label: &'static str) -> Result<String> {
    let trimmed = input.trim();
    if trimmed.is_empty()
        || trimmed.starts_with('-')
        || trimmed.contains('\0')
        || trimmed.chars().any(char::is_control)
    {
        return Err(GitError::command("invalid git argument", label));
    }
    Ok(trimmed.to_string())
}

fn combined_output_text(output: &GitOutput) -> String {
    let mut text = String::new();
    text.push_str(&String::from_utf8_lossy(&output.stdout));
    if !output.stderr.is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    text.trim().to_string()
}

fn pathspec_from_input(repo_root: &Path, rel: &str) -> Result<String> {
    let resolved = resolve_within_repo(repo_root, rel)?;
    Ok(pathspec(repo_root, &resolved))
}

fn pathspec(repo_root: &Path, absolute: &Path) -> String {
    absolute
        .strip_prefix(repo_root)
        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| absolute.to_string_lossy().replace('\\', "/"))
}
