use std::collections::{HashSet, VecDeque};
use std::ffi::{OsStr, OsString};
use std::path::Path;

use crate::modules::git::errors::{GitError, Result};
use crate::modules::git::parser::{
    parse_branch_lines, parse_fetch_summary, parse_log_refs, parse_porcelain_v2,
    parse_pull_summary, parse_stash_lines,
};
use crate::modules::git::process::{
    ensure_git_available, ensure_success, git_show_text, git_stdout_line_opt, git_stdout_lines,
    read_text_file, run_git,
};
use crate::modules::git::types::{
    DiscardEntry, GitBranchInfo, GitBranchResult, GitCommitFileChange, GitCommitResult,
    GitDiffContentResult, GitDiffResult, GitFetchResult, GitLogEntry, GitLogOptions, GitLogPage,
    GitOutput, GitPanelSnapshot, GitPullResult, GitPushResult, GitRemoteInfo, GitRemoteInput,
    GitRemoteUrlUpdate, GitRepoInfo, GitRepositoryDiscovery, GitStashEntry, GitStashPushOptions,
    GitStashResult, GitStatusSnapshot, GitWorkspaceRepo, TextSource, DEFAULT_TIMEOUT_SECS,
    MAX_CHANGED_FILES, NETWORK_TIMEOUT_SECS,
};
use crate::modules::git::utils::{
    authorized_repo_root, canonical_dir, resolve_within_repo, split_upstream, ResolvedGitDirectory,
};
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

const BRANCH_LIST_FORMAT_ARG: &str = "--format=%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(refname)%1f%(objectname:short)%1f%(subject)%1f%(authordate:unix)%1f%(upstream:track,nobracket)";

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

pub fn panel_snapshot(
    registry: &WorkspaceRegistry,
    cwd: &str,
    workspace: &WorkspaceEnv,
    untracked_files: Option<&str>,
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
    workspace: &WorkspaceEnv,
    untracked_files: Option<&str>,
) -> Result<GitStatusSnapshot> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    status_inner(&repo_root, untracked_files)
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
pub(crate) fn apply_changed_files_limit(
    files: Vec<crate::modules::git::types::GitChangedFile>,
) -> (Vec<crate::modules::git::types::GitChangedFile>, bool) {
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
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    diff_inner(&repo_root, path, staged)
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
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
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
    let patch = diff_inner(&repo_root, Some(&rel_path), staged)?;
    let is_binary =
        matches!(original, TextSource::Binary) || matches!(modified, TextSource::Binary);

    Ok(GitDiffContentResult {
        original_content: original.into_text(),
        modified_content: modified.into_text(),
        is_binary,
        fallback_patch: patch.diff_text,
        truncated: patch.truncated,
    })
}

pub fn stage(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    paths: &[String],
    workspace: &WorkspaceEnv,
) -> Result<()> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    if paths.is_empty() {
        return Ok(());
    }
    let resolved = resolve_pathspecs(&repo_root.local_path, paths)?;
    let mut args: Vec<OsString> = vec!["add".into(), "--".into()];
    for p in &resolved {
        args.push(p.clone().into());
    }
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        args,
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git add failed")
}

pub fn unstage(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    paths: &[String],
    workspace: &WorkspaceEnv,
) -> Result<()> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    if paths.is_empty() {
        return Ok(());
    }
    let resolved = resolve_pathspecs(&repo_root.local_path, paths)?;
    let mut reset_args: Vec<OsString> = vec!["reset".into(), "HEAD".into(), "--".into()];
    for p in &resolved {
        reset_args.push(p.clone().into());
    }
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        reset_args,
        DEFAULT_TIMEOUT_SECS,
    )?;
    if output.exit_code == Some(0) {
        return Ok(());
    }
    if !looks_like_no_head(&output) {
        return ensure_success(&output, "git reset failed");
    }
    let mut rm_args: Vec<OsString> = vec!["rm".into(), "--cached".into(), "-r".into(), "--".into()];
    for p in &resolved {
        rm_args.push(p.clone().into());
    }
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        rm_args,
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git rm --cached failed")
}

fn looks_like_no_head(output: &GitOutput) -> bool {
    let stderr = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
    stderr.contains("ambiguous argument 'head'")
        || stderr.contains("unknown revision")
        || stderr.contains("does not have any commits yet")
        || stderr.contains("bad revision 'head'")
}

pub fn discard(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    entries: &[DiscardEntry],
    workspace: &WorkspaceEnv,
) -> Result<()> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    if entries.is_empty() {
        return Ok(());
    }

    let mut tracked: Vec<String> = Vec::with_capacity(entries.len());
    let mut untracked: Vec<String> = Vec::new();
    for entry in entries {
        let resolved = pathspec_from_input(&repo_root.local_path, &entry.path)?;
        if entry.untracked {
            untracked.push(resolved);
        } else {
            tracked.push(resolved);
        }
    }

    if !tracked.is_empty() {
        let mut args: Vec<OsString> = vec!["restore".into(), "--worktree".into(), "--".into()];
        for p in &tracked {
            args.push(p.clone().into());
        }
        let output = run_git(
            &repo_root.workspace,
            Some(&repo_root.git_path),
            args,
            DEFAULT_TIMEOUT_SECS,
        )?;
        ensure_success(&output, "git restore failed")?;
    }

    if !untracked.is_empty() {
        let mut args: Vec<OsString> = vec!["clean".into(), "-f".into(), "-d".into(), "--".into()];
        for p in &untracked {
            args.push(p.clone().into());
        }
        let output = run_git(
            &repo_root.workspace,
            Some(&repo_root.git_path),
            args,
            DEFAULT_TIMEOUT_SECS,
        )?;
        ensure_success(&output, "git clean failed")?;
    }

    Ok(())
}

pub fn commit(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    message: &str,
    workspace: &WorkspaceEnv,
) -> Result<GitCommitResult> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err(GitError::EmptyCommitMessage);
    }

    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        [OsStr::new("commit"), OsStr::new("-m"), OsStr::new(trimmed)],
        DEFAULT_TIMEOUT_SECS,
    )?;
    if output.exit_code != Some(0) && nothing_to_commit(&output) {
        return Err(GitError::command("git commit", "nothing staged"));
    }
    ensure_success(&output, "git commit failed")?;

    let combined = git_stdout_lines(
        &repo_root.workspace,
        &repo_root.git_path,
        ["show", "-s", "--format=%H%n%s", "HEAD"],
    )?;
    let sha = combined.first().cloned().ok_or(GitError::CommandFailed {
        context: "failed to resolve commit sha",
        detail: String::new(),
    })?;
    let summary = combined.get(1).cloned().unwrap_or_default();

    Ok(GitCommitResult {
        commit_sha: sha,
        summary,
    })
}

pub fn push(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
) -> Result<GitPushResult> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;

    let upstream = git_stdout_line_opt(
        &repo_root.workspace,
        &repo_root.git_path,
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )?;
    if upstream.is_none() {
        return Err(GitError::NoUpstream);
    }

    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        ["push"],
        NETWORK_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git push failed")?;

    let upstream = upstream.unwrap();
    let (remote, branch) = split_upstream(&upstream);
    Ok(GitPushResult {
        remote,
        branch,
        pushed: true,
    })
}

pub fn branch_list(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
) -> Result<Vec<GitBranchInfo>> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    let lines = git_stdout_lines(
        &repo_root.workspace,
        &repo_root.git_path,
        [
            "for-each-ref",
            BRANCH_LIST_FORMAT_ARG,
            "refs/heads",
            "refs/remotes",
        ],
    )?;
    Ok(parse_branch_lines(&lines.join("\n")))
}

pub fn checkout_branch(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    branch: &str,
    remote: bool,
    workspace: &WorkspaceEnv,
) -> Result<GitBranchResult> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    let branch = validate_git_name(branch, "branch")?;
    // When the caller asked for a remote branch (e.g. `origin/main`) but a
    // local tracking branch with the short name already exists, prefer the
    // existing local branch to avoid creating a second `main` worktree.
    // Strip one `remote/` prefix only; this matches what `for-each-ref`
    // emits and what the frontend will see in the branch list.
    let args: Vec<OsString> = if remote {
        let local_name = branch
            .strip_prefix("origin/")
            .or_else(|| branch.split_once('/').map(|(_, rest)| rest))
            .unwrap_or(branch.as_str());
        let local_exists = git_stdout_line_opt(
            &repo_root.workspace,
            &repo_root.git_path,
            ["rev-parse", "--verify", &format!("refs/heads/{local_name}")],
        )?
        .is_some();
        if local_exists {
            vec!["switch".into(), local_name.to_string().into()]
        } else {
            // `switch <name>` alone would fail because no local branch
            // matches `origin/main`. `--track` is only valid for the full
            // remote ref, so feed the upstream name (e.g. `origin/main`).
            vec!["switch".into(), "--track".into(), branch.clone().into()]
        }
    } else {
        vec!["switch".into(), branch.clone().into()]
    };
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        args,
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git switch failed")?;
    Ok(GitBranchResult { branch })
}

pub fn create_branch(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    branch: &str,
    workspace: &WorkspaceEnv,
) -> Result<GitBranchResult> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    let branch = validate_git_name(branch, "branch")?;
    let check = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        [
            OsStr::new("check-ref-format"),
            OsStr::new("--branch"),
            OsStr::new(&branch),
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&check, "invalid branch name")?;
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        [OsStr::new("switch"), OsStr::new("-c"), OsStr::new(&branch)],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git switch -c failed")?;
    Ok(GitBranchResult { branch })
}

pub fn stash_list(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
) -> Result<Vec<GitStashEntry>> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    // `%H` is the full SHA; `%h` is the abbreviated form. Both go in the
    // DTO so destructive ops can use the full hash for selector stability
    // checks while the UI keeps the short hash readable.
    let lines = git_stdout_lines(
        &repo_root.workspace,
        &repo_root.git_path,
        ["stash", "list", "--format=%gd%x1f%H%x1f%h%x1f%cr%x1f%s"],
    )?;
    Ok(parse_stash_lines(&lines.join("\n")))
}

