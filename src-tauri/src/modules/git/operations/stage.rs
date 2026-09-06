use std::ffi::OsString;
use std::path::Path;

use crate::modules::git::errors::Result;
use crate::modules::git::process::{ensure_success, run_git};
use crate::modules::git::types::{DEFAULT_TIMEOUT_SECS, DiscardEntry, GitOutput};
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

use super::{pathspec_from_input, with_repo};

pub fn stage(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    paths: &[String],
    workspace: &WorkspaceEnv,
) -> Result<()> {
    with_repo(registry, repo_root, workspace, |repo_root| {
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
    })
}

pub fn unstage(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    paths: &[String],
    workspace: &WorkspaceEnv,
) -> Result<()> {
    with_repo(registry, repo_root, workspace, |repo_root| {
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
        let mut rm_args: Vec<OsString> =
            vec!["rm".into(), "--cached".into(), "-r".into(), "--".into()];
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
    })
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
    with_repo(registry, repo_root, workspace, |repo_root| {
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
            let mut args: Vec<OsString> =
                vec!["restore".into(), "--worktree".into(), "--".into()];
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
    })
}

fn resolve_pathspecs(repo_root: &Path, paths: &[String]) -> Result<Vec<String>> {
    let mut out = Vec::with_capacity(paths.len());
    for p in paths {
        out.push(pathspec_from_input(repo_root, p)?);
    }
    Ok(out)
}
