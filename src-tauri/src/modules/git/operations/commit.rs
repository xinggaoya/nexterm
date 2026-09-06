use std::ffi::OsStr;

use crate::modules::git::errors::{GitError, Result};
use crate::modules::git::process::{
    ensure_success, git_stdout_line_opt, git_stdout_lines, run_git,
};
use crate::modules::git::types::{
    GitCommitResult, GitOutput, GitPushResult, DEFAULT_TIMEOUT_SECS, NETWORK_TIMEOUT_SECS,
};
use crate::modules::git::utils::split_upstream;
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

use super::with_repo;

pub fn commit(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    message: &str,
    workspace: &WorkspaceEnv,
) -> Result<GitCommitResult> {
    with_repo(registry, repo_root, workspace, |repo_root| {
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
    })
}

pub fn push(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
) -> Result<GitPushResult> {
    with_repo(registry, repo_root, workspace, |repo_root| {
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

        let upstream = upstream.ok_or(GitError::NoUpstream)?;
        let (remote, branch) = split_upstream(&upstream);
        Ok(GitPushResult {
            remote,
            branch,
            pushed: true,
        })
    })
}

fn nothing_to_commit(output: &GitOutput) -> bool {
    let stderr = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
    let stdout = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
    stderr.contains("nothing to commit") || stdout.contains("nothing to commit")
}

#[cfg(test)]
mod tests {
    use super::nothing_to_commit;
    use crate::modules::git::types::GitOutput;

    fn output_with(stdout: &str, stderr: &str) -> GitOutput {
        GitOutput {
            stdout: stdout.as_bytes().to_vec(),
            stderr: stderr.as_bytes().to_vec(),
            exit_code: Some(1),
            timed_out: false,
            truncated: false,
        }
    }

    #[test]
    fn nothing_to_commit_matches_stdout_or_stderr() {
        assert!(nothing_to_commit(&output_with("", "On branch main\nnothing to commit, working tree clean")));
        assert!(nothing_to_commit(&output_with("nothing to commit", "")));
        assert!(!nothing_to_commit(&output_with("", "fatal: bad revision")));
    }
}