pub fn stash_push(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    options: &GitStashPushOptions,
    workspace: &WorkspaceEnv,
) -> Result<GitStashResult> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    let mut args: Vec<OsString> = vec!["stash".into(), "push".into()];
    if options.include_untracked {
        args.push("-u".into());
    }
    if options.keep_index {
        args.push("-k".into());
    }
    if let Some(message) = options
        .message
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
    {
        args.push("-m".into());
        args.push(message.into());
    }
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        args,
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git stash push failed")?;
    let message = combined_output_text(&output);
    let stashed = !message.to_ascii_lowercase().contains("no local changes");
    Ok(GitStashResult {
        stashed,
        message: fallback_message(message, "Saved working directory"),
    })
}

pub fn stash_pop(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    selector: &str,
    expected_sha: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<GitStashResult> {
    run_stash_selector_command(registry, repo_root, "pop", selector, expected_sha, workspace)
}

pub fn stash_drop(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    selector: &str,
    expected_sha: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<GitStashResult> {
    run_stash_selector_command(registry, repo_root, "drop", selector, expected_sha, workspace)
}

pub fn stash_apply(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    selector: &str,
    expected_sha: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<GitStashResult> {
    run_stash_selector_command(
        registry,
        repo_root,
        "apply",
        selector,
        expected_sha,
        workspace,
    )
}

fn run_stash_selector_command(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    action: &'static str,
    selector: &str,
    expected_sha: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<GitStashResult> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    let selector = validate_git_name(selector, "stash")?;
    if let Some(expected) = expected_sha {
        if !sha_is_safe(expected) {
            return Err(GitError::command(
                "git stash operation",
                "invalid expected_sha",
            ));
        }
        let resolved = git_stdout_line_opt(
            &repo_root.workspace,
            &repo_root.git_path,
            ["rev-parse", "--verify", &format!("{selector}^{{commit}}")],
        )?;
        match resolved.as_deref() {
            Some(actual) if actual.eq_ignore_ascii_case(expected) => {}
            Some(actual) => {
                return Err(GitError::command(
                    "git stash operation",
                    format!(
                        "stash selector no longer matches expected commit (expected {expected}, got {actual})"
                    ),
                ));
            }
            None => {
                return Err(GitError::command(
                    "git stash operation",
                    "stash selector could not be resolved",
                ));
            }
        }
    }
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        [
            OsStr::new("stash"),
            OsStr::new(action),
            OsStr::new(&selector),
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git stash operation failed")?;
    let message = combined_output_text(&output);
    Ok(GitStashResult {
        stashed: true,
        message: fallback_message(message, "Updated stash"),
    })
}

const LOG_FORMAT: &str = "%H%x1f%an%x1f%ae%x1f%at%x1f%P%x1f%s%x1f%d";
const MAX_LOG_LIMIT: u32 = 200;
const DEFAULT_LOG_LIMIT: u32 = 30;

/// Validate a ref name before handing it to `git log`. Git accepts a broad
/// grammar (branches, tags, remotes, peeled SHAs, relative refs like
/// `HEAD~3`), so we only block the bytes that would let a caller escape the
/// argv: control characters, leading `-` (which could be mistaken for an
/// option), and embedded NULs.
fn validate_log_ref_name(name: &str) -> Result<String> {
    if name.is_empty()
        || name.starts_with('-')
        || name.contains('\0')
        || name.chars().any(char::is_control)
    {
        return Err(GitError::command("git log", "invalid ref name"));
    }
    Ok(name.to_string())
}

/// Returned log page that still uses the old vector contract. Kept private
/// during the implementation phase while the new GitLogPage shape is wired
/// through tests; this exists only so the `log` function compiles while the
/// page contract is being introduced.
fn empty_log_page() -> GitLogPage {
    GitLogPage {
        entries: Vec::new(),
        has_more: false,
    }
}

/// Build a short-name → kind lookup from `git for-each-ref` so that the
/// `--decorate=short` output (which only gives us `feature/x` or
/// `origin/main`, both of which contain `/`) can still be classified. The
/// insertion order matches git's own decorate priority: HEAD first,
/// `refs/heads` next, then `refs/remotes`, then `refs/tags`. A short name
/// that exists in two namespaces resolves to the higher-priority kind —
/// exactly how `git log --decorate` itself displays it.
fn collect_ref_kind_map(repo_root: &ResolvedGitDirectory) -> Result<std::collections::HashMap<String, &'static str>> {
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        [
            OsStr::new("for-each-ref"),
            OsStr::new("--format=%(refname:short)%1f%(refname)"),
            OsStr::new("refs/heads"),
            OsStr::new("refs/remotes"),
            OsStr::new("refs/tags"),
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    if output.timed_out {
        return Err(GitError::TimedOut("git for-each-ref"));
    }
    if output.exit_code != Some(0) {
        // No refs yet (empty repo). Return an empty map so callers fall
        // through to the heuristic in the parser.
        return Ok(std::collections::HashMap::new());
    }
    let stdout = std::str::from_utf8(&output.stdout).unwrap_or("");
    let mut map: std::collections::HashMap<String, &'static str> =
        std::collections::HashMap::new();
    for line in stdout.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() || !line.contains('\x1f') {
            continue;
        }
        let mut parts = line.splitn(2, '\x1f');
        let short = parts.next().unwrap_or("").to_string();
        let full = parts.next().unwrap_or("");
        if short.is_empty() || full.is_empty() {
            continue;
        }
        let kind = if full.starts_with("refs/heads/") {
            "local-branch"
        } else if full.starts_with("refs/remotes/") {
            "remote-branch"
        } else if full.starts_with("refs/tags/") {
            "tag"
        } else {
            continue;
        };
        // Insertion order wins: `refs/heads` is queried first so local
        // entries already shadow any remote with the same short name.
        map.entry(short).or_insert(kind);
    }
    Ok(map)
}

pub fn log(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    options: &GitLogOptions,
    workspace: &WorkspaceEnv,
) -> Result<GitLogPage> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    let bounded = options
        .limit
        .unwrap_or(DEFAULT_LOG_LIMIT)
        .clamp(1, MAX_LOG_LIMIT);
    let skip = options.offset.unwrap_or(0);
    let format_arg = format!("--format={LOG_FORMAT}");
    // `has_more` is detected by asking for one extra entry beyond the page
    // size. `--max-count` counts only successful commit records, so when
    // there are fewer than `bounded + 1` commits reachable, we know the
    // current page is the last one. This avoids the `<sha>^` cursor pattern
    // that breaks for merge commits and root commits.
    let probe_count_arg = format!("--max-count={}", bounded.saturating_add(1));
    let mut probe_args: Vec<OsString> = vec![
        OsString::from("log"),
        OsString::from("--no-color"),
        OsString::from("--shortstat"),
        OsString::from("--decorate=short"),
        OsString::from(probe_count_arg),
        OsString::from(format_arg),
    ];
    if skip > 0 {
        probe_args.push(OsString::from(format!("--skip={skip}")));
    }
    if options.all {
        probe_args.push(OsString::from("--all"));
    } else if let Some(name) = options.ref_name.as_deref() {
        let validated = validate_log_ref_name(name)?;
        probe_args.push(OsString::from(validated));
    }
    let ref_kind_map = collect_ref_kind_map(&repo_root)?;
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        probe_args,
        DEFAULT_TIMEOUT_SECS,
    )?;
    if output.timed_out {
        return Err(GitError::TimedOut("git log"));
    }
    if output.exit_code != Some(0) {
        let stderr = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
        // When the caller named a specific ref and Git couldn't resolve it,
        // surface that as a focused "ref not found" error rather than the
        // generic command-failed message.
        if !options.all && options.ref_name.is_some() && stderr.contains("unknown revision") {
            return Err(GitError::command(
                "git log",
                format!("ref not found: {}", options.ref_name.as_deref().unwrap_or("")),
            ));
        }
        if stderr.contains("does not have any commits yet")
            || stderr.contains("bad default revision")
            || stderr.contains("unknown revision")
            || stderr.contains("ambiguous argument 'head'")
        {
            return Ok(empty_log_page());
        }
        return ensure_success(&output, "git log failed").map(|_| empty_log_page());
    }
    let stdout = std::str::from_utf8(&output.stdout).unwrap_or("");
    let mut entries: Vec<GitLogEntry> = Vec::with_capacity(bounded as usize);
    // Lines we get back interleave:
    //   <sha>\x1f<author>\x1f<email>\x1f<ts>\x1f<parents>\x1f<subject>\x1f<decorate>
    //   <blank>
    //    5 files changed, 12 insertions(+), 3 deletions(-)
    // Commits without diffstats (root commits, merges with no changes) just
    // skip the shortstat line. Detect commit headers by the presence of
    // the unit-separator we put in the format.
    for raw_line in stdout.lines() {
        let line = raw_line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        if line.contains('\x1f') {
            let mut fields = line.splitn(7, '\x1f');
            let sha = fields.next().unwrap_or("").to_string();
            if !sha_is_safe(&sha) {
                continue;
            }
            let author = fields.next().unwrap_or("").to_string();
            let author_email = fields.next().unwrap_or("").to_string();
            let timestamp = fields.next().unwrap_or("0").parse::<i64>().unwrap_or(0);
            let parents_raw = fields.next().unwrap_or("");
            let parents: Vec<String> = parents_raw
                .split_ascii_whitespace()
                .map(|s| s.to_string())
                .collect();
            let subject = fields.next().unwrap_or("").to_string();
            let decorate = fields.next().unwrap_or("");
            let short_sha = sha.chars().take(7).collect::<String>();
            entries.push(GitLogEntry {
                sha,
                short_sha,
                author,
                author_email,
                timestamp_secs: timestamp,
                parents,
                subject,
                files_changed: 0,
                insertions: 0,
                deletions: 0,
                refs: parse_log_refs(decorate, &ref_kind_map),
            });
            continue;
        }
        if let Some(current) = entries.last_mut() {
            if line.contains("file changed") || line.contains("files changed") {
                let (files, ins, del) = parse_shortstat(line);
                current.files_changed = files;
                current.insertions = ins;
                current.deletions = del;
            }
        }
    }
    let has_more = entries.len() as u32 > bounded;
    if has_more {
        entries.truncate(bounded as usize);
    }
    Ok(GitLogPage {
        entries,
        has_more,
    })
}

pub fn show_commit_diff(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    sha: &str,
    workspace: &WorkspaceEnv,
) -> Result<GitDiffResult> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    if !sha_is_safe(sha) {
        return Err(GitError::command("git show", "invalid commit identifier"));
    }
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        [
            OsStr::new("show"),
            OsStr::new("--no-color"),
            OsStr::new("--no-ext-diff"),
            OsStr::new("--patch-with-stat"),
            OsStr::new(sha),
            OsStr::new("--"),
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git show failed")?;
    let diff_text = match String::from_utf8(output.stdout) {
        Ok(text) => text,
        Err(e) => String::from_utf8_lossy(&e.into_bytes()).into_owned(),
    };
    Ok(GitDiffResult {
        diff_text,
        truncated: output.truncated,
    })
}

fn parse_shortstat(tail: &str) -> (u32, u32, u32) {
    // Looks for a line like " 5 files changed, 12 insertions(+), 3 deletions(-)"
    for line in tail.lines() {
        let trimmed = line.trim();
        if !(trimmed.contains("file changed") || trimmed.contains("files changed")) {
            continue;
        }
        let mut files = 0u32;
        let mut ins = 0u32;
        let mut del = 0u32;
        for part in trimmed.split(',') {
            let part = part.trim();
            let num_str = part.split_ascii_whitespace().next().unwrap_or("0");
            let n: u32 = num_str.parse().unwrap_or(0);
            if part.contains("file") {
                files = n;
            } else if part.contains("insertion") {
                ins = n;
            } else if part.contains("deletion") {
                del = n;
            }
        }
        return (files, ins, del);
    }
    (0, 0, 0)
}

fn sha_is_safe(sha: &str) -> bool {
    !sha.is_empty() && sha.len() <= 64 && sha.chars().all(|c| c.is_ascii_hexdigit())
}

pub fn commit_files(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    sha: &str,
    workspace: &WorkspaceEnv,
) -> Result<Vec<GitCommitFileChange>> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    if !sha_is_safe(sha) {
        return Err(GitError::command("git diff-tree", "invalid commit sha"));
    }

    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        [
            OsStr::new("diff-tree"),
            OsStr::new("--no-commit-id"),
            OsStr::new("-r"),
            OsStr::new("-z"),
            OsStr::new("--name-status"),
            OsStr::new("--numstat"),
            OsStr::new(sha),
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git diff-tree failed")?;

    let (name_status_bytes, numstat_bytes) = split_name_status_numstat(&output.stdout);
    let mut files = parse_diff_tree_name_status(name_status_bytes);
    apply_numstat(&mut files, numstat_bytes);
    Ok(files)
}

fn split_name_status_numstat(bytes: &[u8]) -> (&[u8], &[u8]) {
    let s = std::str::from_utf8(bytes).unwrap_or("");
    let tokens: Vec<(usize, &str)> = s
        .split('\0')
        .scan(0usize, |off, t| {
            let start = *off;
            *off += t.len() + 1;
            Some((start, t))
        })
        .collect();
    let mut split_at = bytes.len();
    for (idx, tok) in tokens.iter().enumerate() {
        if tok.1.contains('\t') {
            split_at = tok.0;
            // Walk back: numstat for R/C with -z emits "<a>\t<r>" then two
            // NUL-separated paths. The two trailing path tokens belong to the
            // numstat block, not name-status.
            let _ = idx;
            break;
        }
    }
    (&bytes[..split_at], &bytes[split_at..])
}

pub fn commit_file_diff(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    sha: &str,
    path: &str,
    original_path: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<GitDiffContentResult> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    if !sha_is_safe(sha) {
        return Err(GitError::command("git show", "invalid commit sha"));
    }
    let resolved = resolve_within_repo(&repo_root.local_path, path)?;
    let rel = resolved
        .strip_prefix(&repo_root.local_path)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.replace('\\', "/"));

    let original_rel = match original_path {
        Some(orig) if !orig.is_empty() => {
            let resolved_orig = resolve_within_repo(&repo_root.local_path, orig)?;
            resolved_orig
                .strip_prefix(&repo_root.local_path)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| orig.replace('\\', "/"))
        }
        _ => rel.clone(),
    };

    let parent = git_stdout_line_opt(
        &repo_root.workspace,
        &repo_root.git_path,
        ["rev-parse", &format!("{sha}^")],
    )?;
    let original = match parent.as_deref() {
        Some(p) => git_show_text(
            &repo_root.workspace,
            &repo_root.git_path,
            &format!("{p}:{original_rel}"),
        )?,
        None => TextSource::Missing,
    };
    let modified = git_show_text(
        &repo_root.workspace,
        &repo_root.git_path,
        &format!("{sha}:{rel}"),
    )?;

    let mut diff_args: Vec<OsString> = vec![
        "show".into(),
        "--no-color".into(),
        "--no-ext-diff".into(),
        "--format=".into(),
        "-m".into(),
        "--first-parent".into(),
        sha.into(),
        "--".into(),
    ];
    diff_args.push(rel.clone().into());
    if original_rel != rel {
        diff_args.push(original_rel.clone().into());
    }
    let patch_output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        diff_args,
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&patch_output, "git show <commit> -- <path> failed")?;
    let patch_text = match String::from_utf8(patch_output.stdout) {
        Ok(text) => text,
        Err(e) => String::from_utf8_lossy(&e.into_bytes()).into_owned(),
    };

    let is_binary =
        matches!(original, TextSource::Binary) || matches!(modified, TextSource::Binary);

    Ok(GitDiffContentResult {
        original_content: original.into_text(),
        modified_content: modified.into_text(),
        is_binary,
        fallback_patch: patch_text,
        truncated: patch_output.truncated,
    })
}

