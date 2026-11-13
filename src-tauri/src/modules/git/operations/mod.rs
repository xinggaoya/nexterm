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
use crate::modules::git::process::{ensure_git_available, git_stdout_lines_lenient};
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
    // 一次 `rev-parse` 拿到 root / HEAD / upstream 三件事。
    //
    // 三件事必须一次问完，因为 `git_discover_repositories` 会对**每个**
    // 候选仓库调本函数（默认上限 32 个）—— 每多一次 rev-parse 就是多一次
    // fork/exec 的内核态开销，在多 workspace 场景下会把 CPU 打满。
    //
    // 参数顺序有意义：`--show-toplevel` 与 `--abbrev-ref HEAD` 必须排在
    // `@{u}` 之前 —— rev-parse 逐个解析参数，遇到无法解析的就停下报错，
    // 而**已经解析成功的参数结果早已写进 stdout**。所以「没有 upstream」
    // 时本命令以非零码退出，但 stdout 里仍有 root 与 HEAD 两行，
    // 这里用宽松读取（忽略退出码）把它们取回来。
    let lines = git_stdout_lines_lenient(
        &cwd.workspace,
        &cwd.git_path,
        [
            "rev-parse",
            "--show-toplevel",
            "--abbrev-ref",
            "HEAD",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{u}",
        ],
    )?;
    let root_line = lines.first().cloned().ok_or(GitError::CommandFailed {
        context: "failed to resolve repository root",
        detail: String::new(),
    })?;
    let canonical_root = canonical_dir(registry, &root_line, &cwd.workspace)?;
    let _ = registry.authorize(&canonical_root.local_path);

    let head = lines.get(1).cloned().ok_or(GitError::CommandFailed {
        context: "failed to resolve HEAD",
        detail: String::new(),
    })?;

    // upstream 缺失时第三行为空（`@{u}` 解析失败 → 无输出）。
    let upstream = lines.get(2).cloned().filter(|value| !value.is_empty());

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
