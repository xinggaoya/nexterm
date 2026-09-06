use std::ffi::{OsStr, OsString};

use crate::modules::git::errors::Result;
use crate::modules::git::parser::parse_branch_lines;
use crate::modules::git::process::{ensure_success, git_stdout_line_opt, git_stdout_lines, run_git};
use crate::modules::git::types::{GitBranchInfo, GitBranchResult, DEFAULT_TIMEOUT_SECS};
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

use super::{validate_git_name, with_repo};

const BRANCH_LIST_FORMAT_ARG: &str = "--format=%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(refname)%1f%(objectname:short)%1f%(subject)%1f%(authordate:unix)%1f%(upstream:track,nobracket)";

pub fn branch_list(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
) -> Result<Vec<GitBranchInfo>> {
    with_repo(registry, repo_root, workspace, |repo_root| {
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
    })
}

pub fn checkout_branch(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    branch: &str,
    remote: bool,
    workspace: &WorkspaceEnv,
) -> Result<GitBranchResult> {
    with_repo(registry, repo_root, workspace, |repo_root| {
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
    })
}

pub fn create_branch(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    branch: &str,
    workspace: &WorkspaceEnv,
) -> Result<GitBranchResult> {
    with_repo(registry, repo_root, workspace, |repo_root| {
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
    })
}

#[cfg(test)]
mod tests {
    use super::BRANCH_LIST_FORMAT_ARG;
    use crate::modules::git::operations::test_support::{init_git_repo, make_root, run_git};
    use crate::modules::workspace::WorkspaceEnv;
    use std::process::Command;

    #[test]
    fn branch_list_format_uses_ref_filter_hex_escape() {
        let format = BRANCH_LIST_FORMAT_ARG
            .strip_prefix("--format=")
            .expect("branch list git arg should set a format");
        assert!(format.contains("%1f"));
        assert!(!format.contains("%x1f"));
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
}