pub fn remote_url(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    name: &str,
    workspace: &WorkspaceEnv,
) -> Result<Option<String>> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    if name.is_empty() || name.len() > 64 || !name.chars().all(is_remote_name_char) {
        return Ok(None);
    }
    git_stdout_line_opt(
        &repo_root.workspace,
        &repo_root.git_path,
        ["config", "--get", &format!("remote.{name}.url")],
    )
}

pub fn remote_list(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
) -> Result<Vec<GitRemoteInfo>> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    let names = git_stdout_lines(
        &repo_root.workspace,
        &repo_root.git_path,
        ["remote"],
    )?;
    let mut out: Vec<GitRemoteInfo> = Vec::with_capacity(names.len());
    for raw in names {
        let name = parse_remote_name(&raw);
        if name.is_empty() || !name.chars().all(is_remote_name_char) || name.len() > 64 {
            continue;
        }
        let fetch_url = git_stdout_line_opt(
            &repo_root.workspace,
            &repo_root.git_path,
            ["config", "--get", &format!("remote.{name}.url")],
        )?
        .unwrap_or_default();
        let push_url = git_stdout_line_opt(
            &repo_root.workspace,
            &repo_root.git_path,
            ["config", "--get", &format!("remote.{name}.pushurl")],
        )?
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fetch_url.clone());
        out.push(GitRemoteInfo {
            name,
            fetch_url,
            push_url,
        });
    }
    Ok(out)
}

pub fn remote_add(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    input: &GitRemoteInput,
    workspace: &WorkspaceEnv,
) -> Result<GitRemoteInfo> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    validate_remote_name(&input.name)?;
    if input.url.trim().is_empty() {
        return Err(GitError::command(
            "git remote add",
            "remote URL cannot be empty",
        ));
    }
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        [
            OsString::from("remote"),
            OsString::from("add"),
            OsString::from(input.name.clone()),
            OsString::from(input.url.clone()),
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git remote add failed")?;
    let fetch_url = input.url.trim().to_string();
    Ok(GitRemoteInfo {
        name: input.name.clone(),
        fetch_url: fetch_url.clone(),
        push_url: fetch_url,
    })
}

pub fn remote_remove(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    name: &str,
    workspace: &WorkspaceEnv,
) -> Result<()> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    validate_remote_name(name)?;
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        [
            OsString::from("remote"),
            OsString::from("remove"),
            OsString::from(name),
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git remote remove failed")
}

pub fn remote_set_url(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    input: &GitRemoteUrlUpdate,
    workspace: &WorkspaceEnv,
) -> Result<GitRemoteInfo> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    validate_remote_name(&input.name)?;
    if input.new_url.trim().is_empty() {
        return Err(GitError::command(
            "git remote set-url",
            "remote URL cannot be empty",
        ));
    }
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        [
            OsString::from("remote"),
            OsString::from("set-url"),
            OsString::from(input.name.clone()),
            OsString::from(input.new_url.clone()),
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git remote set-url failed")?;
    let fetch_url = input.new_url.trim().to_string();
    let push_url = git_stdout_line_opt(
        &repo_root.workspace,
        &repo_root.git_path,
        ["config", "--get", &format!("remote.{}.pushurl", input.name)],
    )?
    .filter(|s| !s.is_empty())
    .unwrap_or_else(|| fetch_url.clone());
    Ok(GitRemoteInfo {
        name: input.name.clone(),
        fetch_url,
        push_url,
    })
}

fn is_remote_name_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.'
}

fn validate_remote_name(name: &str) -> Result<()> {
    if name.is_empty() || name.len() > 64 {
        return Err(GitError::command(
            "git remote",
            format!("invalid remote name: {name}"),
        ));
    }
    let mut chars = name.chars();
    let first = chars.next().unwrap();
    if !(first.is_ascii_alphanumeric() || first == '_') {
        return Err(GitError::command(
            "git remote",
            format!("invalid remote name: {name}"),
        ));
    }
    if !chars.all(is_remote_name_char) {
        return Err(GitError::command(
            "git remote",
            format!("invalid remote name: {name}"),
        ));
    }
    Ok(())
}

/// `git remote` may wrap names containing special characters in double quotes
/// and escape inner quotes / backslashes; strip that wrapper so the caller
/// gets the literal name. Empty lines (e.g. trailing newline) yield an empty
/// string, which the caller will skip via the validity check.
fn parse_remote_name(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.starts_with('"') && trimmed.ends_with('"') && trimmed.len() >= 2 {
        let inner = &trimmed[1..trimmed.len() - 1];
        let mut out = String::with_capacity(inner.len());
        let mut iter = inner.chars().peekable();
        while let Some(c) = iter.next() {
            if c == '\\' {
                if let Some(next) = iter.next() {
                    out.push(next);
                }
            } else {
                out.push(c);
            }
        }
        return out;
    }
    trimmed.to_string()
}

fn parse_diff_tree_name_status(bytes: &[u8]) -> Vec<GitCommitFileChange> {
    let s = std::str::from_utf8(bytes).unwrap_or("");
    let mut tokens = s.split('\0').filter(|t| !t.is_empty());
    let mut files: Vec<GitCommitFileChange> = Vec::new();
    while let Some(status_tok) = tokens.next() {
        let status_char = status_tok.chars().next().unwrap_or(' ');
        if status_char == 'R' || status_char == 'C' {
            let original = match tokens.next() {
                Some(v) => v.to_string(),
                None => break,
            };
            let new_path = match tokens.next() {
                Some(v) => v.to_string(),
                None => break,
            };
            files.push(GitCommitFileChange {
                path: new_path,
                original_path: Some(original),
                status: status_char.to_string(),
                status_label: status_label_for(status_char),
                added: 0,
                removed: 0,
                is_binary: false,
            });
        } else {
            let path = match tokens.next() {
                Some(v) => v.to_string(),
                None => break,
            };
            files.push(GitCommitFileChange {
                path,
                original_path: None,
                status: status_char.to_string(),
                status_label: status_label_for(status_char),
                added: 0,
                removed: 0,
                is_binary: false,
            });
        }
    }
    files
}

fn apply_numstat(files: &mut [GitCommitFileChange], bytes: &[u8]) {
    let s = std::str::from_utf8(bytes).unwrap_or("");
    let tokens: Vec<&str> = s.split('\0').filter(|t| !t.is_empty()).collect();
    let mut idx = 0;
    while idx < tokens.len() {
        let header = tokens[idx];
        idx += 1;
        let mut cols = header.splitn(3, '\t');
        let added_raw = cols.next().unwrap_or("0");
        let removed_raw = cols.next().unwrap_or("0");
        let inline_path = cols.next().unwrap_or("");
        let is_binary = added_raw == "-" && removed_raw == "-";
        let added: u32 = if is_binary {
            0
        } else {
            added_raw.parse().unwrap_or(0)
        };
        let removed: u32 = if is_binary {
            0
        } else {
            removed_raw.parse().unwrap_or(0)
        };

        let (path, original) = if inline_path.is_empty() {
            let original = tokens.get(idx).map(|s| s.to_string()).unwrap_or_default();
            idx += 1;
            let new_path = tokens.get(idx).map(|s| s.to_string()).unwrap_or_default();
            idx += 1;
            (new_path, Some(original))
        } else {
            (inline_path.to_string(), None)
        };

        if path.is_empty() {
            continue;
        }
        if let Some(file) = files.iter_mut().find(|f| f.path == path) {
            file.added = added;
            file.removed = removed;
            file.is_binary = is_binary;
            if file.original_path.is_none() {
                if let Some(orig) = original {
                    if !orig.is_empty() && orig != file.path {
                        file.original_path = Some(orig);
                    }
                }
            }
        }
    }
}

fn status_label_for(c: char) -> String {
    match c {
        'A' => "Added".into(),
        'M' => "Modified".into(),
        'D' => "Deleted".into(),
        'R' => "Renamed".into(),
        'C' => "Copied".into(),
        'T' => "Type changed".into(),
        'U' => "Unmerged".into(),
        _ => format!("Status {c}"),
    }
}

pub fn fetch(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
) -> Result<GitFetchResult> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        ["fetch", "--prune"],
        NETWORK_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git fetch failed")?;
    Ok(parse_fetch_summary(&combined_output_text(&output)))
}

pub fn pull_ff_only(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
) -> Result<GitPullResult> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        ["pull", "--ff-only", "--stat"],
        NETWORK_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git pull --ff-only failed")?;
    Ok(parse_pull_summary(&combined_output_text(&output)))
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

fn fallback_message(message: String, fallback: &str) -> String {
    if message.trim().is_empty() {
        fallback.to_string()
    } else {
        message
    }
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

fn nothing_to_commit(output: &GitOutput) -> bool {
    let stderr = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
    let stdout = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
    stderr.contains("nothing to commit") || stdout.contains("nothing to commit")
}

fn resolve_pathspecs(repo_root: &Path, paths: &[String]) -> Result<Vec<String>> {
    let mut out = Vec::with_capacity(paths.len());
    for p in paths {
        out.push(pathspec_from_input(repo_root, p)?);
    }
    Ok(out)
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

// --- Bounded nested-repository discovery ----------------------------------

/// Subset of a candidate repo collected during traversal. We finish resolving
/// (branch / upstream / is_detached) once we know the candidate survived
/// authorization and deduplication.
struct CandidateRepo {
    authorized: ResolvedGitDirectory,
    relative_path: String,
    name: String,
    is_worktree: bool,
}

/// Directory names we never descend into during discovery. They are either
/// known huge (`node_modules`, `target`) or otherwise opaque to repository
/// scanning (`.git` itself). Listing `.git` here keeps the BFS from walking
/// into a gitdir and reporting phantom nested repos.
const DISCOVERY_SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    ".next",
    ".cache",
    ".idea",
    ".vscode",
    ".gradle",
];

fn is_blacklisted_dir(name: &str) -> bool {
    DISCOVERY_SKIP_DIRS.contains(&name)
}

/// Build the `find` predicate that prunes every blacklisted subtree, matching
/// the Local BFS's behavior. The leading `*/` keeps the user's authorized
/// root itself from being pruned if it happens to share a name with a
/// blacklisted directory.
#[cfg(windows)]
fn wsl_blacklist_prune_clause() -> String {
    let mut parts: Vec<String> = Vec::with_capacity(DISCOVERY_SKIP_DIRS.len());
    for name in DISCOVERY_SKIP_DIRS {
        if *name == ".git" {
            // `.git` is handled separately (we want to emit it, then prune
            // its subtree), so it does not belong in the prune clause.
            continue;
        }
        parts.push(format!("-path '*/{name}'"));
    }
    parts.join(" -o ")
}

pub fn discover_repositories(
    registry: &WorkspaceRegistry,
    root_path: &str,
    max_depth: u32,
    max_repos: u32,
    workspace: &WorkspaceEnv,
) -> Result<GitRepositoryDiscovery> {
    let root = authorized_repo_root(registry, root_path, workspace)?;
    ensure_git_available(&root.workspace)?;

    // Collect up to max_repos + 1 raw candidates so the outer loop can
    // detect "more remain" without a second pass over the tree.
    let limit = max_repos.saturating_add(1);
    let (raw_candidates, depth_more) = match workspace {
        WorkspaceEnv::Local => collect_local(registry, &root, max_depth, limit),
        WorkspaceEnv::Wsl { .. } => collect_wsl(registry, &root, max_depth, limit)?,
    };

    let mut repositories: Vec<GitWorkspaceRepo> = Vec::new();
    let mut seen: HashSet<std::path::PathBuf> = HashSet::new();
    let mut truncated = depth_more;

    for candidate in raw_candidates.iter() {
        if repositories.len() as u32 >= max_repos {
            truncated = true;
            break;
        }
        if !seen.insert(candidate.authorized.local_path.clone()) {
            continue;
        }
        if !registry.is_authorized(&candidate.authorized.local_path) {
            continue;
        }
        let info = match resolve_repo_in_authorized(registry, &candidate.authorized) {
            Ok(Some(info)) => info,
            _ => continue,
        };
        repositories.push(GitWorkspaceRepo {
            repo_root: candidate.authorized.git_path.clone(),
            relative_path: candidate.relative_path.clone(),
            name: candidate.name.clone(),
            branch: info.branch,
            upstream: info.upstream,
            is_detached: info.is_detached,
            is_worktree: candidate.is_worktree,
        });
    }

    // The collector stops once it sees `limit` raw candidates; if we got
    // there, there is at least one more it deliberately skipped.
    if raw_candidates.len() as u32 >= limit {
        truncated = true;
    }

    Ok(GitRepositoryDiscovery {
        repositories,
        truncated,
    })
}

fn collect_local(
    registry: &WorkspaceRegistry,
    root: &ResolvedGitDirectory,
    max_depth: u32,
    limit: u32,
) -> (Vec<CandidateRepo>, bool) {
    let mut candidates: Vec<CandidateRepo> = Vec::new();
    let mut more_remain = false;
    let mut queue: VecDeque<(std::path::PathBuf, u32)> = VecDeque::new();
    queue.push_back((root.local_path.clone(), 0));

    while let Some((dir, depth)) = queue.pop_front() {
        if let Some(candidate) = build_local_candidate(registry, root, &dir) {
            candidates.push(candidate);
            if candidates.len() as u32 >= limit {
                more_remain = true;
                break;
            }
        }

        if depth >= max_depth {
            // Hit the depth budget. Probe whether any descendable child
            // exists so the caller knows more candidates might live deeper.
            if has_descendable_subdirs(&dir) {
                more_remain = true;
            }
            continue;
        }

        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let name = match file_name.to_str() {
                Some(s) => s,
                None => continue,
            };
            if is_blacklisted_dir(name) {
                continue;
            }
            let entry_path = entry.path();
            let meta = match std::fs::symlink_metadata(&entry_path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.file_type().is_symlink() || !meta.is_dir() {
                continue;
            }
            queue.push_back((entry_path, depth + 1));
        }
    }

    (candidates, more_remain)
}

fn has_descendable_subdirs(dir: &Path) -> bool {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return false,
    };
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let name = match file_name.to_str() {
            Some(s) => s,
            None => continue,
        };
        if is_blacklisted_dir(name) {
            continue;
        }
        let meta = match std::fs::symlink_metadata(entry.path()) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.file_type().is_symlink() || !meta.is_dir() {
            continue;
        }
        return true;
    }
    false
}

fn build_local_candidate(
    registry: &WorkspaceRegistry,
    root: &ResolvedGitDirectory,
    dir: &Path,
) -> Option<CandidateRepo> {
    let git_entry = dir.join(".git");
    let meta = std::fs::symlink_metadata(&git_entry).ok()?;
    let ft = meta.file_type();
    if !(ft.is_dir() || ft.is_file() || ft.is_symlink()) {
        return None;
    }
    // `.git` as a file or symlink is the worktree / submodule shape. Real
    // repos carry `.git` as a directory.
    let is_worktree = ft.is_file() || ft.is_symlink();

    let dir_str = dir.to_string_lossy().replace('\\', "/");
    let authorized = authorized_repo_root(registry, &dir_str, &root.workspace).ok()?;

    let relative_path = relative_from_root(&root.local_path, &authorized.local_path);
    let name = authorized
        .local_path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| dir_str.clone());

    Some(CandidateRepo {
        authorized,
        relative_path,
        name,
        is_worktree,
    })
}

fn relative_from_root(root: &Path, candidate: &Path) -> String {
    match candidate.strip_prefix(root) {
        Ok(rel) => {
            let s = rel.to_string_lossy().replace('\\', "/");
            if s.is_empty() {
                ".".to_string()
            } else {
                s
            }
        }
        Err(_) => ".".to_string(),
    }
}

#[cfg(windows)]
fn collect_wsl(
    registry: &WorkspaceRegistry,
    root: &ResolvedGitDirectory,
    max_depth: u32,
    limit: u32,
) -> Result<(Vec<CandidateRepo>, bool)> {
    use crate::modules::workspace::wsl_exec_capture;
    let distro = match &root.workspace {
        WorkspaceEnv::Wsl { distro } => distro.clone(),
        WorkspaceEnv::Local => {
            return Err(GitError::command(
                "git_discover_repositories",
                "internal: wsl collector called for local workspace",
            ));
        }
    };

    // Local semantics: max_depth=0 only inspects the root (and finds the
    // root repo's own `.git`). `find -maxdepth` includes the start path and
    // that many levels of children, so we add one to also cover `.git`
    // itself when it lives one level below the directory under test.
    let find_maxdepth = max_depth.saturating_add(1);
    let quoted_root = shell_quote_wsl(&root.git_path);
    let prune_clause = wsl_blacklist_prune_clause();
    // Order matters: print `.git` candidates first (so they survive the
    // `-prune` step), then prune the `.git` subtree to avoid walking into
    // a gitdir.
    let script = format!(
        "find {quoted_root} -maxdepth {find_maxdepth} \\( {prune_clause} \\) -prune -o -name .git \\( -type d -o -type f -o -type l \\) -printf '%y\\t%p\\n' -prune 2>/dev/null"
    );
    let output = wsl_exec_capture(&distro, "sh", &["-c", &script])
        .map_err(|e| GitError::command("wsl git discovery", e))?;

    let mut candidates: Vec<CandidateRepo> = Vec::new();
    let mut more_remain = false;
    for line in output.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        if candidates.len() as u32 >= limit {
            more_remain = true;
            break;
        }
        let (kind, path) = match line.split_once('\t') {
            Some(parts) => parts,
            None => continue,
        };
        // `.git` shows up as a regular file (worktree / submodule pointer)
        // or as a symlink (some submodule layouts); both mark a non-`dir`
        // gitdir and should be flagged as a worktree in the UI.
        let is_worktree = matches!(kind, "f" | "l");
        let repo_wsl_path = wsl_parent(path);
        if let Some(candidate) = build_wsl_candidate(registry, root, &repo_wsl_path, is_worktree) {
            candidates.push(candidate);
        }
    }
    Ok((candidates, more_remain))
}

#[cfg(not(windows))]
fn collect_wsl(
    _registry: &WorkspaceRegistry,
    _root: &ResolvedGitDirectory,
    _max_depth: u32,
    _limit: u32,
) -> Result<(Vec<CandidateRepo>, bool)> {
    Err(GitError::command(
        "git_discover_repositories",
        "WSL discovery is only available on Windows",
    ))
}

#[cfg(windows)]
fn build_wsl_candidate(
    registry: &WorkspaceRegistry,
    root: &ResolvedGitDirectory,
    wsl_repo_path: &str,
    is_worktree: bool,
) -> Option<CandidateRepo> {
    let authorized = authorized_repo_root(registry, wsl_repo_path, &root.workspace).ok()?;
    let relative_path = relative_wsl_path(&root.git_path, wsl_repo_path);
    let name = wsl_basename(wsl_repo_path);
    Some(CandidateRepo {
        authorized,
        relative_path,
        name,
        is_worktree,
    })
}

#[cfg(windows)]
fn shell_quote_wsl(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

#[cfg(windows)]
fn wsl_parent(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        return "/".to_string();
    }
    match trimmed.rfind('/') {
        Some(0) => "/".to_string(),
        Some(idx) => trimmed[..idx].to_string(),
        None => trimmed.to_string(),
    }
}

#[cfg(windows)]
fn wsl_basename(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        return "/".to_string();
    }
    match trimmed.rfind('/') {
        Some(idx) => trimmed[idx + 1..].to_string(),
        None => trimmed.to_string(),
    }
}

#[cfg(windows)]
fn relative_wsl_path(root: &str, candidate: &str) -> String {
    let root_trim = root.trim_end_matches('/');
    let candidate_trim = candidate.trim_end_matches('/');
    if root_trim.is_empty() {
        // Root is "/" — everything under it is a literal leading-slash path.
        let stripped = candidate_trim.trim_start_matches('/');
        if stripped.is_empty() {
            ".".to_string()
        } else {
            stripped.to_string()
        }
    } else if candidate_trim == root_trim {
        ".".to_string()
    } else if let Some(stripped) = candidate_trim.strip_prefix(root_trim) {
        let stripped = stripped.trim_start_matches('/');
        if stripped.is_empty() {
            ".".to_string()
        } else {
            stripped.to_string()
        }
    } else {
        ".".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::{apply_changed_files_limit, BRANCH_LIST_FORMAT_ARG, MAX_CHANGED_FILES};
    use crate::modules::git::types::GitChangedFile;
    use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::sync::atomic::{AtomicU64, Ordering};

    #[test]
    fn branch_list_format_uses_ref_filter_hex_escape() {
        let format = BRANCH_LIST_FORMAT_ARG
            .strip_prefix("--format=")
            .expect("branch list git arg should set a format");
        assert!(format.contains("%1f"));
        assert!(!format.contains("%x1f"));
    }

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

    // --- discover_repositories fixtures --------------------------------------

    static DISCOVERY_COUNTER: AtomicU64 = AtomicU64::new(0);

    /// Build an isolated temp dir under `std::env::temp_dir()` and authorize
    /// it as a workspace root so the existing authorization boundary accepts
    /// it without touching any global state.
    struct AuthorizedRoot {
        path: PathBuf,
        registry: WorkspaceRegistry,
    }

    fn make_root(label: &str) -> AuthorizedRoot {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let counter = DISCOVERY_COUNTER.fetch_add(1, Ordering::Relaxed);
        let mut p = std::env::temp_dir();
        p.push(format!(
            "nexterm-git-discovery-{label}-{nanos}-{}-{counter}",
            std::process::id()
        ));
        std::fs::create_dir_all(&p).expect("create tempdir");
        let canonical = std::fs::canonicalize(&p).expect("canonicalize tempdir");
        let registry = WorkspaceRegistry::default();
        registry.authorize(&canonical).expect("authorize root");
        AuthorizedRoot {
            path: canonical,
            registry,
        }
    }

    /// Mirror the canonical-path string the discovery DTO emits for a
    /// `WorkspaceEnv::Local` repo (forward slashes, no UNC prefix).
    fn expected_repo_root(path: &Path) -> String {
        path.to_string_lossy().replace('\\', "/")
    }

    fn init_git_repo(dir: &Path, branch: &str) {
        let status = Command::new("git")
            .arg("init")
            .arg("--initial-branch")
            .arg(branch)
            .arg(dir)
            .env("GIT_AUTHOR_NAME", "Nexterm Test")
            .env("GIT_AUTHOR_EMAIL", "test@nexterm.local")
            .env("GIT_COMMITTER_NAME", "Nexterm Test")
            .env("GIT_COMMITTER_EMAIL", "test@nexterm.local")
            .env("LC_ALL", "C")
            .status()
            .expect("git init");
        assert!(status.success(), "git init failed for {}", dir.display());
        // Create an empty initial commit so the existing resolve path can read
        // HEAD; an empty repo makes `git rev-parse --abbrev-ref HEAD` fail
        // before any commits exist.
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .arg("commit")
            .arg("--allow-empty")
            .arg("-m")
            .arg("init")
            .env("GIT_AUTHOR_NAME", "Nexterm Test")
            .env("GIT_AUTHOR_EMAIL", "test@nexterm.local")
            .env("GIT_COMMITTER_NAME", "Nexterm Test")
            .env("GIT_COMMITTER_EMAIL", "test@nexterm.local")
            .env("LC_ALL", "C")
            .status()
            .expect("git commit");
        assert!(status.success(), "git commit failed for {}", dir.display());
    }

    #[test]
    fn discover_repositories_root_only() {
        let root = make_root("root-only");
        init_git_repo(&root.path, "main");
        let path_str = root.path.to_string_lossy().into_owned();

        let result = super::discover_repositories(
            &root.registry,
            &path_str,
            4,
            64,
            &WorkspaceEnv::Local,
        )
        .expect("discovery succeeds");

        assert!(!result.truncated);
        assert_eq!(result.repositories.len(), 1);
        let repo = &result.repositories[0];
        assert_eq!(repo.relative_path, ".");
        assert_eq!(repo.repo_root, expected_repo_root(&root.path));
        assert_eq!(repo.branch, "main");
        assert!(!repo.is_detached);
        assert!(!repo.is_worktree);
    }

    #[test]
    fn discover_repositories_outer_plus_nested() {
        let root = make_root("outer-nested");
        init_git_repo(&root.path, "main");
        let nested = root.path.join("nested");
        std::fs::create_dir_all(&nested).expect("nested dir");
        init_git_repo(&nested, "feature/nested");
        let path_str = root.path.to_string_lossy().into_owned();

        let result = super::discover_repositories(
            &root.registry,
            &path_str,
            4,
            64,
            &WorkspaceEnv::Local,
        )
        .expect("discovery succeeds");

        let mut paths: Vec<_> = result
            .repositories
            .iter()
            .map(|r| {
                (
                    r.relative_path.clone(),
                    r.branch.clone(),
                    r.repo_root.clone(),
                )
            })
            .collect();
        paths.sort();

        assert_eq!(
            paths,
            vec![
                (
                    ".".to_string(),
                    "main".to_string(),
                    expected_repo_root(&root.path),
                ),
                (
                    "nested".to_string(),
                    "feature/nested".to_string(),
                    expected_repo_root(&nested),
                ),
            ]
        );
        assert!(!result.truncated);
    }

    #[test]
    fn discover_repositories_two_sibling_repos() {
        let root = make_root("siblings");
        let repo_a = root.path.join("repo_a");
        let repo_b = root.path.join("repo_b");
        std::fs::create_dir_all(&repo_a).expect("repo_a");
        std::fs::create_dir_all(&repo_b).expect("repo_b");
        init_git_repo(&repo_a, "main");
        init_git_repo(&repo_b, "develop");
        let path_str = root.path.to_string_lossy().into_owned();

        let result = super::discover_repositories(
            &root.registry,
            &path_str,
            4,
            64,
            &WorkspaceEnv::Local,
        )
        .expect("discovery succeeds");

        let mut paths: Vec<_> = result
            .repositories
            .iter()
            .map(|r| {
                (
                    r.relative_path.clone(),
                    r.branch.clone(),
                    r.repo_root.clone(),
                )
            })
            .collect();
        paths.sort();

        assert_eq!(
            paths,
            vec![
                (
                    "repo_a".to_string(),
                    "main".to_string(),
                    expected_repo_root(&repo_a),
                ),
                (
                    "repo_b".to_string(),
                    "develop".to_string(),
                    expected_repo_root(&repo_b),
                ),
            ]
        );
        assert!(!result.truncated);
    }

    #[test]
    fn discover_repositories_detects_dot_git_file_worktree() {
        let root = make_root("dot-git-file");
        init_git_repo(&root.path, "main");
        // Add a real worktree so the `.git` *file* candidate resolves to a
        // valid gitdir that the existing resolve path can read.
        let worktree_path = root.path.join("wt");
        let status = Command::new("git")
            .arg("-C")
            .arg(&root.path)
            .arg("worktree")
            .arg("add")
            .arg("-b")
            .arg("wt-branch")
            .arg(&worktree_path)
            .env("GIT_AUTHOR_NAME", "Nexterm Test")
            .env("GIT_AUTHOR_EMAIL", "test@nexterm.local")
            .env("GIT_COMMITTER_NAME", "Nexterm Test")
            .env("GIT_COMMITTER_EMAIL", "test@nexterm.local")
            .env("LC_ALL", "C")
            .status()
            .expect("git worktree add");
        assert!(status.success(), "git worktree add failed");
        let path_str = root.path.to_string_lossy().into_owned();

        let result = super::discover_repositories(
            &root.registry,
            &path_str,
            4,
            64,
            &WorkspaceEnv::Local,
        )
        .expect("discovery succeeds");

        let worktree = result
            .repositories
            .iter()
            .find(|r| r.relative_path == "wt")
            .expect("worktree candidate missing");
        assert!(
            worktree.is_worktree,
            ".git file candidate should flag worktree"
        );
    }

    #[test]
    fn discover_repositories_no_repositories() {
        let root = make_root("empty");
        let path_str = root.path.to_string_lossy().into_owned();

        let result = super::discover_repositories(
            &root.registry,
            &path_str,
            4,
            64,
            &WorkspaceEnv::Local,
        )
        .expect("discovery succeeds");

        assert!(result.repositories.is_empty());
        assert!(!result.truncated);
    }

    #[test]
    fn discover_repositories_truncates_at_max_repos() {
        let root = make_root("trunc-repos");
        let repo_a = root.path.join("repo_a");
        let repo_b = root.path.join("repo_b");
        let repo_c = root.path.join("repo_c");
        std::fs::create_dir_all(&repo_a).expect("repo_a");
        std::fs::create_dir_all(&repo_b).expect("repo_b");
        std::fs::create_dir_all(&repo_c).expect("repo_c");
        init_git_repo(&repo_a, "main");
        init_git_repo(&repo_b, "main");
        init_git_repo(&repo_c, "main");
        let path_str = root.path.to_string_lossy().into_owned();

        let result = super::discover_repositories(
            &root.registry,
            &path_str,
            4,
            2,
            &WorkspaceEnv::Local,
        )
        .expect("discovery succeeds");

        assert_eq!(result.repositories.len(), 2);
        assert!(result.truncated);
    }

    #[test]
    fn discover_repositories_truncates_at_max_depth() {
        let root = make_root("trunc-depth");
        let deep = root.path.join("a").join("b").join("c").join("repo");
        std::fs::create_dir_all(&deep).expect("deep");
        init_git_repo(&deep, "deep-main");
        let path_str = root.path.to_string_lossy().into_owned();

        // max_depth=2 means we look at root (depth 0) + one child level. The
        // deeply nested repo sits at depth 4 so it should be truncated.
        let result = super::discover_repositories(
            &root.registry,
            &path_str,
            2,
            64,
            &WorkspaceEnv::Local,
        )
        .expect("discovery succeeds");

        assert!(result.repositories.is_empty());
        assert!(result.truncated);
    }

    #[cfg(unix)]
    #[test]
    fn discover_repositories_skips_symlink_outside_authorized_root() {
        let authorized = make_root("sym-authorized");
        let outside = make_root("sym-outside");
        init_git_repo(&outside.path, "outside-main");
        let link_path = authorized.path.join("escape");
        std::os::unix::fs::symlink(&outside.path, &link_path).expect("symlink");
        let path_str = authorized.path.to_string_lossy().into_owned();

        let result = super::discover_repositories(
            &authorized.registry,
            &path_str,
            4,
            64,
            &WorkspaceEnv::Local,
        )
        .expect("discovery succeeds");

        assert!(
            result.repositories.is_empty(),
            "symlinked escape must be ignored"
        );
        assert!(!result.truncated);
    }

    // --- stash / checkout end-to-end fixtures --------------------------------
    //
    // The operations above run a real `git` binary against a temp repo so we
    // exercise the same code paths the IPC layer will hit. They live next
    // to the discover tests because they share the same authorization +
    // git-binary requirements.

    fn write_file(dir: &Path, name: &str, content: &str) {
        let path = dir.join(name);
        std::fs::write(&path, content).expect("write file");
    }

    fn run_git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .env("LC_ALL", "C")
            .env("GIT_AUTHOR_NAME", "Nexterm Test")
            .env("GIT_AUTHOR_EMAIL", "test@nexterm.local")
            .env("GIT_COMMITTER_NAME", "Nexterm Test")
            .env("GIT_COMMITTER_EMAIL", "test@nexterm.local")
            .status()
            .expect("git command");
        assert!(status.success(), "git {args:?} failed");
    }

    #[test]
    fn stash_list_emits_full_and_short_sha() {
        let root = make_root("stash-list");
        init_git_repo(&root.path, "main");
        write_file(&root.path, "tracked.txt", "v1\n");
        run_git(&root.path, &["add", "tracked.txt"]);
        run_git(&root.path, &["commit", "-m", "first"]);
        write_file(&root.path, "tracked.txt", "v2\n");
        let path_str = root.path.to_string_lossy().into_owned();

        let options = super::GitStashPushOptions {
            message: Some("checkpoint".into()),
            include_untracked: false,
            keep_index: false,
        };
        super::stash_push(
            &root.registry,
            &path_str,
            &options,
            &WorkspaceEnv::Local,
        )
        .expect("stash push succeeds");

        // Resolve the stash commit's full SHA directly so we can compare
        // apples to apples — the DTO's `short_sha` is derived from the
        // stash commit, not from HEAD.
        let resolved = Command::new("git")
            .arg("-C")
            .arg(&root.path)
            .args(["rev-parse", "stash@{0}"])
            .env("LC_ALL", "C")
            .output()
            .expect("rev-parse stash@{0}");
        let resolved_full =
            String::from_utf8_lossy(&resolved.stdout).trim().to_string();

        let entries =
            super::stash_list(&root.registry, &path_str, &WorkspaceEnv::Local)
                .expect("stash list succeeds");
        assert_eq!(entries.len(), 1);
        let entry = &entries[0];
        assert_eq!(entry.selector, "stash@{0}");
        assert_eq!(entry.full_sha, resolved_full);
        assert_eq!(entry.short_sha, resolved_full.chars().take(7).collect::<String>());
        assert!(entry.message.contains("checkpoint"));
    }

    #[test]
    fn stash_pop_rejects_selector_when_expected_sha_mismatches() {
        let root = make_root("stash-pop-guard");
        init_git_repo(&root.path, "main");
        write_file(&root.path, "tracked.txt", "v1\n");
        run_git(&root.path, &["add", "tracked.txt"]);
        run_git(&root.path, &["commit", "-m", "first"]);
        write_file(&root.path, "tracked.txt", "v2\n");
        let path_str = root.path.to_string_lossy().into_owned();

        let options = super::GitStashPushOptions {
            message: None,
            include_untracked: false,
            keep_index: false,
        };
        super::stash_push(
            &root.registry,
            &path_str,
            &options,
            &WorkspaceEnv::Local,
        )
        .expect("stash push succeeds");

        let entries =
            super::stash_list(&root.registry, &path_str, &WorkspaceEnv::Local)
                .expect("stash list succeeds");
        let real_sha = entries[0].full_sha.clone();

        let wrong = super::stash_pop(
            &root.registry,
            &path_str,
            "stash@{0}",
            Some("0000000000000000000000000000000000000000"),
            &WorkspaceEnv::Local,
        );
        assert!(wrong.is_err(), "mismatched sha must reject pop");

        let good = super::stash_pop(
            &root.registry,
            &path_str,
            "stash@{0}",
            Some(&real_sha),
            &WorkspaceEnv::Local,
        );
        assert!(good.is_ok(), "matching sha should accept pop");
    }

    #[test]
    fn stash_apply_keeps_entry_on_stack() {
        let root = make_root("stash-apply");
        init_git_repo(&root.path, "main");
        write_file(&root.path, "tracked.txt", "v1\n");
        run_git(&root.path, &["add", "tracked.txt"]);
        run_git(&root.path, &["commit", "-m", "first"]);
        write_file(&root.path, "tracked.txt", "v2\n");
        let path_str = root.path.to_string_lossy().into_owned();

        let options = super::GitStashPushOptions {
            message: None,
            include_untracked: false,
            keep_index: false,
        };
        super::stash_push(
            &root.registry,
            &path_str,
            &options,
            &WorkspaceEnv::Local,
        )
        .expect("stash push succeeds");

        super::stash_apply(
            &root.registry,
            &path_str,
            "stash@{0}",
            None,
            &WorkspaceEnv::Local,
        )
        .expect("stash apply succeeds");

        let entries =
            super::stash_list(&root.registry, &path_str, &WorkspaceEnv::Local)
                .expect("stash list succeeds");
        assert_eq!(entries.len(), 1, "apply must not drop the entry");
    }

    #[test]
    fn checkout_branch_prefers_existing_local_when_remote_requested() {
        let root = make_root("checkout-remote");
        init_git_repo(&root.path, "main");
        // Materialize a local branch named `feature` so the backend should
        // `switch feature` rather than `switch --track origin/feature`.
        run_git(&root.path, &["branch", "feature"]);
        let path_str = root.path.to_string_lossy().into_owned();

        let result = super::checkout_branch(
            &root.registry,
            &path_str,
            "origin/feature",
            true,
            &WorkspaceEnv::Local,
        )
        .expect("checkout succeeds");

        assert_eq!(result.branch, "origin/feature");
        let head = Command::new("git")
            .arg("-C")
            .arg(&root.path)
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .env("LC_ALL", "C")
            .output()
            .expect("rev-parse");
        assert_eq!(
            String::from_utf8_lossy(&head.stdout).trim(),
            "feature",
            "backend should have switched to the existing local tracking branch",
        );
    }

    // --- git_log page contract fixtures --------------------------------------
    //
    // The Task 6 page contract: `log(registry, repo_root, options, workspace)`
    // returns `GitLogPage { entries, has_more }`. `options.ref_name` selects
    // a single branch, `options.all` crosses refs, and `options.offset`
    // advances through the DAG without duplicating SHAs. These fixtures build
    // a real repo with two branches, a tag, and a merge commit so the parser
    // exercises the decoration/refs path as well.

    /// Build a repo with two branches (`main` + `feature`), a merge commit,
    /// and a tag. Returns the canonical path used as `repo_root`. The fixture
    /// leaves HEAD on `main` so the default log view exposes the full DAG:
    /// init → add feature → main only change → merge feature into main →
    /// feature follow-up (only reachable via `--all`).
    fn init_branched_repo(label: &str) -> AuthorizedRoot {
        let root = make_root(label);
        init_git_repo(&root.path, "main");

        // First feature commit.
        write_file(&root.path, "feature.txt", "feature-v1\n");
        run_git(&root.path, &["checkout", "-b", "feature"]);
        run_git(&root.path, &["add", "feature.txt"]);
        run_git(
            &root.path,
            &[
                "commit",
                "-m",
                "add feature",
            ],
        );

        // Main advances independently so the two branches diverge.
        run_git(&root.path, &["checkout", "main"]);
        write_file(&root.path, "main-only.txt", "main-only\n");
        run_git(&root.path, &["add", "main-only.txt"]);
        run_git(&root.path, &["commit", "-m", "main only change"]);

        // Merge feature back into main so we have a two-parent commit.
        run_git(
            &root.path,
            &["merge", "--no-ff", "feature", "-m", "merge feature into main"],
        );

        // Tag the latest merge commit so the decoration parser has a tag ref
        // to surface on the merge.
        run_git(&root.path, &["tag", "v1.0"]);

        // A second feature commit so `feature` has its own DAG tail. After
        // this we switch back to `main` so the default view shows the merge
        // commit as the HEAD ref.
        run_git(&root.path, &["checkout", "feature"]);
        write_file(&root.path, "feature.txt", "feature-v2\n");
        run_git(&root.path, &["add", "feature.txt"]);
        run_git(&root.path, &["commit", "-m", "feature follow-up"]);
        run_git(&root.path, &["checkout", "main"]);

        root
    }

    fn default_log_options() -> super::GitLogOptions {
        super::GitLogOptions {
            limit: None,
            offset: None,
            ref_name: None,
            all: false,
        }
    }

    #[test]
    fn log_default_returns_page_with_entries() {
        let root = init_branched_repo("log-default");
        let path_str = root.path.to_string_lossy().into_owned();

        let page = super::log(
            &root.registry,
            &path_str,
            &default_log_options(),
            &WorkspaceEnv::Local,
        )
        .expect("log returns page");

        assert!(page.entries.len() >= 4, "branched repo has >= 4 commits");
        assert!(
            !page.has_more,
            "limit defaults to 30 which is more than the available history"
        );
        // Newest first ordering — the merge commit should be near the top.
        let head_subject = page.entries[0].subject.as_str();
        assert!(
            head_subject.contains("merge feature")
                || head_subject.contains("feature follow-up"),
            "newest commit should be the merge or the feature follow-up, got: {head_subject}",
        );
    }

    #[test]
    fn log_ref_name_limits_to_branch() {
        let root = init_branched_repo("log-ref-name");
        let path_str = root.path.to_string_lossy().into_owned();

        let mut options = default_log_options();
        options.ref_name = Some("feature".to_string());

        let page = super::log(
            &root.registry,
            &path_str,
            &options,
            &WorkspaceEnv::Local,
        )
        .expect("log returns page");

        // `feature` carries the merge + add feature + init, no `main only`
        // commit. We assert none of the `main only` subjects appear.
        for entry in &page.entries {
            assert!(
                !entry.subject.contains("main only"),
                "feature branch should not include 'main only change', got: {}",
                entry.subject,
            );
        }
    }

    #[test]
    fn log_all_includes_refs_outside_current_head() {
        let root = init_branched_repo("log-all");
        let path_str = root.path.to_string_lossy().into_owned();

        let mut options = default_log_options();
        options.all = true;

        let page = super::log(
            &root.registry,
            &path_str,
            &options,
            &WorkspaceEnv::Local,
        )
        .expect("log returns page");

        // `--all` walks every ref. The merge + the feature follow-up should
        // both be reachable — even if HEAD was detached, both would appear.
        let subjects: Vec<&str> = page.entries.iter().map(|e| e.subject.as_str()).collect();
        let has_merge = subjects.iter().any(|s| s.contains("merge feature"));
        let has_follow_up = subjects.iter().any(|s| s.contains("feature follow-up"));
        let has_main_only = subjects.iter().any(|s| s.contains("main only"));
        assert!(has_merge && has_follow_up && has_main_only);
    }

    #[test]
    fn log_classifies_refs_as_head_local_remote_tag() {
        let root = init_branched_repo("log-refs-classify");
        let path_str = root.path.to_string_lossy().into_owned();

        let mut options = default_log_options();
        options.all = true;
        options.limit = Some(50);

        let page = super::log(
            &root.registry,
            &path_str,
            &options,
            &WorkspaceEnv::Local,
        )
        .expect("log returns page");

        // The merge commit on main is the tip — it should carry the HEAD ref, the
        // `main` local-branch, and the `v1.0` tag. HEAD is its own entry
        // with kind `head`; the branch it points to is a separate entry.
        let merge_entry = page
            .entries
            .iter()
            .find(|e| e.subject.contains("merge feature"))
            .expect("merge commit must be present");
        assert!(
            merge_entry.refs.iter().any(|r| r.kind == "head"
                && r.name == "HEAD"
                && r.is_head),
            "merge commit should carry the HEAD ref: {:?}",
            merge_entry.refs,
        );
        assert!(
            merge_entry.refs.iter().any(|r| r.kind == "local-branch"
                && r.name == "main"
                && !r.is_head),
            "merge commit should carry the main local-branch: {:?}",
            merge_entry.refs,
        );
        assert!(
            merge_entry.refs.iter().any(|r| r.kind == "tag" && r.name == "v1.0"),
            "merge commit should carry the v1.0 tag ref: {:?}",
            merge_entry.refs,
        );

        // The feature follow-up commit is on the `feature` branch only.
        let feature_entry = page
            .entries
            .iter()
            .find(|e| e.subject.contains("feature follow-up"))
            .expect("feature follow-up commit must be present");
        assert!(
            feature_entry.refs.iter().any(|r| r.kind == "local-branch"
                && r.name == "feature"
                && !r.is_head),
            "feature follow-up should carry the feature local branch: {:?}",
            feature_entry.refs,
        );
    }

    #[test]
    fn log_offset_paginates_without_duplicates() {
        let root = init_branched_repo("log-offset");
        let path_str = root.path.to_string_lossy().into_owned();

        let mut page_one = default_log_options();
        page_one.limit = Some(2);
        page_one.offset = Some(0);

        let mut page_two = default_log_options();
        page_two.limit = Some(2);
        page_two.offset = Some(2);

        let one = super::log(
            &root.registry,
            &path_str,
            &page_one,
            &WorkspaceEnv::Local,
        )
        .expect("first page");
        let two = super::log(
            &root.registry,
            &path_str,
            &page_two,
            &WorkspaceEnv::Local,
        )
        .expect("second page");

        assert_eq!(one.entries.len(), 2);
        let page_one_shas: std::collections::HashSet<&str> =
            one.entries.iter().map(|e| e.sha.as_str()).collect();

        for entry in &two.entries {
            assert!(
                !page_one_shas.contains(entry.sha.as_str()),
                "offset page must not repeat page 1 entries, duplicated: {}",
                entry.sha,
            );
        }

        // Page 1 is the newest two commits; with `main` checked out, page 1
        // must report has_more (we know there are at least 4 commits).
        assert!(one.has_more, "page 1 should report more available");
    }

    #[test]
    fn log_has_more_false_when_last_page_reached() {
        let root = init_branched_repo("log-has-more-false");
        let path_str = root.path.to_string_lossy().into_owned();

        let mut options = default_log_options();
        options.limit = Some(200);
        options.offset = Some(0);

        let page = super::log(
            &root.registry,
            &path_str,
            &options,
            &WorkspaceEnv::Local,
        )
        .expect("log returns page");

        assert!(!page.has_more, "limit >> history size => has_more must be false");
    }

    #[test]
    fn log_invalid_ref_is_rejected() {
        let root = init_branched_repo("log-invalid-ref");
        let path_str = root.path.to_string_lossy().into_owned();

        let mut options = default_log_options();
        options.ref_name = Some("does-not-exist".to_string());

        let result = super::log(
            &root.registry,
            &path_str,
            &options,
            &WorkspaceEnv::Local,
        );

        assert!(result.is_err(), "unknown ref must surface an error");
    }

    #[test]
    fn log_empty_repo_returns_empty_page_without_has_more() {
        let root = make_root("log-empty-repo");
        init_git_repo(&root.path, "main");
        // Reset back to the init commit then drop the only commit by deleting
        // the branch tip — easiest path is `update-ref -d HEAD`.
        run_git(&root.path, &["update-ref", "-d", "refs/heads/main"]);
        run_git(
            &root.path,
            &["symbolic-ref", "HEAD", "refs/heads/main"],
        );
        let path_str = root.path.to_string_lossy().into_owned();

        let page = super::log(
            &root.registry,
            &path_str,
            &default_log_options(),
            &WorkspaceEnv::Local,
        )
        .expect("log on empty repo returns empty page");

        assert!(page.entries.is_empty());
        assert!(!page.has_more);
    }

    // --- remote management helpers / operations ----------------------------

    mod remote {
        use super::{init_git_repo, make_root, run_git};
        use crate::modules::git::types::{GitRemoteInput, GitRemoteUrlUpdate};
        use crate::modules::workspace::WorkspaceEnv;
        use std::path::Path;
        use std::process::Command;

        fn run_capture(root: &Path, args: &[&str]) -> String {
            let out = Command::new("git")
                .arg("-C")
                .arg(root)
                .args(args)
                .env("LC_ALL", "C")
                .output()
                .expect("git command");
            assert!(out.status.success(), "git {args:?} failed");
            String::from_utf8_lossy(&out.stdout).into_owned()
        }

        #[test]
        fn validate_remote_name_accepts_common_names() {
            for name in ["origin", "upstream", "remote_1", "a.b-c", "origin1", "_internal"] {
                super::super::validate_remote_name(name)
                    .unwrap_or_else(|e| panic!("expected {name} to be valid, got {e}"));
            }
        }

        #[test]
        fn validate_remote_name_rejects_bad_names() {
            for name in [
                "",
                " leading",
                "-leading",
                "has space",
                "name:colon",
                "semi;colon",
                "with/slash",
                &"x".repeat(65),
            ] {
                assert!(
                    super::super::validate_remote_name(name).is_err(),
                    "expected {name:?} to be rejected"
                );
            }
        }

        #[test]
        fn parse_remote_name_passes_plain_names_through() {
            assert_eq!(super::super::parse_remote_name("origin"), "origin");
            assert_eq!(super::super::parse_remote_name("  origin  "), "origin");
        }

        #[test]
        fn parse_remote_name_unwraps_double_quoted_names() {
            assert_eq!(
                super::super::parse_remote_name("\"weird name\""),
                "weird name"
            );
            // Escapes inside the quoted form should be unescaped exactly once.
            assert_eq!(
                super::super::parse_remote_name("\"a\\\\b\\\"c\""),
                "a\\b\"c"
            );
        }

        #[test]
        fn remote_list_on_empty_repo_returns_empty() {
            let root = make_root("remote-list-empty");
            init_git_repo(&root.path, "main");
            let path_str = root.path.to_string_lossy().into_owned();

            let list = super::super::remote_list(
                &root.registry,
                &path_str,
                &WorkspaceEnv::Local,
            )
            .expect("remote list succeeds");

            assert!(list.is_empty());
        }

        #[test]
        fn remote_add_then_list_then_remove_round_trip() {
            let root = make_root("remote-add-remove");
            init_git_repo(&root.path, "main");
            let path_str = root.path.to_string_lossy().into_owned();

            // Add an origin.
            let added = super::super::remote_add(
                &root.registry,
                &path_str,
                &GitRemoteInput {
                    name: "origin".into(),
                    url: "git@github.com:test/test.git".into(),
                },
                &WorkspaceEnv::Local,
            )
            .expect("remote add succeeds");
            assert_eq!(added.name, "origin");
            assert_eq!(added.fetch_url, "git@github.com:test/test.git");
            assert_eq!(added.push_url, "git@github.com:test/test.git");

            // Add a second remote with a separate pushurl.
            super::super::remote_add(
                &root.registry,
                &path_str,
                &GitRemoteInput {
                    name: "upstream".into(),
                    url: "git@github.com:up/up.git".into(),
                },
                &WorkspaceEnv::Local,
            )
            .expect("remote add upstream succeeds");
            run_git(
                &root.path,
                &[
                    "config",
                    "remote.upstream.pushurl",
                    "git@github.com:up/push.git",
                ],
            );

            let list = super::super::remote_list(
                &root.registry,
                &path_str,
                &WorkspaceEnv::Local,
            )
            .expect("remote list succeeds");
            assert_eq!(list.len(), 2);
            let origin = list.iter().find(|r| r.name == "origin").expect("origin");
            assert_eq!(origin.fetch_url, "git@github.com:test/test.git");
            assert_eq!(origin.push_url, origin.fetch_url);
            let upstream = list.iter().find(|r| r.name == "upstream").expect("upstream");
            assert_eq!(upstream.fetch_url, "git@github.com:up/up.git");
            assert_eq!(upstream.push_url, "git@github.com:up/push.git");

            // Update origin's URL.
            let updated = super::super::remote_set_url(
                &root.registry,
                &path_str,
                &GitRemoteUrlUpdate {
                    name: "origin".into(),
                    new_url: "git@github.com:test/test-renamed.git".into(),
                },
                &WorkspaceEnv::Local,
            )
            .expect("remote set-url succeeds");
            assert_eq!(updated.fetch_url, "git@github.com:test/test-renamed.git");
            // The previous URL should be gone now.
            assert!(
                !run_capture(&root.path, &["remote", "get-url", "origin"]).contains("test/test.git"),
                "old URL should be replaced"
            );

            // Remove origin.
            super::super::remote_remove(
                &root.registry,
                &path_str,
                "origin",
                &WorkspaceEnv::Local,
            )
            .expect("remote remove succeeds");
            let list_after =
                super::super::remote_list(&root.registry, &path_str, &WorkspaceEnv::Local)
                    .expect("remote list after remove");
            assert_eq!(list_after.len(), 1);
            assert_eq!(list_after[0].name, "upstream");
        }

        #[test]
        fn remote_add_rejects_duplicate_name() {
            let root = make_root("remote-duplicate");
            init_git_repo(&root.path, "main");
            let path_str = root.path.to_string_lossy().into_owned();

            super::super::remote_add(
                &root.registry,
                &path_str,
                &GitRemoteInput {
                    name: "origin".into(),
                    url: "git@github.com:test/a.git".into(),
                },
                &WorkspaceEnv::Local,
            )
            .expect("first add succeeds");

            let err = super::super::remote_add(
                &root.registry,
                &path_str,
                &GitRemoteInput {
                    name: "origin".into(),
                    url: "git@github.com:test/b.git".into(),
                },
                &WorkspaceEnv::Local,
            )
            .expect_err("second add must fail");
            assert!(err.to_string().contains("git remote add"));
        }

        #[test]
        fn remote_remove_missing_returns_error() {
            let root = make_root("remote-remove-missing");
            init_git_repo(&root.path, "main");
            let path_str = root.path.to_string_lossy().into_owned();

            let err = super::super::remote_remove(
                &root.registry,
                &path_str,
                "missing",
                &WorkspaceEnv::Local,
            )
            .expect_err("removing missing remote must fail");
            assert!(err.to_string().contains("git remote remove"));
        }

        #[test]
        fn remote_set_url_rejects_invalid_name() {
            let root = make_root("remote-bad-name");
            init_git_repo(&root.path, "main");
            let path_str = root.path.to_string_lossy().into_owned();

            let err = super::super::remote_set_url(
                &root.registry,
                &path_str,
                &GitRemoteUrlUpdate {
                    name: "-leading".into(),
                    new_url: "git@github.com:test/test.git".into(),
                },
                &WorkspaceEnv::Local,
            )
            .expect_err("invalid name must be rejected");
            assert!(err.to_string().contains("invalid remote name"));
        }
    }
}
